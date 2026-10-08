import {Storage} from '../storage';
import {HdsiApp} from '../app';
import {ChatEpisodes as DialogueEpisodes} from '../dialogue/chat-episodes';
import {DialogueStore} from '../dialogue/store';
import {EnvironmentStore} from '../environment/store';
import {SchoolStore} from '../school/store';
import {defaultConfig,initialCharacter} from '../config';
import type {AppConfig,ModelConnection} from '../config';
import {ModelClient,ChatCompletionsTransport} from '../model/client';
import type {CompletionRequest} from '../model/client';
import {buildCompletionEnvelope} from '../model/resource-pool';
import {isStageModelInput} from '../model/context-types';
import {Scheduler} from '../host/scheduler';
import {SerialHost} from '../host/runtime';
import {InputBuffer} from '../host/input';
import {MemoryStore} from '../memory/store';
import type {ModelRunner,SharedTurnMeta} from '../types';
export interface RequestMeasure {task:string;inputCharacters:number;messages:number;recentMessages:number;owners:number;materials:number;uniqueMessageIds:boolean;unreadExposed:boolean;allowSimulatedUserActions?:boolean;repair:boolean;ids:string[]}
function fixture(request:CompletionRequest):unknown {
 const input=isStageModelInput(request.input)?request.input.context:{};
 const narrative={experiences:[],currentScene:{description:'隔离验收：宿舍',activity:null},energy:{level:'正常',reason:'休息后'}};
 switch(request.task.name){
 case 'narrative':return narrative;
 case 'narrative_shared':return {...narrative,publicNarration:'两人来到路口，约好沿河边散步。',progress:'从路口开始',outline:{goal:'一起散步',openThreads:[],endingCondition:'走到河边后回去'},simulatedUserActions:[]};
 case 'personal_shared':return {emotions:[],reply:{decision:'none'},taskChanges:[]};
 case 'personal_life':return {emotions:[],innerThought:'先整理书桌',contact:{willing:false}};
 case 'personal_chat':return {emotions:[],reply:{decision:'now',intention:'回应约定',draft:'我明天上午十点再联系你，今天不去。'},taskChanges:[]};
 case 'expression':return {parts:[{kind:'text',content:(input.intent as {draft?:string})?.draft??'好的'}]};
 case 'memory':return {schemaVersion:3,shortTermChanges:[],longTermChanges:[],detailChanges:[]};
 default:throw Error('missing isolated fixture '+request.task.name);
 }
}
// Same serial host, synthetic history and virtual clock, with an intentional commit interruption.
export async function validateActivityFlow(options:{config?:AppConfig;connectionFor?:(task:string)=>ModelConnection;timeoutMs?:number}={}) {
 const storage=new Storage(':memory:');let at='2026-10-09T10:00:00+08:00',networkRequests=0,recoveryInjected=false,failure:string|null=null;
 const config={...defaultConfig,...options.config,stickersEnabled:false},chat=new DialogueEpisodes(new DialogueStore(storage)),store=new MemoryStore(storage),sent:string[]=[],calls:Array<{task:string;activityMessages:number;recentMessages:number;shortRecall:number;uniqueMessageIds:boolean;sourceIds:string[];ids:string[];repair:boolean}>=[],outputs:Array<{task:string;result:unknown}>=[];
 storage.set('character',initialCharacter(at));storage.set('runtime',{...storage.runtime(),nextEnvironmentAt:'2099-01-01T00:00:00Z'});store.migrate(at);
 for(let i=0;i<5;i++){const when=new Date(Date.parse(at)-(100-i*20)*60000).toISOString();storage.transaction(()=>chat.acceptMessage({id:`ordinary-${i}`,content:`普通历史${i}`,direction:'incoming',receivedAt:when,platformMessageIds:[],seenTurnId:'prior',turnId:null,outboxSeq:null,batchId:null}));}
 const state=storage.character();state.sleep=null;state.scene.mode='shared_offline';state.scene.shared={activityId:'flow-photo',title:'商场门口拍照',progress:'准备',lastPublicNode:'',completedSteps:0,maxSteps:3,idleSeconds:60,outline:null,nextStepAt:at};storage.set('character',state);storage.set('runtime',{...storage.runtime(),sharedClock:{activityId:'flow-photo',status:'active',mode:'shared_offline',startedAt:at,lastInputAt:null,lastOutputAt:null,lastSilentCompletedAt:null}});
 for(let i=0;i<35;i++)storage.transaction(()=>chat.acceptMessage({id:`activity-history-${i}`,content:i===0?'今天手机换成验收新机了':`测试活动背景${i}`,direction:'incoming',receivedAt:at,platformMessageIds:[],seenTurnId:'prior',turnId:null,outboxSeq:null,batchId:null,sharedActivityId:'flow-photo'}));
 const transport=options.connectionFor?new ChatCompletionsTransport(options.connectionFor):null;
 const client=new ModelClient({complete:async(request,runOptions)=>{
  const envelope=buildCompletionEnvelope(request),view=isStageModelInput(request.input)?request.input:undefined,context=view?.context??{},meta=context.sharedMeta as SharedTurnMeta|undefined;
  calls.push({task:request.task.name,activityMessages:view?.roles.currentActivityMessageIds?.length??0,recentMessages:view?.roles.recentIds?.length??0,shortRecall:view?.roles.shortRefs?.length??0,uniqueMessageIds:new Set(envelope.resources.messages.map(m=>m.id)).size===envelope.resources.messages.length,sourceIds:view?.roles.currentSourceIds??[],ids:envelope.resources.messages.map(m=>m.id),repair:!!request.repair});
  if(transport){networkRequests++;const timeout=AbortSignal.timeout(options.timeoutMs??300000);return transport.complete(request,{signal:runOptions?.signal?AbortSignal.any([timeout,runOptions.signal]):timeout});}
  if(request.task.name==='narrative_shared'){const action=meta?.allowSimulatedUserActions&&meta.phase!=='final'?'你走到吉祥物旁继续拍照。':null;const text=meta?.phase==='final'?'你们收好合照，约好下次再拍，本次活动结束。':action??'她在商场门口等你拍照，本轮刚刚开始。';return {experiences:[{description:'商场门口拍照',happenedAt:at,relatedEventIds:[]}],currentScene:{description:'商场门口',activity:null},energy:{level:'正常',reason:'散步'},publicNarration:text,progress:`拍照第${meta?.stepNumber}步`,outline:{goal:'商场门口拍照',openThreads:[],endingCondition:'收好照片回去'},simulatedUserActions:action?[action]:[]};}
  if(request.task.name==='personal_shared')return {emotions:[],reply:{decision:'none'},taskChanges:[],...(meta?.phase==='final'?{sharedChange:{action:'end'}}:{})};
  if(request.task.name==='memory'){const experience=(context.experiences as Array<{id:string}>|undefined)?.[0],source=experience?.id??view?.roles.currentSourceIds?.[0];return {schemaVersion:3,shortTermChanges:experience?[0,1].map(i=>({action:'create',clientRef:`photo-${i}`,content:i?'看到合照很开心':'在商场门口和吉祥物拍照，轻松',eventSummary:'商场拍照',feelingSummary:'开心',topics:['商场','拍照'],sourceIds:[source],importance:'normal'})):[],longTermChanges:[],detailChanges:[]};}
  return fixture(request);
 }});
 const models:ModelRunner={async runModel(task,input,opts){const result=await client.runModel(task,input,opts);outputs.push({task:task.name,result});return result;}};
 const dependencies={storage,chat,config,models,clock:{now:()=>at},environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),random:{next:()=>0.5},wait:async(ms:number)=>{at=new Date(Date.parse(at)+ms).toISOString();},sender:{sendError:async()=>{},sendItem:async(item:import('../types').OutboxItem)=>{sent.push(item.payload);return {platformMessageIds:[`flow-${sent.length}`]};}}};
 const app=new HdsiApp(dependencies),host=new SerialHost(app,{timers:false,onError:error=>{failure=error instanceof Error?error.message:String(error);}}),input=new InputBuffer(storage,undefined,undefined,chat),transaction=storage.transaction.bind(storage);
 storage.transaction=((fn:any)=>{const t=storage.unfinishedTurn();if(!recoveryInjected&&t?.frozenResult?.personal?.sharedChange?.action==='end'&&t.outputComplete&&storage.read('post_jobs',t.id)?.result){recoveryInjected=true;throw Error('isolated commit interruption');}return transaction(fn);}) as typeof storage.transaction;
 try{
  await input.acceptInput({id:'photo-action',content:'【动作：在商场门口的吉祥物处拍照】先等我拍完，别进店。',receivedAt:at});await host.start();
  while(storage.character().scene.shared&&!storage.runtime().paused){at=new Date(Date.parse(at)+60000).toISOString();await host.wake();}
  if(recoveryInjected&&storage.runtime().paused){await host.resume();if(!storage.runtime().paused)failure=null;}
  const rounds=storage.all('turns').filter(t=>t.sharedMeta&&t.done).length,before=calls.length;
  if(!failure&&!storage.character().scene.shared){at=new Date(Date.parse(at)+16*60000).toISOString();await host.acceptInput({id:'recall',content:'还记得商场吗？刚才拍照的感觉怎么样？',receivedAt:at});at=new Date(Date.parse(at)+15000).toISOString();await host.wake();}
  const normalCalls=calls.slice(before),normalPersonal=normalCalls.find(c=>c.task==='personal_chat');
  return {scope:'isolated-synthetic-no-QQ',requestTimeoutMs:options.timeoutMs??300000,networkRequests,embeddingRequests:0,failure,recoveryInjected,rounds,shortMemories:store.allOwners().filter(r=>r.kind==='short').length,nextNormalHasActivityFulltext:normalCalls.some(c=>c.activityMessages>0||c.ids.includes('activity-history-0')),nextNormalShortRecall:normalPersonal?.shortRecall??0,calls,outputs,sent};
 }finally{await host.stop();storage.close();}
}
// Isolated in-memory database, synthetic messages, recording sender; no production DB or QQ path.
export async function validatePromptContext(options:{config?:AppConfig;connectionFor?:(task:string)=>ModelConnection;timeoutMs?:number;recordResults?:boolean}={}) {
 const scenarios:Array<{name:string;done:boolean;calls:RequestMeasure[];sent:number;outputs?:Array<{task:string;result:unknown}>}>=[];let networkRequests=0;
 for(const name of ['normal','shared','life','empty']){
  let at='2026-10-08T10:00:00+08:00';const storage=new Storage(':memory:');
  try{
   const config={...defaultConfig,...options.config,stickersEnabled:false};storage.set('character',initialCharacter(at));storage.set('runtime',{...storage.runtime(),nextEnvironmentAt:'2099-01-01T00:00:00Z'});
   const dialogue=new DialogueEpisodes(new DialogueStore(storage),15);
   if(name!=='empty'){
    for(let group=0;group<5;group++){const count=group===4?40:1;const receivedAt=new Date(Date.parse(at)-(80-group*20)*60000-5*60000).toISOString();for(let n=0;n<count;n++)storage.transaction(()=>dialogue.acceptMessage({id:`${name}:history:${group}:${n}`,content:`隔离历史${group}/${n}`,direction:'incoming',receivedAt,platformMessageIds:[],seenTurnId:'past',turnId:null,outboxSeq:null,batchId:null}));}
   }
   const calls:RequestMeasure[]=[],sent:string[]=[],outputs:Array<{task:string;result:unknown}>=[];
   const transport=options.connectionFor?new ChatCompletionsTransport(options.connectionFor):null;
   const client=new ModelClient({complete:async(request,runOptions)=>{
    const envelope=buildCompletionEnvelope(request),view=isStageModelInput(request.input)?request.input:undefined;
    const m=envelope.resources.messages;calls.push({task:request.task.name,inputCharacters:JSON.stringify(envelope).length,messages:m.length,recentMessages:view?.roles.recentIds?.length??0,owners:envelope.resources.owners.length,materials:envelope.resources.materials.length,uniqueMessageIds:new Set(m.map(r=>r.id)).size===m.length,unreadExposed:request.task.name==='narrative'&&m.some(r=>r.id==='current'),allowSimulatedUserActions:request.task.promptPolicy?.facts.sharedMeta?.allowSimulatedUserActions,repair:!!request.repair,ids:m.map(r=>r.id)});
    if(!transport)return fixture(request);
    networkRequests++;const timeout=AbortSignal.timeout(options.timeoutMs??300000);return transport.complete(request,{signal:runOptions?.signal?AbortSignal.any([timeout,runOptions.signal]):timeout});
   }});
   const models:import('../types').ModelRunner={async runModel(task,input,opts){const result=await client.runModel(task,input,opts);if(options.recordResults)outputs.push({task:task.name,result});return result;}};
   const app=new HdsiApp({storage,chat:dialogue,clock:{now:()=>at},config,models,environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),random:{next:()=>0.5},wait:async ms=>{at=new Date(Date.parse(at)+ms).toISOString();},sender:{sendError:async()=>{},sendItem:async item=>{sent.push(item.payload);return {platformMessageIds:[`isolated-${sent.length}`]};}}});
   if(name==='normal'){storage.transaction(()=>dialogue.acceptMessage({id:'current',content:'明天十点联系吧，今天先不出门。',receivedAt:at,platformMessageIds:[],direction:'incoming',seenTurnId:null,turnId:null,outboxSeq:null,batchId:null}));await app.runTurn({inputMessageIds:['current'],taskIds:[],triggerKinds:['input']});}
   else if(name==='shared'){
    const state=storage.character();state.scene.mode='shared_offline';state.scene.shared={activityId:'isolated-walk',title:'散步',progress:'开始',lastPublicNode:'',completedSteps:0,maxSteps:20,idleSeconds:60,outline:null,nextStepAt:null};storage.set('character',state);storage.set('runtime',{...storage.runtime(),sharedClock:{activityId:'isolated-walk',mode:'shared_offline',status:'active',startedAt:at,lastInputAt:null,lastOutputAt:null,lastSilentCompletedAt:null}});
    await app.runTurn((await new Scheduler(storage,config).collectReady(at))!);
   }else await app.runTurn({inputMessageIds:[],taskIds:[],triggerKinds:['autonomous']});
   scenarios.push({name,done:storage.unfinishedTurn()===null,calls,sent:sent.length,...(options.recordResults?{outputs}:{})});
  }finally{storage.close();}
 }
 return {scope:'isolated-synthetic-no-QQ',requestTimeoutMs:options.timeoutMs??300000,networkRequests,embeddingRequests:0,scenarios};
}
