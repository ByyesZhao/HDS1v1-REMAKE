import type {ModelRunner} from '../types';
import {isStageModelInput} from '../model/context-types';
import type {StageModelInput,PromptStage} from '../model/context-types';
import {stageInput} from '../model/context-views';
import type {PreparedAttachment} from './types';
import type {IncomingMediaService} from './service';
export function hydrateVisualContext(input:StageModelInput,confirmed:PreparedAttachment[],frozen:PreparedAttachment[]):StageModelInput{
 const result=structuredClone(input),byAttachment=new Map(confirmed.map(e=>[e.attachmentId,e]));for(const e of frozen)byAttachment.set(e.attachmentId,e);
 const bodies=new Map<string,NonNullable<StageModelInput['resources']['visualObservations']>[number]>();
 result.resources.messages=result.resources.messages.map(m=>{
  const entries=[...byAttachment.values()].filter(e=>e.messageId===m.id).sort((a,b)=>a.order-b.order);
  if(!entries.length)return m;
  for(const e of entries)if(e.status==='ready'&&e.observationRef&&e.recognizerVersion&&e.observation)bodies.set(e.observationRef,{ref:e.observationRef,recognizerVersion:e.recognizerVersion,observation:e.observation});
  return {...m,visualAttachments:entries.map(({attachmentId,order,status,observationRef})=>({attachmentId,order,status,observationRef}))};
 });
 result.resources.visualObservations=[...bodies.values()];return result;
}
export function withTurnVisualContext(models:ModelRunner,media:IncomingMediaService|undefined,turnId:string):ModelRunner{
 if(!media)return models;
 return {async runModel(task,input,options){
  const stage=task.name as PromptStage,allowed=stage==='narrative'||stage==='narrative_shared'||stage.startsWith('personal_')||stage==='expression'||stage==='memory';
  if(!allowed)return models.runModel(task,input,options);
  const hydrate=(view:StageModelInput)=>hydrateVisualContext(view,media.readConfirmedForMessages(view.resources.messages.map(m=>m.id)),media.readFrozenForTurn(turnId));
  const view=hydrate(isStageModelInput(input)?input:stageInput(stage,input));
  const lookup=options?.lookup;
  return models.runModel(task,view,lookup?{...options,lookup:async q=>hydrate(stageInput(stage,await lookup(q)))}:options);
 }};
}
