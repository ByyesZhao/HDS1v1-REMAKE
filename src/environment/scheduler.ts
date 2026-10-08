import type {Storage} from '../storage';
import type {AppConfig} from '../config';
import {addMs,due,localParts,localTime,milliseconds} from '../time';
import {environmentStages,type EnvironmentBatch,type EnvironmentStep} from './types';
export function localDate(at:string,timezone:string):string {const p=localParts(at,timezone);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;}
export function batchIdentity(date:string,timezone:string){return JSON.stringify([timezone,date]);}
export function nextEnvironmentDate(at:string,timezone:string,clock:string):string {const p=localParts(at,timezone),[h,m]=clock.split(':').map(Number);return localTime(p.year,p.month,p.day+1,h*60+m,timezone);}
export function ensureEnvironmentBatch(storage:Storage,config:AppConfig,now:string):EnvironmentBatch|null {
 const r=storage.runtime();if(r.environmentPlanningVersion!==1)return null;
 const date=localDate(now,config.timezone),id=batchIdentity(date,config.timezone);
 const batches=storage.all('environment_batches');
 const existing=storage.read('environment_batches',id);
 const stale=batches.filter(b=>b.status==='active'&&(b.timezone!==config.timezone||b.localDate!==localDate(now,b.timezone)));
 return storage.transaction(()=>{
  for(const old of stale){storage.save('environment_batches',old.id,{...old,status:'superseded',closedAt:now});for(const step of storage.all('environment_steps').filter(s=>s.batchId===old.id&&s.status!=='committed'))storage.save('environment_steps',step.id,{...step,status:'superseded',completedAt:now});}
  if(existing){
   // A terminal identity is never reopened; reconcile its next local entry so
   // returning to an earlier timezone cannot leave an unexecutable deadline.
   if(existing.status!=='active'){const next=nextEnvironmentDate(now,config.timezone,config.environmentDailyAt);if(r.nextEnvironmentAt!==next)storage.set('runtime',{...r,nextEnvironmentAt:next});}
   return existing;
  }
  const p=localParts(now,config.timezone),[h,m]=config.environmentDailyAt.split(':').map(Number);
  // Storage.all is ordered by insertion; the latest recorded batch also tells
  // us the prior configured timezone after it has completed.
  const scheduledAt=localTime(p.year,p.month,p.day,h*60+m,config.timezone),changedTimezone=!!batches.length&&batches.at(-1)!.timezone!==config.timezone;
  if(r.nextEnvironmentAt){
   const entryDue=changedTimezone||due(r.nextEnvironmentAt,now);
   if(entryDue&&!due(scheduledAt,now)){storage.set('runtime',{...r,nextEnvironmentAt:scheduledAt});return null;}
   if(!entryDue)return null;
  }
  const batch:EnvironmentBatch={id,localDate:date,timezone:config.timezone,scheduledAt,createdAt:now,reason:r.nextEnvironmentAt?'daily':'bootstrap',status:'active',closedAt:null};
  storage.save('environment_batches',id,batch);
  for(const stage of environmentStages){const step:EnvironmentStep={id:JSON.stringify([id,stage]),batchId:id,stage,status:'pending',attempt:0,startedAt:null,completedAt:null,retryAt:null,lastError:null,inputSnapshot:null,frozenResult:null};storage.save('environment_steps',step.id,step);}
  storage.set('runtime',{...r,nextEnvironmentAt:nextEnvironmentDate(now,config.timezone,config.environmentDailyAt)});return batch;
 });
}
export function selectEnvironmentStep(storage:Storage,now:string):EnvironmentStep|null {
 const batch=storage.all('environment_batches').find(b=>b.status==='active');if(!batch)return null;
 const steps=storage.all('environment_steps');
 for(const stage of environmentStages){const step=steps.find(s=>s.batchId===batch.id&&s.stage===stage)!;if(step.status==='committed')continue;return step.status==='superseded'||step.retryAt&&!due(step.retryAt,now)?null:step;}
 return null;
}
export function environmentDeadline(storage:Storage,now:string):string|null {
 if(storage.runtime().environmentPlanningVersion!==1)return null;
 const batch=storage.all('environment_batches').find(b=>b.status==='active');
 const step=batch?environmentStages.map(stage=>storage.all('environment_steps').find(s=>s.batchId===batch.id&&s.stage===stage)!).find(s=>s.status!=='committed'&&s.status!=='superseded'):null;
 const deadlines=[storage.runtime().nextEnvironmentAt,step?(step.retryAt??now):null].filter((v):v is string=>!!v);
 return deadlines.sort((a,b)=>milliseconds(a)-milliseconds(b))[0]??(batch?null:now);
}
