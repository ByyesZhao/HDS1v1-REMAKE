import {selectMaintenanceBatch} from './batch-selection';
import {assertMessageSources} from '../dialogue/active-consistency';
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
import {readMemoryPolicySnapshot,policyCanonical,type MemoryPolicyRow} from './policy-snapshot';
import {promotionEligible} from './capacity';
import {ModelRunHistory} from '../model/run-history';
import {ModelRequestError,ModelFormatError} from '../model/client';
type FailurePhase='prepare'|'archive'|'apply'|'timeout'|'interrupted';
function failureDiagnostic(error:unknown,phase:FailurePhase):string {
  if(phase==='timeout'||phase==='interrupted')return `maintenance execution ${phase==='timeout'?'timed out':'interrupted'}`;
  // Unknown preparation errors can originate in transports and contain credentials.
  // Only known sanitized model errors and local archive/apply messages are retained.
  if(!(error instanceof Error)||phase==='prepare'&&!(error instanceof ModelRequestError)&&!(error instanceof ModelFormatError))return 'maintenance model preparation failed';
  const message=error.message
    .replace(/((?:proxy-)?authorization\s*[:=]\s*)[^\r\n;]+/gi,'$1[redacted]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s;]+/gi,'[authorization redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|token|password|secret)\s*[:=]\s*)["']?[^"'\s;,&]+/gi,'$1[redacted]')
    .replace(/\bsk-[a-zA-Z0-9_-]+\b/g,'[redacted]')
    .replace(/(https?:\/\/)[^/\s@]+@/gi,'$1[redacted]@')
    .replace(/[\r\n\t]+/g,' ').slice(0,2000);
  return `${phase}: ${message}`;
}
export class MaintenanceExhaustedError extends Error {
  constructor(readonly jobId:string,readonly retryCycle:number){super('记忆整合重试耗尽，程序已暂停');}
}
export interface MaintenanceOptions {clock:Clock;onReady?:()=>void;batchItems?:number;batchCharacters?:number|null;backgroundTimeoutMs?:number;consolidationTimeoutMs?:number;consolidationMaxRetries?:number;retryDelayMs?:number;web?:import('../web/service').WebSearchService;idle?:import('./idle').MemoryIdle}
type Work={table:'memory_index_jobs';job:IndexJob}|{table:'memory_maintenance_jobs';job:MaintenanceJob};
const version=(r:MemoryCandidate):OwnerVersion=>({ownerType:r.ownerType,ownerId:r.ownerId,revision:r.revision,stateVersion:r.stateVersion});
export class MemoryMaintenance {
  private active:Promise<void>|null=null;
  private controller:AbortController|null=null;
  private stopped=false;
 private draining=false;
  private backendRequests=0;
  private errors:unknown[]=[];
  private storageFault=false;
  private storageFailure:Error|undefined;
  private webOwner:import('../web/types').WebOwnerRef|null=null;
  currentWebOwner(){return this.webOwner;}
  constructor(private store:MemoryStore,private lifecycle:MemoryLifecycle,private index:MemoryIndex,private models:ModelRunner,private options:MaintenanceOptions){
    // Reconciliation never invokes onReady: plugin construction has not assigned Host yet.
    try {
      for(const job of store.jobs<IndexJob>('memory_index_jobs',['computing']))store.saveJob('memory_index_jobs',{...job,status:'pending'});
      for(const old of store.jobs<MaintenanceJob>('memory_maintenance_jobs',['computing'])){
        const job=this.normalize(old);
        if(job.result!==null)store.saveJob('memory_maintenance_jobs',{...job,status:'ready'});
        else this.fail(old.attemptId?job:{...job,retryBaseline:'legacy',attemptId:`legacy-interrupted:${job.id}:${job.retryCycle}`},new Error('maintenance execution interrupted'),options.clock.now(),'interrupted');
      }
    }catch(error){this.fatal(error);}
  }
  private normalize(job:MaintenanceJob):MaintenanceJob {
    return {...(job.retryCycle===undefined?{retryBaseline:'legacy' as const}:{}),retryCycle:1,executionAttemptCount:0,failureCount:0,failedAt:null,attemptId:null,settledAttemptId:null,...job};
  }
  private beginAttempt(job:MaintenanceJob):MaintenanceJob {
    const current=this.normalize(job);
    if(current.attemptId&&current.settledAttemptId!==current.attemptId)return current;
    const next={...current,executionAttemptCount:current.executionAttemptCount!+1,attemptId:randomUUID(),retryAt:null};
    this.store.saveJob('memory_maintenance_jobs',next);return next;
  }
  private fail(job:MaintenanceJob,error:unknown,now:string,category:FailurePhase='prepare'):void {
    this.store.storage.transaction(()=>{
      const latest=this.store.job<MaintenanceJob>('memory_maintenance_jobs',job.id);
      if(!latest||latest.status==='done'||latest.status==='failed')return;
      // Adopt only the observed legacy in-flight execution; older history remains unknown.
      const current=!latest.attemptId&&category==='interrupted'?{...this.normalize(latest),retryBaseline:'legacy' as const,attemptId:job.attemptId,executionAttemptCount:1}:this.normalize(latest);
      if(current.attemptId!==job.attemptId||current.settledAttemptId===job.attemptId)return;
      const failureCount=current.failureCount!+1,terminal=failureCount>=(this.options.consolidationMaxRetries??2)+1;
      const task='memory_consolidation'; // Audit uses this same model contract name.
      const safeSummary=terminal?'记忆整合重试耗尽，程序已暂停':category==='interrupted'?'记忆整合执行中断，等待重试':'记忆整合执行失败，等待重试';
      const ref=this.options.web?.store.openStage('maintenance',job.id,'consolidation',task);
      new ModelRunHistory(this.store.storage,this.options.clock).recordFailure({invocationId:`maintenance:${job.id}:${current.retryCycle}:${job.attemptId}`,responseSequence:0,runId:ref?.runId??`maintenance:${job.id}`,ownerType:'maintenance',ownerId:job.id,stageKey:'consolidation',taskName:task,retryCycle:current.retryCycle,attemptId:job.attemptId!,stage:'maintenance',category,error:failureDiagnostic(error,category)});
      this.store.saveJob('memory_maintenance_jobs',{...current,failureCount,settledAttemptId:job.attemptId,status:terminal?'failed':current.result===null?'pending':'ready',retryAt:terminal?null:addMs(now,this.options.retryDelayMs??300000),failedAt:terminal?now:null,lastError:safeSummary});
      if(terminal){const runtime=this.store.storage.runtime();this.store.storage.set('runtime',{...runtime,paused:true,lastError:safeSummary,lastFailure:{kind:'error',task,stage:'maintenance',jobId:job.id,retryCycle:current.retryCycle,at:now,safeSummary},maintenancePause:{jobId:job.id,retryCycle:current.retryCycle!,task,at:now,safeSummary,notification:'pending'}});}
    });
  }
  private fatal(error:unknown):void {
    this.storageFault=true;
    const fault=new Error('记忆维护存储故障，已停止派发',{cause:error});
    this.storageFailure??=fault;
    this.errors.push(fault);
    try{this.store.storage.set('runtime',{...this.store.storage.runtime(),paused:true,lastError:fault.message});}catch(persistenceError){this.errors.push(new Error('无法持久化维护暂停状态',{cause:persistenceError}));}
  }
  takeError():unknown|undefined {
    if(this.errors.length)return this.errors.shift();
    if(this.storageFault)return undefined;
    try{return this.store.storage.transaction(()=>{
      const runtime=this.store.storage.runtime(),owner=runtime.maintenancePause;
      if(!owner||owner.notification!=='pending')return undefined;
      const job=this.store.job<MaintenanceJob>('memory_maintenance_jobs',owner.jobId);
      if(!job||job.status!=='failed'||job.retryCycle!==owner.retryCycle)return undefined;
      this.store.saveJob('memory_maintenance_jobs',{...job,terminalNotices:[...job.terminalNotices??[],{retryCycle:owner.retryCycle,attemptedAt:this.options.clock.now(),status:'attempted'}]});
      this.store.storage.set('runtime',{...runtime,maintenancePause:{...owner,notification:'attempted'}});
      return new MaintenanceExhaustedError(owner.jobId,owner.retryCycle);
    });}catch(error){this.fatal(error);return this.errors.shift();}
  }
  recordNotification(error:MaintenanceExhaustedError,status:'sent'|'failed'):void {
    try{this.store.storage.transaction(()=>{
      const runtime=this.store.storage.runtime(),owner=runtime.maintenancePause;
      const job=this.store.job<MaintenanceJob>('memory_maintenance_jobs',error.jobId);
      if(job)this.store.saveJob('memory_maintenance_jobs',{...job,terminalNotices:job.terminalNotices?.map(n=>n.retryCycle===error.retryCycle?{...n,status}:n)});
      if(owner?.jobId===error.jobId&&owner.retryCycle===error.retryCycle)this.store.storage.set('runtime',{...runtime,maintenancePause:{...owner,notification:status}});
    });}catch(error){this.fatal(error);}
  }
  restartFailedCycle(jobId:string,now:string):void {
    if(this.storageFault)throw new Error('维护存储故障尚未恢复，请重启后检查存储');
    this.store.storage.transaction(()=>{
      const runtime=this.store.storage.runtime(),owner=runtime.maintenancePause,job=this.store.job<MaintenanceJob>('memory_maintenance_jobs',jobId);
      if(!owner||owner.jobId!==jobId||!job||job.status!=='failed'||job.retryCycle!==owner.retryCycle)throw new Error('维护暂停归属与失败周期不一致');
      this.store.saveJob('memory_maintenance_jobs',{...job,status:job.result===null?'pending':'ready',retryCycle:owner.retryCycle+1,executionAttemptCount:0,failureCount:0,failedAt:null,attemptId:null,settledAttemptId:null,retryAt:null,lastError:null});
      this.store.storage.set('runtime',{...runtime,paused:false,lastError:null,lastFailure:null,maintenancePause:null});
    });
  }
  get storageError(){return this.storageFailure;}
  get hasStorageFault(){return this.storageFault;}
  private notify():void {try{this.options.onReady?.();}catch(error){this.fatal(error);}}
  get inFlight(){return this.active!==null;}
  private due(job:IndexJob|MaintenanceJob,now:string){return !job.retryAt||milliseconds(job.retryAt)<=milliseconds(now);}
  private eligible(work:Work,now:string){return work.table==='memory_index_jobs'||!this.options.idle||this.options.idle.eligibility(now).allowed;}
  private blocked(){const r=this.store.storage.runtime();return this.storageFault||r.paused||!!r.maintenancePause||!!r.openBatch||!!this.store.storage.unfinishedTurn();}
  private work():Work[]{return [...this.store.jobs<IndexJob>('memory_index_jobs',['pending','computing','ready']).map(job=>({table:'memory_index_jobs' as const,job})),...this.store.jobs<MaintenanceJob>('memory_maintenance_jobs',['pending','computing','ready']).map(job=>({table:'memory_maintenance_jobs' as const,job}))].sort((a,b)=>milliseconds(a.job.createdAt)-milliseconds(b.job.createdAt)||a.job.id.localeCompare(b.job.id));}
  private metadataWork():Array<Work&{refreshableUnstarted:boolean}>{
    return (['memory_index_jobs','memory_maintenance_jobs'] as const).flatMap(table=>this.store.storage.prepare(`SELECT json_object('id',id,'status',json_extract(data,'$.status'),'createdAt',json_extract(data,'$.createdAt'),'retryAt',json_extract(data,'$.retryAt'),'lastError',json_extract(data,'$.lastError'),'retryCycle',json_extract(data,'$.retryCycle'),'failureCount',json_extract(data,'$.failureCount'),'executionAttemptCount',json_extract(data,'$.executionAttemptCount'),'configSignature',json_extract(data,'$.configSignature'),'readSet',json(COALESCE(json_extract(data,'$.readSet'),'[]'))) AS metadata,${table==='memory_maintenance_jobs'?"(json_extract(data,'$.status')='pending' AND json_type(data,'$.startedAt')='null' AND json_type(data,'$.result')='null' AND COALESCE(json_array_length(data,'$.appliedUnitKeys'),0)=0)":'0'} AS refreshableUnstarted FROM ${table} WHERE json_extract(data,'$.status') IN ('pending','computing','ready','failed')`).all().map(r=>({table,job:JSON.parse(String(r.metadata)),refreshableUnstarted:!!r.refreshableUnstarted} as Work&{refreshableUnstarted:boolean}))).sort((a,b)=>milliseconds(a.job.createdAt)-milliseconds(b.job.createdAt)||a.job.id.localeCompare(b.job.id));
  }
  private refreshable(job:MaintenanceJob):boolean{return job.status==='pending'&&job.startedAt===null&&job.result===null&&job.appliedUnitKeys.length===0;}
  private selectBatch(rows:MemoryCandidate[]):MemoryCandidate[]{return selectMaintenanceBatch(rows,{batchItems:this.options.batchItems??20,batchCharacters:this.options.batchCharacters??null});}
  private buildSnapshot(rows:MemoryCandidate[]):MemoryCandidate[] {
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
    return snapshot;
  }
  private makeJob(rows:MemoryCandidate[],cutoff:string,now:string):MaintenanceJob {
    const snapshot=this.buildSnapshot(rows);
    const kind=rows.every(r=>r.kind==='detail'||r.kind==='learned')?'audit':'consolidation';
    const job:MaintenanceJob={retryCycle:1,executionAttemptCount:0,failureCount:0,failedAt:null,attemptId:null,settledAttemptId:null,id:randomUUID(),startedAt:null,kind,prunedOwnerKeys:[],cutoff,createdAt:now,status:'pending',snapshot,selectedIds:rows.map(r=>r.id),readSet:snapshot.map(version),result:null,appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null};this.store.saveJob('memory_maintenance_jobs',job);for(const row of rows)this.store.reserveDirty(row);return job;
  }
  private ensureCycle(now:string):void {
    if(this.options.idle){this.ensureIncremental(now);return;}
    let cycle=this.store.storage.get<{cutoff:string}>('memory_maintenance_cycle');
    if(!cycle&&this.store.storage.runtime().nextMaintenanceAt&&milliseconds(this.store.storage.runtime().nextMaintenanceAt!)<=milliseconds(now)){
      cycle={cutoff:now};this.store.storage.set('memory_maintenance_cycle',cycle);
    }
    if(!cycle)return;
    const jobs=this.store.jobs<MaintenanceJob>('memory_maintenance_jobs',['pending','computing','ready','failed']);
    if(jobs.some(j=>this.refreshable(j)))return;
    const reserved=new Set(jobs.flatMap(j=>j.readSet.map(r=>r.ownerId)));
    const eligible=this.store.maintenanceCandidates(cycle.cutoff).filter(r=>!reserved.has(r.id)&&(!r.linkedLongId||!reserved.has(this.store.canonical(r.linkedLongId)?.id??r.linkedLongId)));
    const selected=this.selectBatch(eligible);
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
    if(!this.options.idle!.eligibility(now).allowed)return;
    const jobs=this.store.jobs<MaintenanceJob>('memory_maintenance_jobs',['pending','computing','ready','failed']),reserved=new Set(jobs.flatMap(j=>j.readSet.map(r=>r.ownerId)));
    if(jobs.some(j=>this.refreshable(j)))return;
    const available=this.incrementalCandidates(reserved);
    if(!available.length)return;
    const first=available[0],audit=first.kind==='detail'||first.kind==='learned';
    const owners=available.filter(r=>(r.kind==='detail'||r.kind==='learned')===audit).map(r=>this.store.owner(r)).filter((r):r is MemoryCandidate=>!!r);
    const selected=this.selectBatch(owners);
    if(selected.length)this.makeJob(selected,now,now);
  }
  private incrementalCandidates(reserved:Set<string>):MemoryPolicyRow[]{
    const snapshot=readMemoryPolicySnapshot(this.store.storage);
    return this.store.dirtyOwners().filter(r=>r.status==='pending'&&!reserved.has(r.ownerId)).map(r=>snapshot.byOwner.get(`${r.ownerType}:${r.ownerId}`)).filter((r):r is MemoryPolicyRow=>!!r&&r.status!=='merged'&&r.status!=='discarded'&&(!r.linkedLongId||!reserved.has(r.linkedLongId)&&!reserved.has(policyCanonical(snapshot,r.linkedLongId,'metadata')?.id??r.linkedLongId)));
  }
  private refreshUnstarted(job:MaintenanceJob,now:string):MaintenanceJob|null {
    if(job.startedAt!==null||job.result!==null||job.appliedUnitKeys.length)return job;
    const selected=job.selectedIds??job.snapshot.map(r=>r.id),daily=this.options.idle?null:new Set(this.store.maintenanceCandidates(job.cutoff).map(r=>r.id));
    const currentRows=selected.map(id=>job.snapshot.find(r=>r.id===id)).filter((r):r is MemoryCandidate=>!!r).map(r=>this.store.owner(r)).filter((r):r is MemoryCandidate=>!!r&&r.status!=='merged'&&r.status!=='discarded'&&(!daily||daily.has(r.id)));
    for(const ref of job.readSet.filter(r=>selected.includes(r.ownerId)))this.store.releaseDirtyVersion(ref);
    const rows=this.selectBatch(currentRows);
    if(!rows.length){this.store.saveJob('memory_maintenance_jobs',{...job,status:'done'});return null;}
    const snapshot=this.buildSnapshot(rows),updated={...job,cutoff:this.options.idle?now:job.cutoff,snapshot,selectedIds:rows.map(r=>r.id),readSet:snapshot.map(version)};
    this.store.saveJob('memory_maintenance_jobs',updated);for(const row of rows)this.store.reserveDirty(row);return updated;
  }
  startOne(now:string):boolean {
    try{return this.dispatchOne(now);}catch(error){this.fatal(error);this.notify();return false;}
  }
  private dispatchOne(now:string):boolean {
    if(this.stopped||this.draining||this.active||this.blocked())return false;
    this.ensureCycle(now);
    if(this.work().some(w=>w.job.status==='ready'&&this.due(w.job,now)&&this.eligible(w,now)))return false;
    let work:Work|undefined,cleaned=0;
    for(const candidate of this.work()){
      if(candidate.job.status!=='pending'||!this.due(candidate.job,now)||!this.eligible(candidate,now))continue;
      if(candidate.table==='memory_index_jobs'&&candidate.job.startedAt===null){
        const row=this.store.owner(candidate.job.owner),valid=row&&row.status!=='merged'&&row.status!=='discarded'&&row.revision===candidate.job.owner.revision&&candidate.job.configSignature===this.index.configSignature;
        if(!valid){this.store.storage.transaction(()=>{
          this.store.saveJob('memory_index_jobs',{...candidate.job,status:'done',completionReason:'stale',completedAt:now,retryAt:null,lastError:null});
          if(row&&row.status!=='merged'&&row.status!=='discarded')this.store.queueIndex(row,now,this.index.configSignature);
        });if(++cleaned>=20)return false;continue;}
      }
      if(candidate.table==='memory_index_jobs'&&candidate.job.configSignature!==this.index.configSignature)continue;
      work=candidate;break;
    }
    if(!work)return false;
    work=this.store.storage.transaction(()=>{
      if(work!.table==='memory_maintenance_jobs'){const refreshed=this.refreshUnstarted(work!.job,now);if(!refreshed)return undefined;work={table:'memory_maintenance_jobs',job:this.beginAttempt(refreshed)};}
      const dispatched={...work!.job,status:'computing' as const,...(work!.job.startedAt===null?{startedAt:now}:{})};this.store.saveJob(work!.table,dispatched);return {...work!,job:dispatched} as Work;
    });if(!work)return false;
    const controller=new AbortController();this.controller=controller;
    this.webOwner=work.table==='memory_maintenance_jobs'?{ownerType:'maintenance',ownerId:work.job.id}:null;
    this.backendRequests++;
    this.active=this.prepare(work,controller).catch(error=>{this.fatal(error);this.notify();}).finally(()=>{this.active=null;this.controller=null;this.webOwner=null;});
    return true;
  }
  private async prepare(work:Work,controller:AbortController):Promise<void>{
    let phase:FailurePhase='prepare';
    let timer:ReturnType<typeof setTimeout>|undefined;
    let onAbort!:()=>void;
    const cancelled=new Promise<never>((_,reject)=>{onAbort=()=>reject(controller.signal.reason??new Error('backend cancelled'));controller.signal.addEventListener('abort',onAbort,{once:true});});
    timer=setTimeout(()=>controller.abort(new Error('backend timeout')),work.table==='memory_maintenance_jobs'?(this.options.consolidationTimeoutMs??600000):(this.options.backgroundTimeoutMs??120000));
    try {
      const remote=work.table==='memory_index_jobs'?this.index.prepare(work.job,controller.signal):this.models.runModel(consolidationTask(work.job.snapshot,work.job.selectedIds??work.job.snapshot.map(r=>r.id),work.job.kind??'consolidation',work.job.cutoff),stageInput(work.job.kind==='audit'?'memory_audit':'memory_consolidation',{kind:work.job.kind??'consolidation',cutoff:work.job.cutoff,selectedIds:work.job.selectedIds??work.job.snapshot.map(r=>r.id),snapshot:work.job.snapshot,promotionEligibleIds:work.job.snapshot.filter(r=>promotionEligible(r,work.job.cutoff)).map(r=>r.id)}),phaseOptions(this.options.web,'maintenance',work.job.id,'consolidation','memory_consolidation',{signal:controller.signal,lookup:null,executionAttempt:{retryCycle:work.job.retryCycle!,attemptId:work.job.attemptId!}}));
      const result=await Promise.race([remote,cancelled]);
      if(this.stopped)return;
      if(work.table==='memory_index_jobs'){
        const current=this.store.job<IndexJob>(work.table,work.job.id);if(!current||current.status==='done'||!this.store.owner(current.owner))return;
        this.store.saveJob(work.table,{...current,status:'ready',result:Array.from((result as import('./types').IndexResult).normalizedVector),lastError:null,retryAt:null});
      }else{
        const current=this.store.job<MaintenanceJob>(work.table,work.job.id);if(!current||current.status!=='computing'||current.attemptId!==work.job.attemptId)return;
        const pruned=new Set(current.prunedOwnerKeys??[]),units=result as MaintenanceUnit[];
        const invalid=units.filter(u=>u.readSet.some(r=>pruned.has(`${r.ownerType}:${r.ownerId}`)||!this.store.owner(r))||u.ids.some(id=>!current.snapshot.some(r=>r.id===id)));
        for(const u of invalid)for(const ref of u.readSet){const row=this.store.owner(ref);if(row){this.store.queueDirty(row,row.kind==='detail'?'detail':row.kind==='learned'?'learned':'event',this.options.clock.now());this.store.releaseDirty(row);}}
        const staleUnitKeys=[...new Set([...current.staleUnitKeys,...invalid.map(u=>u.unitKey)])];
        const clean=units.map(u=>invalid.includes(u)?{unitKey:u.unitKey,action:u.action,ids:[],readSet:[],sourceIds:[]}:u);
        this.store.saveJob(work.table,{...current,status:'ready',result:clean,staleUnitKeys,lastError:null,retryAt:null});
        phase='archive';this.store.compactMaintenanceCheckpoint(current.id);phase='apply';
        if(clean.every(u=>staleUnitKeys.includes(u.unitKey)))this.store.saveJob(work.table,{...this.store.job<MaintenanceJob>(work.table,current.id)!,status:'done'});
      }
      this.notify();
    }catch(error){
      if(!this.stopped){
        if(work.table==='memory_maintenance_jobs')this.fail(work.job,error,this.options.clock.now(),controller.signal.aborted?'timeout':phase);
        else {const current=this.store.job<IndexJob>(work.table,work.job.id);if(current&&current.status!=='done')this.store.saveJob(work.table,{...current,status:'pending',retryAt:addMs(this.options.clock.now(),this.options.retryDelayMs??300000),lastError:error instanceof Error?error.message:String(error)});}
        this.notify();
      }
    }finally{clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);}
  }

  applyOneReady(now:string):'applied'|'stale'|'none' {
    try{return this.applyReady(now);}catch(error){this.fatal(error);this.notify();return 'none';}
  }
  private applyReady(now:string):'applied'|'stale'|'none' {
    if(this.stopped||this.draining||this.blocked())return 'none';const works=this.work();let work=works.find(w=>w.job.status==='ready'&&this.due(w.job,now)&&this.eligible(w,now))??works.find(w=>w.table==='memory_index_jobs'&&w.job.status==='pending'&&w.job.configSignature!==this.index.configSignature&&this.due(w.job,now));if(!work)return 'none';
    try{if(work.table==='memory_maintenance_jobs')work={...work,job:this.store.storage.transaction(()=>this.beginAttempt(work!.job as MaintenanceJob))};}catch(error){this.fatal(error);return 'none';}
    let phase:FailurePhase='archive';
    try{return this.store.storage.transaction(()=>{
      if(work.table==='memory_index_jobs'){
        const owner=this.store.owner(work.job.owner),valid=owner&&owner.revision===work.job.owner.revision&&owner.status!=='merged'&&owner.status!=='discarded'&&work.job.configSignature===this.index.configSignature;
        if(valid)this.store.saveVector(work.job.owner,work.job.configSignature,Float32Array.from(work.job.result!));
        else if(owner&&owner.status!=='merged'&&owner.status!=='discarded')this.store.queueIndex(owner,now,this.index.configSignature);
        this.store.saveJob(work.table,{...work.job,status:'done',completionReason:valid?'applied':'stale',completedAt:now,retryAt:null,lastError:null});return valid?'applied':'stale';
      }
      this.store.compactMaintenanceCheckpoint(work.job.id);phase='apply';
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
      try{if(work.table==='memory_maintenance_jobs')this.fail(work.job,error,now,phase);else this.store.saveJob(work.table,{...work.job,retryAt:addMs(now,this.options.retryDelayMs??300000),lastError:error instanceof Error?error.message:String(error)});}catch(persistenceError){this.fatal(persistenceError);}
      this.notify();
      return 'none';
    }
  }
  private applyUnit(unit:MaintenanceUnit,job:MaintenanceJob,now:string):void {
    assertMessageSources(this.store.storage,unit.sourceIds);
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
    if(this.stopped||this.draining||this.active||this.blocked())return null;const works=this.metadataWork();
    const deadlines:string[]=[];
    for(const work of works.filter(w=>w.job.status==='pending'||w.job.status==='ready')){
      const retry=work.job.retryAt??now;
      if(this.eligible(work,now))deadlines.push(milliseconds(retry)>milliseconds(now)?retry:now);
      else{const idleAt=this.options.idle?.nextDeadline(now);if(idleAt)deadlines.push(milliseconds(retry)>milliseconds(idleAt)?retry:idleAt);}
    }
    const reserved=new Set(works.filter(w=>w.table==='memory_maintenance_jobs').flatMap(w=>(w.job as MaintenanceJob).readSet.map(r=>r.ownerId)));
    if(this.options.idle&&!works.some(w=>w.refreshableUnstarted)&&this.incrementalCandidates(reserved).length){
      const eligibility=this.options.idle.eligibility(now);if(eligibility.allowed)deadlines.push(now);else{const at=this.options.idle.nextDeadline(now);if(at)deadlines.push(at);}
    }
    if(!this.store.storage.get('memory_maintenance_cycle')&&this.store.storage.runtime().nextMaintenanceAt)deadlines.push(this.store.storage.runtime().nextMaintenanceAt!);
    return deadlines.sort((a,b)=>milliseconds(a)-milliseconds(b))[0]??null;
  }
  status(){const jobs=this.metadataWork();return {failed:jobs.filter(w=>w.job.status==='failed').map(w=>({jobId:w.job.id,retryCycle:(w.job as MaintenanceJob).retryCycle,failureCount:(w.job as MaintenanceJob).failureCount,executionAttemptCount:(w.job as MaintenanceJob).executionAttemptCount})),pending:jobs.filter(w=>w.job.status==='pending').length,ready:jobs.filter(w=>w.job.status==='ready').length,inFlight:this.inFlight,retries:jobs.filter(w=>w.job.retryAt).length,backendRequests:this.backendRequests,lastError:[...jobs].reverse().find(w=>w.job.lastError)?.job.lastError??null,retrieval:this.index.stats};}
  async stop(options:{graceful?:boolean}={}):Promise<void>{this.draining=true;if(!options.graceful){this.stopped=true;this.controller?.abort(new Error('backend stopped'));}await this.active;this.stopped=true;}
}
