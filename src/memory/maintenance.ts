import { randomUUID } from 'node:crypto';
import type { Clock,ModelRunner } from '../types';
import { addMs,milliseconds,nextDaily } from '../time';
import { consolidationTask } from '../model/contracts';
import { MemoryStore } from './store';
import { MemoryLifecycle } from './lifecycle';
import { MemoryIndex } from './index';
import type { IndexJob,MaintenanceJob,MaintenanceUnit,MemoryCandidate,OwnerVersion } from './types';
import { phaseOptions } from '../web/phases';
export interface MaintenanceOptions {clock:Clock;onReady?:()=>void;batchItems?:number;batchCharacters?:number|null;backgroundTimeoutMs?:number;retryDelayMs?:number;web?:import('../web/service').WebSearchService}
type Work={table:'memory_index_jobs';job:IndexJob}|{table:'memory_maintenance_jobs';job:MaintenanceJob};
const version=(r:MemoryCandidate):OwnerVersion=>({ownerType:r.ownerType,ownerId:r.ownerId,revision:r.revision,stateVersion:r.stateVersion});
export class MemoryMaintenance {
  private active:Promise<void>|null=null;
  private controller:AbortController|null=null;
  private stopped=false;
  constructor(private store:MemoryStore,private lifecycle:MemoryLifecycle,private index:MemoryIndex,private models:ModelRunner,private options:MaintenanceOptions){
    for(const table of ['memory_index_jobs','memory_maintenance_jobs'] as const)for(const job of store.jobs<IndexJob|MaintenanceJob>(table,['computing']))store.saveJob(table,{...job,status:'pending'});
  }
  get inFlight(){return this.active!==null;}
  private due(job:IndexJob|MaintenanceJob,now:string){return !job.retryAt||milliseconds(job.retryAt)<=milliseconds(now);}
  private work():Work[]{return [...this.store.jobs<IndexJob>('memory_index_jobs',['pending','computing','ready']).map(job=>({table:'memory_index_jobs' as const,job})),...this.store.jobs<MaintenanceJob>('memory_maintenance_jobs',['pending','computing','ready']).map(job=>({table:'memory_maintenance_jobs' as const,job}))].sort((a,b)=>milliseconds(a.job.createdAt)-milliseconds(b.job.createdAt)||a.job.id.localeCompare(b.job.id));}
  private makeJob(rows:MemoryCandidate[],cutoff:string,now:string):MaintenanceJob {
    const snapshot=rows.map(row=>row.linkedLongId?{...row,linkedLongId:this.store.canonical(row.linkedLongId)?.id??row.linkedLongId}:row);
    for(const row of snapshot.slice())if(row.linkedLongId){const long=this.store.canonical(row.linkedLongId);if(long&&!snapshot.some(r=>r.id===long.id))snapshot.push(long);}
    for(const row of snapshot.slice().filter(r=>r.kind==='long'))for(const projection of this.store.projections(row.id))if(!snapshot.some(r=>r.id===projection.id))snapshot.push(projection);
    const job:MaintenanceJob={id:randomUUID(),cutoff,createdAt:now,status:'pending',snapshot,selectedIds:rows.map(r=>r.id),readSet:snapshot.map(version),result:null,appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null};this.store.saveJob('memory_maintenance_jobs',job);return job;
  }
  private ensureCycle(now:string):void {
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
  startOne(now:string):boolean {
    if(this.stopped||this.active||this.work().some(w=>w.job.status==='ready'&&this.due(w.job,now)))return false;
    this.ensureCycle(now);
    const work=this.work().find(w=>w.job.status==='pending'&&(w.table!=='memory_index_jobs'||w.job.configSignature===this.index.configSignature)&&this.due(w.job,now));if(!work)return false;
    const controller=new AbortController();this.controller=controller;this.store.saveJob(work.table,{...work.job,status:'computing'});
    this.active=this.prepare(work,controller).finally(()=>{this.active=null;this.controller=null;});
    return true;
  }
  private async prepare(work:Work,controller:AbortController):Promise<void>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    let onAbort!:()=>void;
    const cancelled=new Promise<never>((_,reject)=>{onAbort=()=>reject(controller.signal.reason??new Error('backend cancelled'));controller.signal.addEventListener('abort',onAbort,{once:true});});
    timer=setTimeout(()=>controller.abort(new Error('backend timeout')),this.options.backgroundTimeoutMs??120000);
    try {
      const remote=work.table==='memory_index_jobs'?this.index.prepare(work.job,controller.signal):this.models.runModel(consolidationTask(work.job.snapshot,work.job.selectedIds??work.job.snapshot.map(r=>r.id)),{cutoff:work.job.cutoff,selectedIds:work.job.selectedIds??work.job.snapshot.map(r=>r.id),snapshot:work.job.snapshot},phaseOptions(this.options.web,'maintenance',work.job.id,'consolidation','memory_consolidation',{signal:controller.signal,lookup:null}));
      const result=await Promise.race([remote,cancelled]);
      if(this.stopped)return;
      if(work.table==='memory_index_jobs'){
        const current=this.store.job<IndexJob>(work.table,work.job.id);if(!current||current.status==='done'||!this.store.owner(current.owner))return;
        this.store.saveJob(work.table,{...current,status:'ready',result:Array.from((result as import('./types').IndexResult).normalizedVector),lastError:null,retryAt:null});
      }else{
        const current=this.store.job<MaintenanceJob>(work.table,work.job.id);if(!current||current.status==='done')return;
        const pruned=new Set(current.prunedOwnerKeys??[]),units=result as MaintenanceUnit[];
        const invalid=units.filter(u=>u.readSet.some(r=>pruned.has(`${r.ownerType}:${r.ownerId}`)||!this.store.owner(r))||u.ids.some(id=>!current.snapshot.some(r=>r.id===id)));
        const staleUnitKeys=[...new Set([...current.staleUnitKeys,...invalid.map(u=>u.unitKey)])];
        const clean=units.map(u=>invalid.includes(u)?{unitKey:u.unitKey,action:u.action,ids:[],readSet:[],sourceIds:[]}:u);
        this.store.saveJob(work.table,{...current,status:clean.every(u=>staleUnitKeys.includes(u.unitKey))?'done':'ready',result:clean,staleUnitKeys,lastError:null,retryAt:null});
      }
      this.options.onReady?.();
    }catch(error){if(!this.stopped){const current=this.store.job<IndexJob|MaintenanceJob>(work.table,work.job.id);if(current&&current.status!=='done'){this.store.saveJob(work.table,{...current,status:'pending',retryAt:addMs(this.options.clock.now(),this.options.retryDelayMs??300000),lastError:error instanceof Error?error.message:String(error)});this.options.onReady?.();}}}
    finally{clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);if(work.table==='memory_maintenance_jobs')this.options.web?.compactOwnerCheckpoint('maintenance',work.job.id);}
  }
  applyOneReady(now:string):'applied'|'stale'|'none' {
    if(this.stopped)return 'none';const works=this.work();const work=works.find(w=>w.job.status==='ready'&&this.due(w.job,now))??works.find(w=>w.table==='memory_index_jobs'&&w.job.status==='pending'&&w.job.configSignature!==this.index.configSignature&&this.due(w.job,now));if(!work)return 'none';
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
      if(valid)this.applyUnit(unit,job,now);
      else {const eligible=this.store.maintenanceCandidates(job.cutoff).filter(r=>unit.ids.includes(r.id));if(eligible.length)this.makeJob(eligible,job.cutoff,now);}
      const updated={...job,retryAt:null,lastError:null,appliedUnitKeys:valid?[...job.appliedUnitKeys,unit.unitKey]:job.appliedUnitKeys,staleUnitKeys:valid?job.staleUnitKeys:[...job.staleUnitKeys,unit.unitKey]};
      if(updated.appliedUnitKeys.length+updated.staleUnitKeys.length===job.result!.length)updated.status='done';this.store.saveJob(work.table,updated);if(updated.status==='done')this.options.web?.releaseOwner('maintenance',job.id);return valid?'applied':'stale';
    });}catch(error){
      // The entire application transaction has already rolled back. Preserve its prepared result.
      this.store.saveJob(work.table,{...work.job,retryAt:addMs(now,this.options.retryDelayMs??300000),lastError:error instanceof Error?error.message:String(error)});
      return 'none';
    }
  }
  private applyUnit(unit:MaintenanceUnit,job:MaintenanceJob,now:string):void {
    const rows=unit.ids.map(id=>job.snapshot.find(r=>r.id===id)).filter((r):r is MemoryCandidate=>!!r).map(r=>this.store.owner(r)).filter((r):r is MemoryCandidate=>!!r);
    if(unit.action==='merge'){
      const longs=rows.filter(r=>r.kind==='long'),preferred=rows.map(r=>r.linkedLongId).filter((id):id is string=>!!id).map(id=>this.store.canonical(id)!).filter(Boolean);
      const main=[...(preferred.length?preferred:longs)].sort((a,b)=>milliseconds(a.createdAt)-milliseconds(b.createdAt)||a.id.localeCompare(b.id))[0];
      if(!main)throw new Error('merge requires long identities');this.lifecycle.merge(longs.map(r=>r.id),main.id,now);this.updateSummary(this.store.canonical(main.id)!,unit,now);
    } else if(unit.action==='refine')for(const row of rows.filter(r=>r.kind==='long'))this.updateSummary(row,unit,now);
    else if(unit.action==='discard')for(const row of rows.filter(r=>r.kind==='long')){if(row.totalAwakenings)throw new Error('cannot discard awakened memory');this.store.saveOwner({...row,status:'discarded',stateVersion:row.stateVersion+1});}
    else if(unit.action==='promote'){
      const row=rows.find(r=>r.kind==='long'&&r.totalAwakenings>=30)!;
      this.lifecycle.promote(row.id,`${job.id}:learned:${job.result!.findIndex(u=>u.unitKey===unit.unitKey)}`,unit.content!,unit.learnedKind!,unit.alwaysInclude??false,unit.readSet.map(r=>r.ownerId),now);
    } else for(const row of rows.filter(r=>r.kind==='long'&&r.totalAwakenings>=30))this.lifecycle.evaluateRetain(row.id);
    for(const row of rows.filter(r=>r.kind==='short')){const current=this.store.owner(row)!;this.store.saveOwner({...current,consolidatedRevision:current.revision,stateVersion:current.stateVersion+1});}
  }
  private updateSummary(row:MemoryCandidate,unit:MaintenanceUnit,now:string){
    const content=unit.content!,eventSummary=unit.eventSummary??content,feelingSummary=unit.feelingSummary??row.feelingSummary;
    const changed=content!==row.content||feelingSummary!==row.feelingSummary;const updated={...row,content,eventSummary,feelingSummary,summaryQuality:'refined' as const,sourceIds:[...new Set([...row.sourceIds,...unit.sourceIds])],revision:row.revision+(changed?1:0),stateVersion:row.stateVersion+1};this.store.saveOwner(updated);if(changed)this.store.queueIndex(updated,now);this.lifecycle.synchronizeProjections(updated,now);
  }
  nextDeadline(now:string):string|null {
    if(this.stopped||this.active)return null;const works=this.work();if(works.some(w=>w.job.status==='ready'&&this.due(w.job,now)))return now;
    const deadlines=works.filter(w=>w.job.status==='pending'||w.job.status==='ready').map(w=>w.job.retryAt??now);
    if(!this.store.storage.get('memory_maintenance_cycle')&&this.store.storage.runtime().nextMaintenanceAt)deadlines.push(this.store.storage.runtime().nextMaintenanceAt!);
    return deadlines.sort((a,b)=>milliseconds(a)-milliseconds(b))[0]??null;
  }
  status(){const jobs=this.work();return {pending:jobs.filter(w=>w.job.status==='pending').length,ready:jobs.filter(w=>w.job.status==='ready').length,inFlight:this.inFlight,retries:jobs.filter(w=>w.job.retryAt).length,lastError:[...jobs].reverse().find(w=>w.job.lastError)?.job.lastError??null,retrieval:this.index.stats};}
  async stop():Promise<void>{this.stopped=true;this.controller?.abort(new Error('backend stopped'));await this.active;}
}
