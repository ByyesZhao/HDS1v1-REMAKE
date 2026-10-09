import { stageInput } from '../model/context-views';
import { randomUUID } from 'node:crypto';
import type { Clock,ModelRunner } from '../types';
import { addMs,milliseconds,nextDaily } from '../time';
import { consolidationTask } from '../model/contracts';
import { MemoryStore } from './store';
import { MemoryLifecycle } from './lifecycle';
import { MemoryIndex } from './index';
import type { IndexJob,MaintenanceJob,MaintenanceUnit,MemoryCandidate,OwnerVersion } from './types';
import { phaseOptions } from '../web/phases';
import {memoryMetadata,metadataCanonical} from './metadata';
import {promotionEligible} from './capacity';
export interface MaintenanceOptions {clock:Clock;onReady?:()=>void;batchItems?:number;batchCharacters?:number|null;backgroundTimeoutMs?:number;retryDelayMs?:number;web?:import('../web/service').WebSearchService;idle?:import('./idle').MemoryIdle}
type Work={table:'memory_index_jobs';job:IndexJob}|{table:'memory_maintenance_jobs';job:MaintenanceJob};
const version=(r:MemoryCandidate):OwnerVersion=>({ownerType:r.ownerType,ownerId:r.ownerId,revision:r.revision,stateVersion:r.stateVersion});
export class MemoryMaintenance {
  private active:Promise<void>|null=null;
  private controller:AbortController|null=null;
  private stopped=false;
  private backendRequests=0;
  private webOwner:import('../web/types').WebOwnerRef|null=null;
  currentWebOwner(){return this.webOwner;}
  constructor(private store:MemoryStore,private lifecycle:MemoryLifecycle,private index:MemoryIndex,private models:ModelRunner,private options:MaintenanceOptions){
    for(const table of ['memory_index_jobs','memory_maintenance_jobs'] as const)for(const job of store.jobs<IndexJob|MaintenanceJob>(table,['computing']))store.saveJob(table,{...job,status:'pending'});
  }
  get inFlight(){return this.active!==null;}
  private due(job:IndexJob|MaintenanceJob,now:string){return !job.retryAt||milliseconds(job.retryAt)<=milliseconds(now);}
  private eligible(work:Work,now:string){return work.table==='memory_index_jobs'||!this.options.idle||this.options.idle.eligibility(now).allowed;}
  private blocked(){const r=this.store.storage.runtime();return r.paused||!!r.openBatch||!!this.store.storage.unfinishedTurn();}
  private work():Work[]{return [...this.store.jobs<IndexJob>('memory_index_jobs',['pending','computing','ready']).map(job=>({table:'memory_index_jobs' as const,job})),...this.store.jobs<MaintenanceJob>('memory_maintenance_jobs',['pending','computing','ready']).map(job=>({table:'memory_maintenance_jobs' as const,job}))].sort((a,b)=>milliseconds(a.job.createdAt)-milliseconds(b.job.createdAt)||a.job.id.localeCompare(b.job.id));}
  private metadataWork():Work[]{
    return (['memory_index_jobs','memory_maintenance_jobs'] as const).flatMap(table=>this.store.storage.prepare(`SELECT json_object('id',id,'status',json_extract(data,'$.status'),'createdAt',json_extract(data,'$.createdAt'),'retryAt',json_extract(data,'$.retryAt'),'lastError',json_extract(data,'$.lastError'),'configSignature',json_extract(data,'$.configSignature'),'readSet',json(COALESCE(json_extract(data,'$.readSet'),'[]'))) AS metadata FROM ${table} WHERE json_extract(data,'$.status') IN ('pending','computing','ready')`).all().map(r=>({table,job:JSON.parse(String(r.metadata))} as Work))).sort((a,b)=>milliseconds(a.job.createdAt)-milliseconds(b.job.createdAt)||a.job.id.localeCompare(b.job.id));
  }
  private makeJob(rows:MemoryCandidate[],cutoff:string,now:string):MaintenanceJob {
    const snapshot=rows.map(row=>row.linkedLongId?{...row,linkedLongId:this.store.canonical(row.linkedLongId)?.id??row.linkedLongId}:row);
    for(const row of snapshot.slice())if(row.linkedLongId){const long=this.store.canonical(row.linkedLongId);if(long&&!snapshot.some(r=>r.id===long.id))snapshot.push(long);}
    const all=this.store.allOwners();
    for(const detail of rows.filter(r=>r.kind==='detail')){
      const keys=new Set([detail.key,...detail.aliases??[]].filter((key):key is string=>!!key));
      for(const dependency of all.filter(r=>r.status!=='merged'&&r.status!=='discarded'&&(r.kind==='detail'&&[r.key,...r.aliases??[]].some(key=>!!key&&keys.has(key))||r.sourceIds.some(id=>detail.sourceIds.includes(id))))){
        if(!snapshot.some(r=>r.id===dependency.id))snapshot.push(dependency);
      }
    }
    let grew=true;
    while(grew){grew=false;const longIds=new Set(snapshot.filter(r=>r.kind==='long').map(r=>r.id));
      const dependencies=all.filter(r=>r.kind==='short'&&!!r.linkedLongId&&longIds.has(r.linkedLongId)||r.kind==='learned'&&r.status==='active'&&(!!r.canonicalMemoryId&&longIds.has(r.canonicalMemoryId)||r.evidenceMemoryIds?.some(id=>longIds.has(id))));
      for(const r of snapshot.filter(r=>r.kind==='learned'))for(const id of [r.canonicalMemoryId,...r.evidenceMemoryIds??[]]){if(id){const l=this.store.canonical(id);if(l)dependencies.push(l);}}
      for(const r of dependencies)if(!snapshot.some(s=>s.id===r.id)){snapshot.push(r);grew=true;}
    }
    const kind=rows.every(r=>r.kind==='detail'||r.kind==='learned')?'audit':'consolidation';
    const job:MaintenanceJob={id:randomUUID(),kind,prunedOwnerKeys:[],cutoff,createdAt:now,status:'pending',snapshot,selectedIds:rows.map(r=>r.id),readSet:snapshot.map(version),result:null,appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null};this.store.saveJob('memory_maintenance_jobs',job);for(const row of rows)this.store.reserveDirty(row);return job;
  }
  private ensureCycle(now:string):void {
    if(this.options.idle){this.ensureIncremental(now);return;}
    let cycle=this.store.storage.get<{cutoff:string}>('memory_maintenance_cycle');
    if(!cycle&&this.store.storage.runtime().nextMaintenanceAt&&milliseconds(this.store.storage.runtime().nextMaintenanceAt!)<=milliseconds(now)){
      cycle={cutoff:now};this.store.storage.set('memory_maintenance_cycle',cycle);
    }
    if(!cycle)return;
    const jobs=this.store.jobs<MaintenanceJob>('memory_maintenance_jobs',['pending','computing','ready']);
    const reserved=new Set(jobs.flatMap(j=>j.readSet.map(r=>r.ownerId)));
    const eligible=this.store.maintenanceCandidates(cycle.cutoff).filter(r=>!reserved.has(r.id)&&(!r.linkedLongId||!reserved.has(this.store.canonical(r.linkedLongId)?.id??r.linkedLongId)));
    const selected:MemoryCandidate[]=[];let characters=0;
    for(const row of eligible){if(selected.length>=(this.options.batchItems??20))break;const size=[...row.content].length;if(selected.length&&this.options.batchCharacters!=null&&characters+size>this.options.batchCharacters)break;selected.push(row);characters+=size;}
    if(selected.length)this.makeJob(selected,cycle.cutoff,now);
    else if(!jobs.length){this.store.storage.set('memory_maintenance_cycle',null);this.store.storage.set('runtime',{...this.store.storage.runtime(),nextMaintenanceAt:nextDaily(now,['04:30'],'Asia/Shanghai')});}
  }
  private ensureIncremental(now:string):void {
    const runtime=this.store.storage.runtime();
    if(runtime.nextMaintenanceAt&&milliseconds(runtime.nextMaintenanceAt)<=milliseconds(now)){
      const cutoff=now;
      for(const row of this.store.maintenanceCandidates(cutoff))this.store.queueDirty(row,'expiry',cutoff);
      this.store.storage.set('runtime',{...runtime,nextMaintenanceAt:nextDaily(cutoff,['04:30'],'Asia/Shanghai')});
      this.store.storage.set('memory_maintenance_cycle',null);
    }
    const jobs=this.store.jobs<MaintenanceJob>('memory_maintenance_jobs',['pending','computing','ready']),reserved=new Set(jobs.flatMap(j=>j.readSet.map(r=>r.ownerId)));
    const available=this.incrementalCandidates(reserved);
    if(!available.length)return;
    const first=available[0],audit=first.kind==='detail'||first.kind==='learned';
    const selected=available.filter(r=>(r.kind==='detail'||r.kind==='learned')===audit).slice(0,this.options.batchItems??20).map(r=>this.store.owner(r)!);
    if(selected.length)this.makeJob(selected,now,now);
  }
  private incrementalCandidates(reserved:Set<string>):MemoryCandidate[]{
    const metadata=memoryMetadata(this.store.storage),byOwner=new Map(metadata.map(r=>[`${r.ownerType}:${r.ownerId}`,r]));
    return this.store.dirtyOwners().filter(r=>r.status==='pending'&&!reserved.has(r.ownerId)).map(r=>byOwner.get(`${r.ownerType}:${r.ownerId}`)).filter((r):r is MemoryCandidate=>!!r&&r.status!=='merged'&&r.status!=='discarded'&&(!r.linkedLongId||!reserved.has(r.linkedLongId)&&!reserved.has(metadataCanonical(metadata,r.linkedLongId)?.id??r.linkedLongId)));
  }
  startOne(now:string):boolean {
    if(this.stopped||this.active||this.blocked())return false;
    this.ensureCycle(now);
    if(this.work().some(w=>w.job.status==='ready'&&this.due(w.job,now)&&this.eligible(w,now)))return false;
    const work=this.work().find(w=>w.job.status==='pending'&&(w.table!=='memory_index_jobs'||w.job.configSignature===this.index.configSignature)&&this.due(w.job,now)&&this.eligible(w,now));if(!work)return false;
    const controller=new AbortController();this.controller=controller;this.store.saveJob(work.table,{...work.job,status:'computing'});
    this.webOwner=work.table==='memory_maintenance_jobs'?{ownerType:'maintenance',ownerId:work.job.id}:null;
    this.backendRequests++;
    this.active=this.prepare(work,controller).finally(()=>{this.active=null;this.controller=null;this.webOwner=null;});
    return true;
  }
  private async prepare(work:Work,controller:AbortController):Promise<void>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    let onAbort!:()=>void;
    const cancelled=new Promise<never>((_,reject)=>{onAbort=()=>reject(controller.signal.reason??new Error('backend cancelled'));controller.signal.addEventListener('abort',onAbort,{once:true});});
    timer=setTimeout(()=>controller.abort(new Error('backend timeout')),this.options.backgroundTimeoutMs??120000);
    try {
      const remote=work.table==='memory_index_jobs'?this.index.prepare(work.job,controller.signal):this.models.runModel(consolidationTask(work.job.snapshot,work.job.selectedIds??work.job.snapshot.map(r=>r.id),work.job.kind??'consolidation',work.job.cutoff),stageInput(work.job.kind==='audit'?'memory_audit':'memory_consolidation',{kind:work.job.kind??'consolidation',cutoff:work.job.cutoff,selectedIds:work.job.selectedIds??work.job.snapshot.map(r=>r.id),snapshot:work.job.snapshot,promotionEligibleIds:work.job.snapshot.filter(r=>promotionEligible(r,work.job.cutoff)).map(r=>r.id)}),phaseOptions(this.options.web,'maintenance',work.job.id,'consolidation','memory_consolidation',{signal:controller.signal,lookup:null}));
      const result=await Promise.race([remote,cancelled]);
      if(this.stopped)return;
      if(work.table==='memory_index_jobs'){
        const current=this.store.job<IndexJob>(work.table,work.job.id);if(!current||current.status==='done'||!this.store.owner(current.owner))return;
        this.store.saveJob(work.table,{...current,status:'ready',result:Array.from((result as import('./types').IndexResult).normalizedVector),lastError:null,retryAt:null});
      }else{
        const current=this.store.job<MaintenanceJob>(work.table,work.job.id);if(!current||current.status==='done')return;
        const pruned=new Set(current.prunedOwnerKeys??[]),units=result as MaintenanceUnit[];
        const invalid=units.filter(u=>u.readSet.some(r=>pruned.has(`${r.ownerType}:${r.ownerId}`)||!this.store.owner(r))||u.ids.some(id=>!current.snapshot.some(r=>r.id===id)));
        for(const u of invalid)for(const ref of u.readSet){const row=this.store.owner(ref);if(row){this.store.queueDirty(row,row.kind==='detail'?'detail':row.kind==='learned'?'learned':'event',this.options.clock.now());this.store.releaseDirty(row);}}
        const staleUnitKeys=[...new Set([...current.staleUnitKeys,...invalid.map(u=>u.unitKey)])];
        const clean=units.map(u=>invalid.includes(u)?{unitKey:u.unitKey,action:u.action,ids:[],readSet:[],sourceIds:[]}:u);
        this.store.saveJob(work.table,{...current,status:clean.every(u=>staleUnitKeys.includes(u.unitKey))?'done':'ready',result:clean,staleUnitKeys,lastError:null,retryAt:null});
      }
      this.options.onReady?.();
    }catch(error){if(!this.stopped){const current=this.store.job<IndexJob|MaintenanceJob>(work.table,work.job.id);if(current&&current.status!=='done'){this.store.saveJob(work.table,{...current,status:'pending',retryAt:addMs(this.options.clock.now(),this.options.retryDelayMs??300000),lastError:error instanceof Error?error.message:String(error)});this.options.onReady?.();}}}
    finally{clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);if(work.table==='memory_maintenance_jobs')this.options.web?.compactOwnerCheckpoint('maintenance',work.job.id);}
  }
  applyOneReady(now:string):'applied'|'stale'|'none' {
    if(this.stopped||this.blocked())return 'none';const works=this.work();const work=works.find(w=>w.job.status==='ready'&&this.due(w.job,now)&&this.eligible(w,now))??works.find(w=>w.table==='memory_index_jobs'&&w.job.status==='pending'&&w.job.configSignature!==this.index.configSignature&&this.due(w.job,now));if(!work)return 'none';
    try{return this.store.storage.transaction(()=>{
      if(work.table==='memory_index_jobs'){
        const owner=this.store.owner(work.job.owner),valid=owner&&owner.revision===work.job.owner.revision&&owner.status!=='merged'&&owner.status!=='discarded'&&work.job.configSignature===this.index.configSignature;
        if(valid)this.store.saveVector(work.job.owner,work.job.configSignature,Float32Array.from(work.job.result!));
        else if(owner&&owner.status!=='merged'&&owner.status!=='discarded')this.store.queueIndex(owner,now,this.index.configSignature);
        this.store.saveJob(work.table,{...work.job,status:'done',completionReason:valid?'applied':'stale',completedAt:now,retryAt:null,lastError:null});return valid?'applied':'stale';
      }
      const job=work.job,unit=job.result!.find(u=>!job.appliedUnitKeys.includes(u.unitKey)&&!job.staleUnitKeys.includes(u.unitKey));
      if(!unit){this.store.saveJob(work.table,{...job,status:'done',retryAt:null,lastError:null});this.options.web?.releaseOwner('maintenance',job.id);return 'none';}
      const valid=unit.readSet.every(ref=>{const r=this.store.owner(ref);return r&&r.status!=='merged'&&r.status!=='discarded'&&r.stateVersion===ref.stateVersion&&r.revision===ref.revision;})&&unit.ids.every(id=>{const r=job.snapshot.find(r=>r.id===id);return !!r&&!!this.store.owner(r);})&&(!unit.canonicalId||unit.readSet.some(r=>r.ownerId===unit.canonicalId)&&!!this.store.canonical(unit.canonicalId));
      const main=unit.action==='promote'?unit.ids.map(id=>job.snapshot.find(r=>r.id===id)!).find(r=>promotionEligible(r,job.cutoff)):null;
      const applicable=valid&&(unit.action!=='promote'||!!main&&!!this.store.owner(main)&&promotionEligible(this.store.owner(main)!,now));
      if(applicable)this.applyUnit(unit,job,now);
      else {
        if(this.options.idle)for(const ref of unit.readSet){const row=this.store.owner(ref);if(row){this.store.queueDirty(row,row.kind==='detail'?'detail':row.kind==='learned'?'learned':'event',now);this.store.releaseDirty(row);}}
        else {const eligible=this.store.maintenanceCandidates(now).filter(r=>unit.ids.includes(r.id));if(eligible.length)this.makeJob(eligible,now,now);}
      }
      const latest=this.store.job<MaintenanceJob>(work.table,job.id)??job;
      const updated={...latest,retryAt:null,lastError:null,appliedUnitKeys:applicable?[...latest.appliedUnitKeys,unit.unitKey]:latest.appliedUnitKeys,staleUnitKeys:applicable?latest.staleUnitKeys.filter(k=>k!==unit.unitKey):[...new Set([...latest.staleUnitKeys,unit.unitKey])]};
      if(updated.appliedUnitKeys.length+updated.staleUnitKeys.length===job.result!.length)updated.status='done';this.store.saveJob(work.table,updated);if(updated.status==='done')this.options.web?.releaseOwner('maintenance',job.id);return applicable?'applied':'stale';
    });}catch(error){
      // The entire application transaction has already rolled back. Preserve its prepared result.
      this.store.saveJob(work.table,{...work.job,retryAt:addMs(now,this.options.retryDelayMs??300000),lastError:error instanceof Error?error.message:String(error)});
      return 'none';
    }
  }
  private applyUnit(unit:MaintenanceUnit,job:MaintenanceJob,now:string):void {
    const rows=unit.ids.map(id=>job.snapshot.find(r=>r.id===id)).filter((r):r is MemoryCandidate=>!!r).map(r=>this.store.owner(r)).filter((r):r is MemoryCandidate=>!!r);
    if(unit.action==='merge_short'){
      const shorts=rows.filter(r=>r.kind==='short');const merged=this.lifecycle.mergeShort(shorts.map(r=>r.id),unit.canonicalShortId!,unit.content!,unit.eventSummary!,unit.feelingSummary!,unit.sourceIds,now);
      this.updateSummary(this.store.canonical(merged.linkedLongId!)!,{...unit,content:[merged.eventSummary,merged.feelingSummary].filter(Boolean).join('\n'),eventSummary:merged.eventSummary,feelingSummary:merged.feelingSummary,sourceIds:[...new Set([...unit.sourceIds,...shorts.flatMap(r=>r.sourceIds)])]},now);
    }else if(unit.action==='review_detail'||unit.action==='review_learned'){
      const target=rows.find(r=>r.id===unit.targetId);if(!target)throw Error('audit missing target');
      const prefix=`${target.ownerType}:${target.id}:`;
      this.store.storage.prepare('DELETE FROM memory_audit_reports WHERE id IN (?,?,?)').run(...['report_conflict','suggest_revision','suggest_withdrawal'].map(decision=>`${prefix}${decision}`));
      if(unit.decision!=='retain')this.store.saveAudit({id:`${prefix}${unit.decision}`,at:now,readSet:unit.readSet,kind:unit.action==='review_detail'?'detail_conflict':unit.decision==='suggest_revision'?'learned_revision':'learned_withdrawal',sourceIds:unit.sourceIds,reason:unit.reason!});
    }else if(unit.action==='merge'){
      const longs=rows.filter(r=>r.kind==='long'),preferred=rows.map(r=>r.linkedLongId).filter((id):id is string=>!!id).map(id=>this.store.canonical(id)!).filter(Boolean);
      const main=[...(preferred.length?preferred:longs)].sort((a,b)=>milliseconds(a.createdAt)-milliseconds(b.createdAt)||a.id.localeCompare(b.id))[0];
      if(!main)throw new Error('merge requires long identities');this.lifecycle.merge(longs.map(r=>r.id),main.id,now);this.updateSummary(this.store.canonical(main.id)!,unit,now);
    } else if(unit.action==='refine')for(const row of rows.filter(r=>r.kind==='long'))this.updateSummary(row,unit,now);
    else if(unit.action==='discard')for(const row of rows.filter(r=>r.kind==='long')){if(row.totalAwakenings)throw new Error('cannot discard awakened memory');this.store.saveOwner({...row,status:'discarded',stateVersion:row.stateVersion+1});}
    else if(unit.action==='promote'){
      const mainId=unit.ids.find(id=>promotionEligible(job.snapshot.find(r=>r.id===id)!,job.cutoff));
      const row=rows.find(r=>r.id===mainId)!;
      this.lifecycle.promote(row.id,`${job.id}:learned:${job.result!.findIndex(u=>u.unitKey===unit.unitKey)}`,unit.content!,unit.learnedKind!,unit.alwaysInclude??false,unit.readSet.map(r=>r.ownerId),now);
    } else for(const row of rows.filter(r=>r.kind==='long'&&r.totalAwakenings>=30))this.lifecycle.evaluateRetain(row.id);
    for(const row of rows.filter(r=>r.kind==='short')){const current=this.store.owner(row);if(current&&current.status==='active')this.store.saveOwner({...current,consolidatedRevision:current.revision,stateVersion:current.stateVersion+1});}
    for(const read of unit.readSet){const current=this.store.owner(read);if(!current)continue;
      if(current.kind==='learned'&&!(job.selectedIds??unit.ids).includes(current.id)){if(current.stateVersion!==read.stateVersion)this.store.queueDirty(current,'learned',now);continue;}
      if(job.kind==='audit'?(job.selectedIds??unit.ids).includes(current.id):current.kind==='short'||current.kind==='long'||(job.selectedIds??unit.ids).includes(current.id))this.store.completeDirty(read,current);
    }
  }
  private updateSummary(row:MemoryCandidate,unit:MaintenanceUnit,now:string){
    const content=unit.content!,eventSummary=unit.eventSummary??content,feelingSummary=unit.feelingSummary??row.feelingSummary;
    const changed=content!==row.content||feelingSummary!==row.feelingSummary;const updated={...row,content,eventSummary,feelingSummary,summaryQuality:'refined' as const,sourceIds:[...new Set([...row.sourceIds,...unit.sourceIds])],revision:row.revision+(changed?1:0),stateVersion:row.stateVersion+1};this.store.saveOwner(updated);if(changed)this.store.queueIndex(updated,now);this.lifecycle.synchronizeProjections(updated,now);
  }
  nextDeadline(now:string):string|null {
    if(this.stopped||this.active||this.blocked())return null;const works=this.metadataWork();
    const deadlines:string[]=[];
    for(const work of works.filter(w=>w.job.status==='pending'||w.job.status==='ready')){
      const retry=work.job.retryAt??now;
      if(this.eligible(work,now))deadlines.push(milliseconds(retry)>milliseconds(now)?retry:now);
      else{const idleAt=this.options.idle?.nextDeadline(now);if(idleAt)deadlines.push(milliseconds(retry)>milliseconds(idleAt)?retry:idleAt);}
    }
    const reserved=new Set(works.filter(w=>w.table==='memory_maintenance_jobs').flatMap(w=>(w.job as MaintenanceJob).readSet.map(r=>r.ownerId)));
    if(this.options.idle&&this.incrementalCandidates(reserved).length){
      const eligibility=this.options.idle.eligibility(now);if(eligibility.allowed)deadlines.push(now);else{const at=this.options.idle.nextDeadline(now);if(at)deadlines.push(at);}
    }
    if(!this.store.storage.get('memory_maintenance_cycle')&&this.store.storage.runtime().nextMaintenanceAt)deadlines.push(this.store.storage.runtime().nextMaintenanceAt!);
    return deadlines.sort((a,b)=>milliseconds(a)-milliseconds(b))[0]??null;
  }
  status(){const jobs=this.metadataWork();return {pending:jobs.filter(w=>w.job.status==='pending').length,ready:jobs.filter(w=>w.job.status==='ready').length,inFlight:this.inFlight,retries:jobs.filter(w=>w.job.retryAt).length,backendRequests:this.backendRequests,lastError:[...jobs].reverse().find(w=>w.job.lastError)?.job.lastError??null,retrieval:this.index.stats};}
  async stop():Promise<void>{this.stopped=true;this.controller?.abort(new Error('backend stopped'));await this.active;}
}
