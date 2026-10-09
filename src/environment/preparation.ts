import type {Dependencies} from '../app';
import type {EnvironmentGenerator,EnvironmentStep} from './types';
import type {ModelRunOptions,LookupRequest} from '../memory/types';
import type {WebModelCheckpoint,WebOwnerRef} from '../web/types';
import {ModelFormatError,ModelRequestError} from '../model/client';
import {addMs,milliseconds} from '../time';
import {ensureEnvironmentBatch,localDate,selectEnvironmentStepMetadata,nextEnvironmentDate} from './scheduler';
import {resolveResult,commitEnvironmentResult} from './runtime';
import {freezeEnvironmentSnapshot,frozenSchoolView,environmentBusinessBasis,lookupBasisCurrent,lookupFrozenEnvironment,retrievalFor} from './snapshot';
type Execution={stepId:string;batchId:string;generation:number;lease:symbol;controller:AbortController;promise:Promise<void>};
export class EnvironmentPreparation {
 private active:Execution|null=null;
 private stopped=false;
 private errors:unknown[]=[];
 constructor(private d:Dependencies,private options:{onReady?:()=>void;onError?:(error:unknown)=>void}={}){}
 get inFlight(){return !!this.active;}
 get inFlightStepId(){return this.active?.stepId??null;}
 currentWebOwner():WebOwnerRef|null{return this.active?{ownerType:'environment',ownerId:this.active.stepId}:null;}
 takeError(){return this.errors.shift();}
 status(){
 const batch=this.d.environmentStore.firstActiveBatch(),meta=batch?this.d.environmentStore.stepMetadata(batch.id).find(s=>s.status!=='committed'&&s.status!=='superseded'):null;
 return meta?{stage:meta.stage,mode:meta.preparationVersion===0?'旧任务串行恢复':meta.status==='ready'?'待提交':meta.retryAt?'等待重试':this.inFlight?'准备中':'待准备',attempt:meta.attempt,retryAt:meta.retryAt,staleReason:meta.staleReason??null}:null;
 }
 reconcile(now:string):void{
 const existing=this.d.environmentStore.firstActiveBatch();
 if(existing&&(existing.timezone!==this.d.config.timezone||existing.localDate!==localDate(now,existing.timezone)))ensureEnvironmentBatch(this.d.storage,this.d.config,now);
 const active=this.active;if(!active)return;
 const batch=this.d.environmentStore.batch(active.batchId);
 if(!batch||batch.status!=='active'||batch.timezone!==this.d.config.timezone||batch.localDate!==localDate(now,batch.timezone)){
 active.controller.abort(new DOMException('Environment batch expired','AbortError'));
 ensureEnvironmentBatch(this.d.storage,this.d.config,now);
 }
 }
 nextMidnight():string|null{
 if(!this.active)return null;
 const batch=this.d.environmentStore.batch(this.active.batchId);
 return batch?nextEnvironmentDate(this.d.clock.now(),batch.timezone,'00:00'):null;
 }
 private canPublish(execution:Execution):EnvironmentStep|null{
 if(this.stopped||this.active?.lease!==execution.lease||execution.controller.signal.aborted)return null;
 const step=this.d.environmentStore.step(execution.stepId);
 if(!step||step.status!=='running'||step.preparationGeneration!==execution.generation)return null;
 const batch=this.d.environmentStore.batch(step.batchId);
 if(!batch||batch.status!=='active'||batch.timezone!==this.d.config.timezone||batch.localDate!==localDate(this.d.clock.now(),batch.timezone))return null;
 return step;
 }
 private guarded(execution:Execution,fn:(step:EnvironmentStep)=>void):void{
 this.d.storage.transaction(()=>{const step=this.canPublish(execution);if(!step){execution.controller.abort(new DOMException('Environment lease ended','AbortError'));throw execution.controller.signal.reason;}fn(step);});
 }
 startOne(stepId:string,now:string):boolean{
 if(this.stopped||this.active)return false;
 const d=this.d;
 let step=d.environmentStore.step(stepId);
 if(!step||step.preparationVersion!==1||!['pending','running'].includes(step.status)||step.retryAt&&milliseconds(step.retryAt)>milliseconds(now))return false;
 if(selectEnvironmentStepMetadata(d.storage,now)?.id!==stepId)return false;
 if(!d.web)throw Error('Async environment requires persistent WebSearchService, including disabled providers');
 const batch=d.environmentStore.batch(step.batchId)!;
 if(batch.timezone!==d.config.timezone||localDate(now,batch.timezone)!==batch.localDate)return false;
 if(!d.generateEnvironment)throw Error('environment generator not assembled');
 // Restore the same input/generation/attempt after stop; new attempts only clear format repair.
 step=d.storage.transaction(()=>{
 let current=d.environmentStore.step(stepId)!;
 if(current.preparationSnapshot&&(current.preparationSnapshot.businessBasis!==environmentBusinessBasis(d,current.stage)||!lookupBasisCurrent(d,current.preparationSnapshot))){
 this.invalidate(current,now,'frozen preparation basis changed before restart');return d.environmentStore.step(stepId)!;
 }
 if(!current.preparationSnapshot){const snapshot=freezeEnvironmentSnapshot(d,current,now);current={...current,preparationSnapshot:snapshot,inputSnapshot:snapshot.input,preparationGeneration:current.preparationGeneration??1};}
 const ref=d.web!.store.openStage('environment',current.id,'generation',current.stage),cp=d.web!.store.snapshot(ref.runId).checkpoint;
 if(current.status!=='running'&&cp){cp.repairCount=0;delete cp.repair;d.web!.store.saveCheckpoint(ref.runId,cp);}
 current={...current,status:'running',attempt:current.attempt+(current.status==='running'?0:1),startedAt:current.startedAt??now,retryAt:null};
 d.environmentStore.saveStep(current);return current;
 });
 if(step.status!=='running')return false;
 const execution:Execution={stepId,batchId:step.batchId,generation:step.preparationGeneration!,lease:Symbol(),controller:new AbortController(),promise:Promise.resolve()};
 this.active=execution;execution.promise=this.prepare(execution,step,d.generateEnvironment).catch(error=>{if(!this.stopped&&!execution.controller.signal.aborted)this.errors.push(error);}).finally(()=>{if(this.active?.lease===execution.lease)this.active=null;this.options.onReady?.();});
 return true;
 }
 private async prepare(execution:Execution,step:EnvironmentStep,generate:EnvironmentGenerator):Promise<void>{
 const d=this.d,snapshot=step.preparationSnapshot!,signal=execution.controller.signal;
 const ref=d.web!.store.openStage('environment',step.id,'generation',step.stage),session=d.web!.openSession(ref,()=>{if(!this.canPublish(execution)){execution.controller.abort(new DOMException('Environment lease ended','AbortError'));throw execution.controller.signal.reason;}});
 let usedBasis:typeof snapshot.usedBasis=null;
 const options:ModelRunOptions={signal,runRef:ref,lookup:async(request:LookupRequest)=>{
 const result=await lookupFrozenEnvironment(snapshot,request,retrievalFor(d),signal);signal.throwIfAborted();usedBasis=result.usedBasis;return result.context;
 },web:{...session,searchAndRead:(request,operation)=>{signal.throwIfAborted();return session.searchAndRead(request,{...operation,signal});},readPage:(url,operation)=>{signal.throwIfAborted();return session.readPage(url,{...operation,signal});},saveCheckpoint:cp=>this.guarded(execution,current=>{
 session.saveCheckpoint(cp);
 if(usedBasis&&!cp.lookupPending)d.environmentStore.saveStep({...current,preparationSnapshot:{...current.preparationSnapshot!,usedBasis}});
 })}};
 try{
 const input=snapshot.input;
 const empty=input.stage==='school_week'&&input.modelContractVersion===1&&(input.context as import('../school/types').SchoolExpansionInput).requiredNoticeKeys.length===0;
 const raw=empty?{stage:'school_week' as const,noticeTexts:[],weekNotes:[]}:await generate(input,{signal,modelOptions:options,schoolView:frozenSchoolView(snapshot)});
 signal.throwIfAborted();
 if(raw.stage!==step.stage)throw new ModelFormatError('environment result stage mismatch');
 const result=resolveResult(d,raw,input,frozenSchoolView(snapshot),snapshot.at);
 this.guarded(execution,current=>d.environmentStore.saveStep({...current,status:'ready',frozenResult:result,lastError:null}));
 }catch(error){
 if(signal.aborted||this.stopped)return;
 const current=this.canPublish(execution);if(!current)return;
 if(error instanceof ModelRequestError||error instanceof ModelFormatError){
 this.guarded(execution,s=>d.environmentStore.saveStep({...s,status:'pending',retryAt:addMs(d.clock.now(),d.config.environmentRetryMs),lastError:error.message}));
 }else if(error instanceof Error&&error.message==='frozen retrieval configuration changed'){
 this.guarded(execution,s=>this.invalidate(s,d.clock.now(),error.message));
 }else{this.errors.push(error);}
 }
 }
 private invalidate(step:EnvironmentStep,now:string,reason:string):void{
 const ref=this.d.web?.store.openStage('environment',step.id,'generation',step.stage),cp=ref?this.d.web!.store.snapshot(ref.runId).checkpoint:null;
 if(cp){cp.repairCount=0;delete cp.repair;delete cp.privateLookupResult;if(cp.lookupUsed&&cp.lookupRequest)cp.lookupPending=true;this.d.web!.store.saveCheckpoint(ref!.runId,cp);}
 this.d.environmentStore.saveStep({...step,status:'pending',retryAt:addMs(now,this.d.config.environmentRetryMs),preparationGeneration:(step.preparationGeneration??1)+1,preparationSnapshot:null,inputSnapshot:null,frozenResult:null,staleReason:reason});
 }
 applyReady(stepId:string,now:string):'applied'|'stale'|'none'{
 const d=this.d;
 const original=d.environmentStore.step(stepId),originalBatch=original?d.environmentStore.batch(original.batchId):null;
 if(originalBatch?.status==='active'&&(originalBatch.timezone!==d.config.timezone||originalBatch.localDate!==localDate(now,originalBatch.timezone))){ensureEnvironmentBatch(d.storage,d.config,now);return 'stale';}
 let outcome:'applied'|'stale'|'none'='none';
 d.storage.transaction(()=>{
 const step=d.environmentStore.step(stepId);if(!step||step.status!=='ready'||step.preparationVersion!==1)return;
 const batch=d.environmentStore.batch(step.batchId);
 if(!batch||batch.status!=='active'||batch.timezone!==d.config.timezone||batch.localDate!==localDate(now,batch.timezone)){outcome='stale';return;}
 if(selectEnvironmentStepMetadata(d.storage,now)?.id!==stepId)return;
 const snapshot=step.preparationSnapshot!;
 let reason=snapshot.businessBasis!==environmentBusinessBasis(d,step.stage)?'environment business basis changed':!lookupBasisCurrent(d,snapshot)?'used lookup basis changed':null;
 if(!reason&&step.frozenResult?.stage!=='world'&&step.frozenResult?.stage!=='school_week')for(const item of step.frozenResult?.items??[]){
 const old=d.storage.read('school_plan_items',item.id);if(old&&milliseconds(old.issuedAt)<=milliseconds(now)&&milliseconds(item.issuedAt)>milliseconds(now))reason='already issued item cannot be hidden at commit';
 }
 if(reason){this.invalidate(step,now,reason);outcome='stale';return;}
 commitEnvironmentResult(d,step,now);outcome='applied';
 });
 if((outcome as string)==='applied'){d.web?.releaseOwner('environment',stepId);d.web?.compactOwnerCheckpoint('environment',stepId);}
 return outcome;
 }
 async wait():Promise<void>{await this.active?.promise;}
 async stop():Promise<void>{this.stopped=true;this.active?.controller.abort(new DOMException('Environment stopped','AbortError'));await this.active?.promise;}
}
