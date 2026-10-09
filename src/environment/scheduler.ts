import {EnvironmentStore} from './store';
import type {Storage} from '../storage';
import type {AppConfig} from '../config';
import {addMs,due,localParts,localTime,milliseconds} from '../time';
import {environmentStages,type EnvironmentBatch,type EnvironmentStep,type EnvironmentStepMetadata} from './types';
export function localDate(at:string,timezone:string):string {const p=localParts(at,timezone);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;}
export function batchIdentity(date:string,timezone:string){return JSON.stringify([timezone,date]);}
export function nextEnvironmentDate(at:string,timezone:string,clock:string):string {const p=localParts(at,timezone),[h,m]=clock.split(':').map(Number);return localTime(p.year,p.month,p.day+1,h*60+m,timezone);}
export function ensureEnvironmentBatch(storage:Storage,config:AppConfig,now:string):EnvironmentBatch|null {
 const r=storage.runtime();if(r.environmentPlanningVersion!==1&&r.environmentPlanningVersion!==2)return null;
 const date=localDate(now,config.timezone),id=batchIdentity(date,config.timezone);
 const store=new EnvironmentStore(storage);
 const existing=storage.read('environment_batches',id);
 const stale=store.activeBatches().filter(b=>b.timezone!==config.timezone||b.localDate!==localDate(now,b.timezone));
 return storage.transaction(()=>{
  for(const old of stale){storage.save('environment_batches',old.id,{...old,status:'superseded',closedAt:now});for(const meta of store.stepMetadata(old.id).filter(s=>s.status!=='committed')){const step=store.step(meta.id)!;storage.save('environment_steps',step.id,{...step,status:'superseded',completedAt:now});}}
  if(existing){
   // A terminal identity is never reopened; reconcile its next local entry so
   // returning to an earlier timezone cannot leave an unexecutable deadline.
   if(existing.status!=='active'){const next=nextEnvironmentDate(now,config.timezone,config.environmentDailyAt);if(r.nextEnvironmentAt!==next)storage.set('runtime',{...r,nextEnvironmentAt:next});}
   return existing;
  }
  const p=localParts(now,config.timezone),[h,m]=config.environmentDailyAt.split(':').map(Number);
  // Last inserted batch preserves prior configured timezone after completion.
  const latest=store.latestBatch();
  const scheduledAt=localTime(p.year,p.month,p.day,h*60+m,config.timezone),changedTimezone=!!latest&&latest.timezone!==config.timezone;
  if(r.nextEnvironmentAt){
   const entryDue=changedTimezone||due(r.nextEnvironmentAt,now);
   if(entryDue&&!due(scheduledAt,now)){storage.set('runtime',{...r,nextEnvironmentAt:scheduledAt});return null;}
   if(!entryDue)return null;
  }
  const batch:EnvironmentBatch={id,localDate:date,timezone:config.timezone,scheduledAt,createdAt:now,reason:r.nextEnvironmentAt?'daily':'bootstrap',status:'active',closedAt:null};
  storage.save('environment_batches',id,batch);
  for(const stage of environmentStages){const step:EnvironmentStep={id:JSON.stringify([id,stage]),batchId:id,stage,status:'pending',attempt:0,startedAt:null,completedAt:null,retryAt:null,lastError:null,inputSnapshot:null,frozenResult:null,...(r.environmentPlanningVersion===2?{preparationVersion:1 as const}:{})};storage.save('environment_steps',step.id,step);}
  storage.set('runtime',{...r,nextEnvironmentAt:nextEnvironmentDate(now,config.timezone,config.environmentDailyAt)});return batch;
 });
}
export function selectEnvironmentStepMetadata(storage:Storage,now:string):EnvironmentStepMetadata|null {
 const store=new EnvironmentStore(storage),batch=store.firstActiveBatch();if(!batch)return null;
 const steps=store.stepMetadata(batch.id);
 for(const stage of environmentStages){const step=steps.find(s=>s.batchId===batch.id&&s.stage===stage)!;if(step.status==='committed')continue;return step.status==='superseded'||step.retryAt&&!due(step.retryAt,now)?null:step;}
 return null;
}
export function selectEnvironmentStep(storage:Storage,now:string):EnvironmentStep|null {const meta=selectEnvironmentStepMetadata(storage,now);return meta?new EnvironmentStore(storage).step(meta.id):null;}
export function environmentDeadline(storage:Storage,now:string,options:{environmentInFlightStepId?:string|null}={}):string|null {
 const runtime=storage.runtime();if(runtime.environmentPlanningVersion!==1&&runtime.environmentPlanningVersion!==2)return null;
 const store=new EnvironmentStore(storage),batch=store.firstActiveBatch(),steps=batch?store.stepMetadata(batch.id):[];
 const step=batch?environmentStages.map(stage=>steps.find(s=>s.stage===stage)!).find(s=>s.status!=='committed'&&s.status!=='superseded'):null;
 const blocked=!!options.environmentInFlightStepId&&step?.preparationVersion===1&&step.status!=='ready';
 const midnight=batch&&options.environmentInFlightStepId?nextEnvironmentDate(now,batch.timezone,'00:00'):null;
 const deadlines=[runtime.nextEnvironmentAt,step&&!blocked?(step.retryAt??now):null,midnight].filter((v):v is string=>!!v);
 return deadlines.sort((a,b)=>milliseconds(a)-milliseconds(b))[0]??(batch?null:now);
}
