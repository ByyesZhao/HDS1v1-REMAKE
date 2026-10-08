import {afterEach,expect,it,vi} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {MemoryIdle} from '../src/memory/idle';
import {MemoryCapacity} from '../src/memory/capacity';
import {MemoryCleanup} from '../src/memory/cleanup';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {defaultMemoryCapacity} from '../src/memory/types';
import {HdsiApp} from '../src/app';
import {SerialHost} from '../src/host/runtime';
const min=(n:number)=>new Date(Date.parse(at)+n*60000).toISOString();
const hosts:SerialHost[]=[];afterEach(async()=>{for(const h of hosts.splice(0))await h.stop();vi.useRealTimers();});
function create(){const d=fixture(),idle=new MemoryIdle(d.storage,15,true),cap=new MemoryCapacity(d.store,defaultMemoryCapacity),cleanup=new MemoryCleanup(d.store,cap),life=new MemoryLifecycle(d.store,cap);idle.record('story',at);d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:days(1),nextMaintenanceAt:days(1)});let host:SerialHost;const index=new MemoryIndex(d.store,{model:'offline',embed:async()=>[1,0]},{clock:d.clock});const maintenance=new MemoryMaintenance(d.store,life,index,d.models,{clock:d.clock,idle,onReady:()=>void host.wake()});const dependencies={...d,memoryStore:d.store,memoryCapacity:cap,memoryIdle:idle,memoryCleanup:cleanup,memoryLifecycle:life,maintenance};host=new SerialHost(new HdsiApp(dependencies),{timers:false});hosts.push(host);return {...dependencies,host};}
it('inflight_backend_does_not_block_input_story',async()=>{
 const d=create();const r=long(d.store,'old');d.store.queueDirty(r,'event',at);let resolve!:(v:any)=>void;d.models.outputs.memory_consolidation=()=>new Promise(r=>resolve=r);
 // Keep contract parsing real, only the remote wait is replaced.
 const original=d.models.runModel.bind(d.models);d.models.runModel=async(task,input,options)=>task.name==='memory_consolidation'?task.parse(await new Promise(r=>resolve=r)):original(task,input,options);
 d.clock.time=min(15);await d.host.start();expect(d.maintenance.inFlight).toBe(true);
 d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'回应',draft:'收到'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'收到'}]};
 await d.host.acceptInput({id:'new',content:'你好',receivedAt:d.clock.now()});d.clock.advance(15000);await d.host.wake();expect(d.sender.sent[0].payload).toBe('收到');expect(d.storage.unfinishedTurn()).toBeNull();
 resolve({units:[{unitKey:'r',action:'refine',ids:['old'],readOwners:['old'],content:'改善摘要',sourceIds:r.sourceIds}]});for(let i=0;i<25;i++)await Promise.resolve();await d.host.wake();expect(d.store.canonical('old')?.content).toBe('经历-old');expect(d.storage.runtime().memoryIdle?.lastInputAt).toBe(min(15));
});
it('cleanup_yields_to_front',async()=>{
 const d=create();for(let i=0;i<3;i++)long(d.store,`expired${i}`,{archiveEnteredAt:days(-100)});
 const app=new HdsiApp(d);let yielded=false;const h=new SerialHost(app,{timers:false,yieldToEvents:async()=>{if(!yielded){yielded=true;await h.acceptInput({id:'arrival',content:'到了',receivedAt:d.clock.now()});d.clock.advance(15000);}}});hosts.push(h);await h.start();expect(d.storage.all('turns').filter(t=>t.done)).toHaveLength(1);expect(d.store.canonical('expired0')).toBeNull();expect(d.store.canonical('expired1')).toBeNull();expect(d.storage.runtime().memoryIdle?.lastInputAt).toBe(at);
});
it('expiry_without_new_messages',async()=>{
 vi.useFakeTimers();const d=create();long(d.store,'expires',{archiveEnteredAt:new Date(Date.parse(days(-90))+60000).toISOString()});const h=new SerialHost(new HdsiApp(d),{timers:true});hosts.push(h);await h.start();expect(d.store.canonical('expires')).not.toBeNull();d.clock.advance(60000);await vi.advanceTimersByTimeAsync(60000);expect(d.store.canonical('expires')).toBeNull();expect(d.models.calls).toEqual([]);await h.stop();
});
it('real input between ready units waits full idle after its story',async()=>{
 const d=create(),a=long(d.store,'a'),b=long(d.store,'b');d.clock.time=min(15);
 d.store.saveJob('memory_maintenance_jobs',{id:'ready',createdAt:at,cutoff:at,status:'ready',snapshot:[a,b],selectedIds:['a','b'],readSet:[a,b],result:[a,b].map(r=>({unitKey:r.id,action:'refine',readSet:[r],ids:[r.id],content:`改善${r.id}`,sourceIds:r.sourceIds})),appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null});
 let arrived=false;const h=new SerialHost(new HdsiApp(d),{timers:false,yieldToEvents:async()=>{if(!arrived){arrived=true;await h.acceptInput({id:'interleave',content:'你好',receivedAt:d.clock.now()});d.clock.advance(15000);}}});hosts.push(h);await h.start();
 expect(d.storage.read('messages','interleave')?.seenTurnId).toBeTruthy();expect(d.store.canonical('b')?.content).toBe('经历-b');
 d.clock.advance(15*60000);await h.wake();expect(d.store.canonical('b')?.content).toBe('改善b');
});
it('environment_0600_first_not_idle_reset',async()=>{
 const d=create();const r=long(d.store,'dirty');d.store.queueDirty(r,'event',at);d.clock.time=min(15);d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:d.clock.now()});
 const anchor=d.storage.runtime().memoryIdle;
 d.generateEnvironment=async input=>{d.models.calls.push({name:input.stage,input});return input.stage==='world'?{stage:'world',changes:[]}:input.stage==='school_week'?{stage:'school_week',instanceChanges:[],noticeCandidates:[],weekChanges:[]}:{stage:input.stage,planChanges:[],itemChanges:[]};};
 d.models.outputs.memory_consolidation={units:[{unitKey:'r',action:'retain',ids:['dirty'],readOwners:['dirty'],sourceIds:[]}]};
 const h=new SerialHost(new HdsiApp(d),{timers:false});hosts.push(h);await h.start();
 expect(d.models.calls.slice(0,3).map(c=>c.name)).toEqual(['world','school_campus','school_group']);expect(d.storage.runtime().memoryIdle).toEqual(anchor);
});
