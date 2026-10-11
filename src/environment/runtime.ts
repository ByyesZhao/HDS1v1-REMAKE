import {EnvironmentPreparation} from './preparation';
import {compactTerminalEnvironmentStep} from './payload-compaction';
import {randomUUID} from 'node:crypto';
import type {Dependencies} from '../app';
import {ModelFormatError,ModelRequestError} from '../model/client';
import {addMs} from '../time';
import {ensureEnvironmentBatch,localDate} from './scheduler';
import {resolveSchoolUpstream,applySchoolChanges} from '../school/changes';
import {schoolExpansionInput,resolveSchoolWeek,resolveSchoolWeekText} from '../school/calendar';
import type {EnvironmentChangeSet,EnvironmentGenerator,EnvironmentModelResult,EnvironmentStep,EnvironmentStepInput} from './types';
export function environmentInput(d:Dependencies,step:EnvironmentStep):EnvironmentStepInput {
 if(step.stage==='school_week')return {stage:step.stage,batchId:step.batchId,at:d.clock.now(),modelContractVersion:1,context:{...schoolExpansionInput(d.storage,d.clock.now(),d.config.timezone),appointments:d.storage.pendingTasks().filter(t=>t.kind==='appointment'),timezone:d.config.timezone}};
 const owner=step.stage==='school_campus'?'campus':step.stage==='school_group'?'group':null;
 return {stage:step.stage,batchId:step.batchId,at:d.clock.now(),modelContractVersion:1,context:{background:d.config.background,...(d.config.backgroundViews?{backgroundViews:d.config.backgroundViews}:{}),worldSetting:d.config.worldSetting,schoolSetting:d.config.schoolSetting,timezone:d.config.timezone,events:d.storage.all('events').filter(e=>e.status==='active'&&e.kind==='world'),plans:d.schoolStore.plans().filter(p=>!owner||p.owner===owner),items:d.schoolStore.items().filter(i=>!owner||i.owner===owner),...(step.stage==='school_group'?{progress:d.schoolStore.progress(),campusTiming:d.schoolStore.items().filter(i=>i.owner==='campus').map(i=>({id:i.id,title:i.title,timing:i.timing}))}:{})}};
}
export function resolveResult(d:Dependencies,result:EnvironmentModelResult,input:EnvironmentStepInput,view:import('../school/read-view').SchoolReadView=d.storage,at=d.clock.now()):EnvironmentChangeSet {
 if(result.stage==='world')return {...result,changes:result.changes.map(c=>c.action==='create'?{...c,id:randomUUID()}:c)};
 if(result.stage==='school_week'){
  if(input.modelContractVersion===1)return resolveSchoolWeekText(view,result as import('./types').SchoolWeekTextResult,input.context as import('../school/types').SchoolExpansionInput,at);
  if('noticeTexts' in result)throw new ModelFormatError('version0 requires legacy week candidate');
  return resolveSchoolWeek(view,result,input.context as import('../school/types').SchoolExpansionInput,at);
 }
 return resolveSchoolUpstream(view,result,at);
}
export async function runEnvironmentStep(d:Dependencies,stepId:string,generate:EnvironmentGenerator):Promise<void> {
 const selected=d.environmentStore.step(stepId)!;
 if(selected.preparationVersion===1){const preparation=new EnvironmentPreparation({...d,generateEnvironment:generate});if(selected.status!=='ready'){preparation.startOne(stepId,d.clock.now());await preparation.wait();const error=preparation.takeError();if(error)throw error;}preparation.applyReady(stepId,d.clock.now());return;}
 let step=selected;const batch=d.environmentStore.batch(step.batchId)!;
 if(step.status==='committed'||step.status==='superseded')return;
 if(localDate(d.clock.now(),batch.timezone)!==batch.localDate){ensureEnvironmentBatch(d.storage,d.config,d.clock.now());return;}
 if(step.status!=='ready'){
  const isNew=step.status!=='running';
  if(isNew&&step.attempt>0&&d.web){const ref=d.web.store.openStage('environment',step.id,'generation',step.stage),cp=d.web.store.checkpoint(ref.runId);if(cp){cp.repairCount=0;delete cp.repair;d.web.store.saveCheckpoint(ref.runId,cp);}}
  step={...step,status:'running',attempt:step.attempt+(isNew?1:0),startedAt:step.startedAt??d.clock.now(),retryAt:null,inputSnapshot:step.inputSnapshot??environmentInput(d,step)};
  d.environmentStore.saveStep(step);
  let frozen:EnvironmentChangeSet;
  try{const input=step.inputSnapshot!,emptyWeek=input.stage==='school_week'&&input.modelContractVersion===1&&(input.context as import('../school/types').SchoolExpansionInput).requiredNoticeKeys.length===0;const raw:EnvironmentModelResult=emptyWeek?{stage:'school_week',noticeTexts:[],weekNotes:[]}:await generate(input);if(raw.stage!==step.stage)throw new ModelFormatError('environment result stage mismatch');frozen=resolveResult(d,raw,step.inputSnapshot!);}catch(error){
   if(!(error instanceof ModelFormatError||error instanceof ModelRequestError))throw error;
   if(localDate(d.clock.now(),batch.timezone)!==batch.localDate){ensureEnvironmentBatch(d.storage,d.config,d.clock.now());return;}
   d.environmentStore.saveStep({...step,status:'pending',retryAt:addMs(d.clock.now(),d.config.environmentRetryMs),lastError:error.message});return;
  }
  step={...step,status:'ready',frozenResult:frozen};d.environmentStore.saveStep(step);
 }
 if(localDate(d.clock.now(),batch.timezone)!==batch.localDate){ensureEnvironmentBatch(d.storage,d.config,d.clock.now());d.web?.releaseOwner('environment',step.id);return;}
 d.storage.transaction(()=>{
  commitEnvironmentResult(d,step,d.clock.now());
 });
 d.web?.releaseOwner('environment',step.id);
 d.web?.compactOwnerCheckpoint('environment',step.id);
}

export function commitEnvironmentResult(d:Dependencies,step:EnvironmentStep,now:string):void {
 const batch=d.environmentStore.batch(step.batchId)!;
  const result=step.frozenResult!;
  if(result.stage==='world')for(const change of result.changes){if(change.action==='create')d.storage.save('events',change.id!,{...change.event,id:change.id!,status:'active'});else{const old=d.storage.read('events',change.id);if(!old)throw Error('unknown world event');d.storage.save('events',change.id,change.action==='cancel'?{...old,status:'cancelled'}:{...old,...change.event});}}
  else applySchoolChanges(d.storage,result,now);
  const committed:EnvironmentStep={...step,status:'committed',completedAt:now,lastError:null};
  d.environmentStore.saveStep(compactTerminalEnvironmentStep(committed,now)??committed);
  if(d.environmentStore.stepMetadata(batch.id).every(s=>s.status==='committed'))d.environmentStore.saveBatch({...batch,status:'committed',closedAt:now});
}
