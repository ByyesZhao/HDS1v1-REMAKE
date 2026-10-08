import {Storage} from '../storage';
import {MemoryStore} from '../memory/store';
import {ModelClient,ChatCompletionsTransport} from '../model/client';
import {isStageModelInput} from '../model/context-types';
import {buildCompletionEnvelope} from '../model/resource-pool';
import {schoolExpansionInput,schoolWeekTextInput,resolveSchoolWeekText} from '../school/calendar';
import {schoolWeekTextTask} from '../school/contracts';
import {stageInput} from '../model/context-views';
import {runExpression} from '../output/expression';
import {runPersonal} from '../directors/personal';
import {defaultConfig,initialCharacter} from '../config';
import type {AppConfig,ModelConnection} from '../config';
import type {SchoolPlanItem} from '../school/types';
// Deliberately synthetic school and mutable fact fixtures. No formal messages, database, image or QQ path.
export async function validatePromptQuality(options:{config?:AppConfig;connectionFor?:(task:string)=>ModelConnection;timeoutMs?:number;expressionOnly?:boolean}={}){
 const storage=new Storage(':memory:'),at='2026-10-08T06:00:00+08:00',config={...defaultConfig,...options.config};let networkRequests=0;
 const measures:Array<{task:string;inputCharacters:number;repair:boolean}>=[];
 try{
  const transport=options.connectionFor?new ChatCompletionsTransport(options.connectionFor):null;
  const models=new ModelClient({complete:async(request,opts)=>{
   measures.push({task:request.task.name,inputCharacters:JSON.stringify(buildCompletionEnvelope(request)).length,repair:!!request.repair});
   if(transport){networkRequests++;const timeout=AbortSignal.timeout(options.timeoutMs??300000);return transport.complete(request,{signal:opts?.signal?AbortSignal.any([timeout,opts.signal]):timeout});}
   const c=isStageModelInput(request.input)?request.input.context:{};
   if(request.task.name==='expression'){const intent=c.intent as {draft:string;actions?:string[]};return {parts:[{kind:'text',content:intent.draft},...(intent.actions??[]).map(content=>({kind:'action',content}))]};}
   if(request.task.name==='school_week')return {stage:'school_week',noticeTexts:(c.notices as ReturnType<typeof schoolWeekTextInput>['notices']).map(n=>({key:n.key,text:n.occurrence?`活动在${n.occurrence.startsAt}于${n.occurrence.location}开始。`:'本周安排已公布。'})),weekNotes:[]};
   if(request.task.name==='personal_shared')return {emotions:[],reply:{decision:'now',intention:'回应当前纠正',draft:'好，那按你还在店外继续，前面的记录保留。'},taskChanges:[]};
   if(request.task.name==='personal_chat')return {emotions:[],reply:{decision:'now',intention:'自行协调',draft:'我先问导师能否调整时间，还没得到答复。'},taskChanges:[],nextPlan:'先咨询导师，不假定请假已获准'};
   throw Error('unknown quality fixture');
  }});
  const store=new MemoryStore(storage);store.migrate(at);const phone=store.makeOwner({ownerType:'detail',ownerId:'character.phone.model'},{key:'character.phone.model',value:'验收新机',content:'验收新机',aliases:['手机']},at);store.saveOwner(phone);
  const state=initialCharacter(at),history={recent:[],details:[phone],shortTerm:[],longTerm:[],learned:[],detailHistory:[]};
  const expressions=[];
  for(const mode of ['chat','shared_offline']){
   const intent={intention:'解释现状并约定联系',draft:'我今天不去实验室，明天上午十点联系你。手机已经换成验收新机了。',...(mode==='shared_offline'?{actions:['把水杯递给你']}:{})};
   const result=await runExpression(models,{intent,mode,state,history,chatExamples:config.chatExamples,style:config.backgroundViews?.style});expressions.push({mode,intent,result});
  }
  if(options.expressionOnly)return {scope:'isolated-synthetic-no-QQ',networkRequests,measures,expressions,notices:[],personalConflictDecision:null};
  const item:SchoolPlanItem={id:'isolated-course',planId:'isolated-semester',owner:'campus',kind:'course',title:'隔离科研方法课',description:'合成通知验收',location:'教一301',requirement:'optional',issuedAt:at,timing:{kind:'weekly',startsOn:'2026-10-01',endsOn:'2026-11-01',slots:[{slotKey:'thu',weekday:4,start:'14:00',end:'15:00'},{slotKey:'fri',weekday:5,start:'09:00',end:'10:00'}]},noticePolicy:{announceOnIssue:true,announceOnChange:true,reminders:[{kind:'minutes_before',offset:60,source:'institution'}]},revision:1,deliveryRevision:1,status:'open',basis:'fiction',sourceUrls:[]};
  storage.save('school_plan_items',item.id,item);const input=schoolExpansionInput(storage,at,config.timezone),descriptors=schoolWeekTextInput(input,config.timezone);
  const text=await models.runModel(schoolWeekTextTask(input),stageInput('school_week',{stage:'school_week',at,modelContractVersion:1,...descriptors}),{lookup:null});
  const changes=resolveSchoolWeekText(storage,text,input,at);if(changes.stage!=='school_week')throw Error('quality stage mismatch');
  const group={...item,id:'isolated-group-meeting',planId:'isolated-group',owner:'group' as const,kind:'meeting' as const,title:'合成课题组会',location:'组内会议室',timing:{kind:'once' as const,startsAt:'2026-10-09T09:00:00+08:00',endsAt:'2026-10-09T10:00:00+08:00'}};
  const message={id:'conflict-input',direction:'incoming' as const,content:'你明天九点有课，同时导师安排了组会，你自己决定怎么协调吧。',receivedAt:at,seenTurnId:null,turnId:null,outboxSeq:null,batchId:null,platformMessageIds:[]};
  const personalConflictDecision=await runPersonal(models,'chat',at,[],'chat',[message.id],{at,background:config.background,state,visibleMessages:[message],history,school:{knownSnapshots:[item,group].map(value=>({entityKind:'plan_item',entityId:value.id,revision:1,value}))}},{lookup:null});
  const correctionMessage={...message,id:'correction-input',content:'我刚才还在店外，没有进店；接下来按我这条继续，前面已发的记录保留。'};
  const correctionState={...state,scene:{...state.scene,mode:'shared_offline' as const,shared:{activityId:'synthetic-walk',title:'散步',progress:'经过店门',lastPublicNode:'你拿着纸袋从店里出来。',completedSteps:3,maxSteps:20,idleSeconds:60,outline:null,nextStepAt:null}}};
  const publicNarration='她停在店外，街边的灯已经亮了。';
  const sharedMeta:import('../types').SharedTurnMeta={activityId:'synthetic-walk',stepNumber:4,maxSteps:20,idleSeconds:60,advanceReason:'automatic',phase:'ongoing',controlRequestIds:[],sceneTaskId:'scene:synthetic-walk',allowSimulatedUserActions:false};
  const sharedCorrectionDecision=await runPersonal(models,'shared',at,[],'shared_offline',[correctionMessage.id],{at,background:config.background,state:correctionState,sharedMeta,publicNarration,visibleMessages:[correctionMessage],history},{lookup:null},sharedMeta,publicNarration);
  const insufficientMessage={...message,id:'insufficient-input',content:'你刚才查的周末活动结果不足，先别猜，可以问我想了解哪方面。'};
  const insufficientDecision=await runPersonal(models,'chat',at,[],'chat',[insufficientMessage.id],{at,background:config.background,state,visibleMessages:[insufficientMessage],history,externalSearchStatus:{status:'insufficient',materials:[]}},{lookup:null});
  return {scope:'isolated-synthetic-no-QQ',networkRequests,measures,expressions,sharedCorrectionDecision,insufficientDecision,notices:changes.notices.map(n=>({id:n.id,kind:n.kind,publishAt:n.publishAt,instanceId:n.instanceId,occurrenceKey:input.requiredNoticeKeys.find(k=>k.id===n.id)?.occurrenceKey??null,text:n.payload.text,descriptor:descriptors.notices.find(d=>d.key===n.id)})),personalConflictDecision};
 }finally{storage.close();}
}
