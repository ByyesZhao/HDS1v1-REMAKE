import {Storage} from '../storage';
import {HdsiApp} from '../app';
import {DialogueEpisodes} from '../dialogue/episodes';
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
export interface RequestMeasure {task:string;inputCharacters:number;messages:number;recentMessages:number;owners:number;materials:number;uniqueMessageBodies:boolean;unreadExposed:boolean;allowSimulatedUserActions?:boolean;repair:boolean;ids:string[]}
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
    const m=envelope.resources.messages;calls.push({task:request.task.name,inputCharacters:JSON.stringify(envelope).length,messages:m.length,recentMessages:view?.roles.recentIds?.length??0,owners:envelope.resources.owners.length,materials:envelope.resources.materials.length,uniqueMessageBodies:new Set(m.map(r=>r.id)).size===m.length,unreadExposed:request.task.name==='narrative'&&m.some(r=>r.id==='current'),allowSimulatedUserActions:request.task.promptPolicy?.facts.sharedMeta?.allowSimulatedUserActions,repair:!!request.repair,ids:m.map(r=>r.id)});
    if(!transport)return fixture(request);
    networkRequests++;const timeout=AbortSignal.timeout(options.timeoutMs??300000);return transport.complete(request,{signal:runOptions?.signal?AbortSignal.any([timeout,runOptions.signal]):timeout});
   }});
   const models:import('../types').ModelRunner={async runModel(task,input,opts){const result=await client.runModel(task,input,opts);if(options.recordResults)outputs.push({task:task.name,result});return result;}};
   const app=new HdsiApp({storage,dialogue,clock:{now:()=>at},config,models,environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),random:{next:()=>0.5},wait:async ms=>{at=new Date(Date.parse(at)+ms).toISOString();},sender:{sendError:async()=>{},sendItem:async item=>{sent.push(item.payload);return {platformMessageIds:[`isolated-${sent.length}`]};}}});
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
