import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryRetrieval} from '../src/memory/retrieval';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {ModelClient,ChatCompletionsTransport} from '../src/model/client';
import {ModelRunHistory} from '../src/model/run-history';
import {EnvironmentStore} from '../src/environment/store';
import {SchoolStore} from '../src/school/store';
import type {Dependencies} from '../src/app';
import type {TurnRecord,MemoryResult} from '../src/types';
import type {IncomingMediaService} from '../src/input-media/service';
import {setup,NOW,narrative} from './helpers';
import {addMs} from '../src/time';

export const QUERY='算例口径复核';
export const emptyResult:MemoryResult={schemaVersion:3,shortTermChanges:[],longTermChanges:[],detailChanges:[]};
export function linkedCreate(id='L',progress=false):MemoryResult {return {schemaVersion:3,shortTermChanges:[{action:'create',clientRef:'revisit',existingLongId:id,hasNewEventProgress:progress,content:QUERY,eventSummary:QUERY,feelingSummary:'平静',topics:[QUERY],sourceIds:['new-source'],importance:'normal'}],longTermChanges:[],detailChanges:[]};}
export const claim={shortUpdateIds:['UNPROVIDED'],longAwakenIds:['UNPROVIDED'],existingLongIds:['UNPROVIDED']};
export function fixture(options:{path?:string;seed?:boolean;query?:string;media?:boolean;repairLimit?:number}={}){
 const d=setup();let storage=d.storage;
 if(options.path){storage=new Storage(options.path);d.storage.close();if(!storage.get('character')){storage.set('character',d.config&&{narratedUntil:NOW,scene:{mode:'chat',description:'合成场景',activity:null,shared:null},plan:'合成计划',emotions:[],energy:{level:'正常',reason:'合成'},sleep:null,nextAutonomousAt:null});storage.set('runtime',{...storage.runtime(),dialogueContextVersion:1,environmentPlanningVersion:1});}}
 const store=new MemoryStore(storage),life=new MemoryLifecycle(store),retrieval=new MemoryRetrieval(store);
 const long=store.makeOwner({ownerType:'long',ownerId:'L'},{content:QUERY,eventSummary:QUERY,sourceIds:['old-source'],topics:[QUERY],retainedFrom:addMs(NOW,6*86400000),expiresAt:addMs(NOW,96*86400000)},NOW);
 const short=store.makeOwner({ownerType:'short',ownerId:'S'},{content:QUERY,eventSummary:QUERY,sourceIds:['old-source'],topics:[QUERY],linkedLongId:'L',shortExpiresAt:addMs(NOW,7*86400000)},NOW);
 if(options.seed!==false){store.saveOwner(long);store.saveOwner(short);}
 const web=new WebSearchService(new WebSearchStore(storage),undefined,d.clock,{enabled:false});
 const envelopes:any[]=[],requests:any[]=[],responses:unknown[]=[linkedCreate()];
 const transport=new ChatCompletionsTransport(()=>({model:'fixture',baseUrl:'https://fixture.invalid',apiKey:'offline',outputMode:'json_object'}),(async(_url,init)=>{
  const request=JSON.parse(String(init?.body));requests.push(request);const content=request.messages[1].content;envelopes.push(JSON.parse(typeof content==='string'?content:content[0].text));
  const output=responses[Math.min(requests.length-1,responses.length-1)];
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));
 }) as typeof fetch);
 const models=new ModelClient(transport,undefined,options.repairLimit??2,new ModelRunHistory(storage,d.clock));
 const deps:Dependencies={...d,storage,environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),memoryStore:store,memoryLifecycle:life,retrieval,web,models,...(options.media?{incomingMedia:{readConfirmedForMessages:()=>[],readFrozenForTurn:()=>[]} as unknown as IncomingMediaService}:{})};
 const turn:TurnRecord={id:'test-memory-turn',at:NOW,inputMessageIds:[],triggerTaskIds:[],triggerKinds:['sleep'],batchIds:[],entryMode:'chat',dialogueWindowVersion:1,completedAt:null,outputComplete:true,done:false,frozenResult:{narrative,personal:null,expression:null,visibleMessageIds:[],reconsiderMessageIds:[],experiences:[{id:'new-source',happenedAt:NOW,description:options.query??QUERY,relatedEventIds:[]}],nextState:storage.character(),taskChanges:[],completedTaskIds:[],probability:{contactMisses:0,stickerMisses:0},autonomousIntervalMinutes:null,environmentChanges:[],schoolObservations:[]}};
 storage.save('turns',turn.id,turn);
 const ref=web.store.openStage('turn',turn.id,'memory','memory'),session=web.openSession(ref);
 return {deps,store,life,retrieval,web,turn,long,short,envelopes,requests,responses,ref,session,close:()=>storage.close()};
}

