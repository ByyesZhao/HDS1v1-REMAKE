import {randomUUID} from 'node:crypto';
import type {Dependencies} from '../app';
import {ModelFormatError,ModelRequestError} from '../model/client';
import {addMs} from '../time';
import {ensureEnvironmentBatch,localDate} from './scheduler';
import type {EnvironmentChangeSet,EnvironmentGenerator,EnvironmentModelResult,EnvironmentStep,EnvironmentStepInput} from './types';
export function environmentInput(d:Dependencies,step:EnvironmentStep):EnvironmentStepInput {
 return {stage:step.stage,batchId:step.batchId,at:d.clock.now(),context:{background:d.config.background,worldSetting:d.config.worldSetting,schoolSetting:d.config.schoolSetting,timezone:d.config.timezone,events:d.storage.all('events').filter(e=>e.status==='active'),plans:d.schoolStore.plans(),items:d.schoolStore.items(),instances:d.schoolStore.instances(),notices:d.schoolStore.notices(),progress:d.schoolStore.progress()}};
}
function resolveResult(result:EnvironmentModelResult):EnvironmentChangeSet {
 if(result.stage==='world')return {...result,changes:result.changes.map(c=>c.action==='create'?{...c,id:randomUUID()}:c)};
 if(result.stage==='school_week'){if(result.instanceChanges.length||result.noticeCandidates.length||result.weekChanges.length)throw new ModelFormatError('school week resolver not assembled');return {stage:result.stage,instances:[],notices:[],weeks:[]};}
 if(result.planChanges.length||result.itemChanges.length)throw new ModelFormatError('school upstream resolver not assembled');
 return {stage:result.stage,plans:[],items:[]};
}
export async function runEnvironmentStep(d:Dependencies,stepId:string,generate:EnvironmentGenerator):Promise<void> {
 let step=d.environmentStore.step(stepId)!;const batch=d.environmentStore.batch(step.batchId)!;
 if(step.status==='committed'||step.status==='superseded')return;
 if(localDate(d.clock.now(),batch.timezone)!==batch.localDate){ensureEnvironmentBatch(d.storage,d.config,d.clock.now());return;}
 if(step.status!=='ready'){
  const isNew=step.status!=='running';
  if(isNew&&step.attempt>0&&d.web){const ref=d.web.store.openStage('environment',step.id,'generation',step.stage),cp=d.web.store.snapshot(ref.runId).checkpoint;if(cp){cp.repairCount=0;delete cp.repair;d.web.store.saveCheckpoint(ref.runId,cp);}}
  step={...step,status:'running',attempt:step.attempt+(isNew?1:0),startedAt:step.startedAt??d.clock.now(),retryAt:null,inputSnapshot:step.inputSnapshot??environmentInput(d,step)};
  d.environmentStore.saveStep(step);
  let raw:EnvironmentModelResult;
  try{raw=await generate(step.inputSnapshot!);}catch(error){
   if(!(error instanceof ModelFormatError||error instanceof ModelRequestError))throw error;
   if(localDate(d.clock.now(),batch.timezone)!==batch.localDate){ensureEnvironmentBatch(d.storage,d.config,d.clock.now());return;}
   d.environmentStore.saveStep({...step,status:'pending',retryAt:addMs(d.clock.now(),d.config.environmentRetryMs),lastError:error.message});return;
  }
  if(raw.stage!==step.stage)throw new ModelFormatError('environment result stage mismatch');
  step={...step,status:'ready',frozenResult:resolveResult(raw)};d.environmentStore.saveStep(step);
 }
 if(localDate(d.clock.now(),batch.timezone)!==batch.localDate){ensureEnvironmentBatch(d.storage,d.config,d.clock.now());d.web?.releaseOwner('environment',step.id);return;}
 d.storage.transaction(()=>{
  const result=step.frozenResult!;
  if(result.stage==='world')for(const change of result.changes){if(change.action==='create')d.storage.save('events',change.id!,{...change.event,id:change.id!,status:'active'});else{const old=d.storage.read('events',change.id);if(!old)throw Error('unknown world event');d.storage.save('events',change.id,change.action==='cancel'?{...old,status:'cancelled'}:{...old,...change.event});}}
  d.environmentStore.saveStep({...step,status:'committed',completedAt:d.clock.now(),lastError:null});
  if(d.environmentStore.steps(batch.id).every(s=>s.status==='committed'))d.environmentStore.saveBatch({...batch,status:'committed',closedAt:d.clock.now()});
 });
 d.web?.releaseOwner('environment',step.id);
}
