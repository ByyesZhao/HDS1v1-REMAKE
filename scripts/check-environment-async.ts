import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {setImmediate} from 'node:timers/promises';
import {Storage} from '../src/storage';
import {EnvironmentStore} from '../src/environment/store';import {SchoolStore} from '../src/school/store';
import {EnvironmentPreparation} from '../src/environment/preparation';import {freezeEnvironmentSnapshot} from '../src/environment/snapshot';
import {ensureEnvironmentBatch,selectEnvironmentStep} from '../src/environment/scheduler';
import {MemoryStore} from '../src/memory/store';import {MemoryRetrieval} from '../src/memory/retrieval';
import {WebSearchStore} from '../src/web/store';import {WebSearchService} from '../src/web/service';
import {defaultConfig,initialCharacter} from '../src/config';
import {HdsiApp,type Dependencies} from '../src/app';import {SerialHost} from '../src/host/runtime';
import {ModelRequestError} from '../src/model/client';
import type {ModelTask} from '../src/types';
const at='2026-10-09T10:00:00+08:00';
function fixture(H:number){
 const storage=new Storage(':memory:'),clock={time:at,now(){return this.time;}};
 storage.set('character',initialCharacter(at));storage.set('runtime',{...storage.runtime(),nextMaintenanceAt:null});
 const memoryStore=new MemoryStore(storage);memoryStore.migrate(at);
 for(let i=0;i<H;i++){const id='history-'+i;storage.save('environment_batches',id,{id,timezone:'Asia/Shanghai',localDate:'2026-01-01',scheduledAt:at,createdAt:at,reason:'daily',status:'committed',closedAt:at});storage.save('environment_steps',id,{id,batchId:id,stage:'world',status:'committed',attempt:1,startedAt:at,completedAt:at,retryAt:null,lastError:null,inputSnapshot:null,frozenResult:null,preparationVersion:1,preparationSnapshot:{large:'x'.repeat(10000)} as any});}
 for(let i=0;i<1000;i++){const row=memoryStore.makeOwner({ownerType:'long',ownerId:'memory-'+i},{content:'合成经历 '+i,sourceIds:[],retainedFrom:at,expiresAt:'2027-01-01T00:00:00+08:00'},at);memoryStore.saveOwner(row);}
 const models={runModel:async<T>(task:ModelTask<T>)=>task.parse(task.name==='narrative'?{experiences:[],currentScene:{description:'宿舍',activity:null},energy:{level:'正常',reason:'休息'}}:task.name==='personal_chat'?{emotions:[],reply:{decision:'none'},taskChanges:[]}:task.name==='memory'?{schemaVersion:3,shortTermChanges:[],longTermChanges:[],detailChanges:[]}:{})};
 const d:Dependencies={storage,clock,random:{next:()=>.5},models,config:{...defaultConfig,background:'合成背景'},sender:{sendItem:async()=>({platformMessageIds:[]}),sendError:async()=>{}},wait:async()=>{},environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),memoryStore,retrieval:new MemoryRetrieval(memoryStore),web:new WebSearchService(new WebSearchStore(storage),undefined,clock,{enabled:false})};
 return {d,clock};
}
async function sample(H:number){
 const {d,clock}=fixture(H);const batch=ensureEnvironmentBatch(d.storage,d.config,at)!,step=selectEnvironmentStep(d.storage,at)!;
 const start=performance.now(),snapshot=freezeEnvironmentSnapshot(d,step,at),freezeMs=performance.now()-start;
 let finish!:(v:any)=>void,calls=0,requestAt=0;
 d.generateEnvironment=async input=>{calls++;if(input.stage!=='world')throw new ModelRequestError('probe ends after first commit');requestAt=performance.now();return new Promise(resolve=>finish=resolve);};
 const host=new SerialHost(new HdsiApp(d),{timers:false});await host.start();
 const chatStartedAt=performance.now();await host.acceptInput({id:'chat',content:'合成输入',receivedAt:at});clock.time='2026-10-09T10:00:16+08:00';await host.wake();const chatCompletedAt=performance.now();
 if(!d.storage.all('turns').some(t=>t.done))throw Error('chat did not commit during pending environment request');
 await host.pause();const resolvedAt=performance.now();finish({stage:'world',changes:[]});await setImmediate();
 if(d.environmentStore.step(step.id)?.status!=='ready')throw Error('ready was not persisted');
 const prep=new EnvironmentPreparation(d),metadataQueries:string[]=[];const original=d.storage.prepare.bind(d.storage);d.storage.prepare=((sql:string)=>{metadataQueries.push(sql);return original(sql);}) as typeof d.storage.prepare;
 prep.status();await host.status();d.storage.prepare=original;
 if(metadataQueries.some(sql=>/SELECT data FROM environment_steps/i.test(sql)))throw Error('status loaded preparation body');
 const commitStart=performance.now();if(prep.applyReady(step.id,clock.now())!=='applied')throw Error('apply failed');const commitMs=performance.now()-commitStart;
 await host.stop();await prep.stop();d.storage.close();
 return {H,candidates:snapshot.retrieval.candidates.length,freezeMs,httpWaitMs:resolvedAt-requestAt,commitMs,chatStartedAt,chatCompletedAt,resolvedAt,chatFinishedBeforeEnvironment:chatCompletedAt<resolvedAt,environmentModelCalls:calls,statusEnvironmentBodyReads:0,metadataQueries};
}
async function main(){const args=process.argv.slice(2),output=args.includes('--output')?args[args.indexOf('--output')+1]:'.tmp/environment-async-workload.json';const results:Array<Awaited<ReturnType<typeof sample>>&{sampleNumber:number}>=[];for(const H of [0,90,180])for(let sampleNumber=0;sampleNumber<5;sampleNumber++)results.push({sampleNumber,...await sample(H)});mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify({synthetic:true,at,results},null,2));console.log(JSON.stringify({output,samples:results.length,allChatFirst:results.every(r=>r.chatFinishedBeforeEnvironment),ranges:[0,90,180].map(H=>({H,freezeMs:results.filter(r=>r.H===H).map(r=>r.freezeMs),commitMs:results.filter(r=>r.H===H).map(r=>r.commitMs)}))},null,2));}
void main().catch(error=>{console.error(error);process.exitCode=1;});
