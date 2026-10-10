import {it,expect} from 'vitest';
import {EnvironmentPreparation} from '../src/environment/preparation';
import {SerialHost} from '../src/host/runtime';
import {HdsiApp} from '../src/app';
import {asyncFixture} from './environment-async-fixture';
import {modern} from './chat-fixture';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryIndex} from '../src/memory/index';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {NOW,TestClock} from './helpers';
const tick=()=>new Promise<void>(r=>setImmediate(r));
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
it('graceful environment stop completes current preparation without starting next stage',async()=>{
 const {d,step}=asyncFixture(),gate=deferred<any>();let signal!:AbortSignal;
 d.generateEnvironment=async(_input,options)=>{signal=options!.signal!;return gate.promise;};
 const prep=new EnvironmentPreparation(d);prep.startOne(step.id,NOW);await tick();let done=false;
 const stopping=prep.stop({graceful:true}).then(()=>done=true);await tick();expect(done).toBe(false);expect(signal.aborted).toBe(false);expect(prep.startOne(step.id,NOW)).toBe(false);
 gate.resolve({stage:'world',changes:[]});await stopping;expect(d.environmentStore.step(step.id)!.status).toBe('ready');expect(d.environmentStore.steps(step.batchId).filter(s=>s.attempt>0)).toHaveLength(1);d.storage.close();
});
it('host graceful stop waits for running world director and leaves next director pending',async()=>{
 const {d,step}=asyncFixture(),gate=deferred<any>();let signal!:AbortSignal;
 d.generateEnvironment=async(_input,options)=>{signal=options!.signal!;return gate.promise;};
 const host=new SerialHost(new HdsiApp(d),{timers:false});await host.start();await tick();
 let done=false;const stopping=host.stop({graceful:true}).then(()=>done=true);await tick();expect(done).toBe(false);expect(signal.aborted).toBe(false);
 gate.resolve({stage:'world',changes:[]});await stopping;expect(d.environmentStore.step(step.id)!.status).toBe('ready');expect(d.storage.all('turns')).toHaveLength(0);await host.wake();expect(d.environmentStore.steps(step.batchId).filter(s=>s.attempt>0)).toHaveLength(1);d.storage.close();
});
it('host finishes foreground turn, refuses new input and opens no next turn',async()=>{
 const d=modern(),gate=deferred<void>(),started=deferred<void>(),original=d.models.runModel.bind(d.models);
 d.models.runModel=async(task:any,input:any,options?:any)=>{if(task.name==='narrative'){started.resolve();await gate.promise;}return original(task,input,options);};
 const host=new SerialHost(new HdsiApp(d),{timers:false});await host.acceptInput({id:'a',content:'hi',receivedAt:d.clock.now()});d.clock.advance(15000);const working=host.wake();await started.promise;
 let done=false;const stopping=host.stop({graceful:true}).then(()=>done=true);await tick();expect(done).toBe(false);
 await expect(host.acceptInput({id:'b',content:'later',receivedAt:d.clock.now()})).rejects.toThrow('stopped');gate.resolve();await stopping;await working;
 expect(d.storage.unfinishedTurn()).toBeNull();expect(d.storage.read('messages','a')!.seenTurnId).not.toBeNull();expect(d.models.calls.map(c=>c.name)).toEqual(['narrative','personal_chat','memory']);await host.wake();expect(d.storage.all('turns')).toHaveLength(1);d.storage.close();
});
it('graceful stop does not wait for an unopened input batch',async()=>{
 const d=modern(),host=new SerialHost(new HdsiApp(d));await host.acceptInput({id:'a',content:'hi',receivedAt:d.clock.now()});await host.stop({graceful:true});expect(d.models.calls).toHaveLength(0);expect(d.storage.read('messages','a')!.seenTurnId).toBeNull();d.storage.close();
});
it('memory index preparation completes and persists ready result during graceful stop',async()=>{
 const storage=new Storage(':memory:'),store=new MemoryStore(storage);store.migrate(NOW);const gate=deferred<number[]>();let signal:AbortSignal|undefined;
 const index=new MemoryIndex(store,{model:'test',dimensions:2,embed:async(_text,options)=>{signal=options?.signal;return gate.promise;}},{clock:new TestClock()});
 const maintenance=new MemoryMaintenance(store,new MemoryLifecycle(store),index,{runModel:async()=>{throw Error('unused');}} as any,{clock:new TestClock()});
 const row=store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'phone'},NOW);store.saveOwner(row);store.queueIndex(row,NOW,index.configSignature);
 maintenance.startOne(NOW);await tick();let done=false;const stopping=maintenance.stop({graceful:true}).then(()=>done=true);await tick();expect(done).toBe(false);expect(signal?.aborted).not.toBe(true);expect(maintenance.startOne(NOW)).toBe(false);
 gate.resolve([3,4]);await stopping;expect(store.jobs<any>('memory_index_jobs')[0].status).toBe('ready');expect(store.jobs<any>('memory_index_jobs')[0].result[0]).toBeCloseTo(0.6);expect(store.jobs<any>('memory_index_jobs')[0].result[1]).toBeCloseTo(0.8);storage.close();
});

it('stop during async selection cannot start a new ordinary/event turn',async()=>{
 const d=modern();d.storage.save('tasks','appointment',{id:'appointment',kind:'appointment',at:NOW,description:'due',status:'pending'});const host=new SerialHost(new HdsiApp(d),{timers:false});const starting=host.start();await host.stop({graceful:true});await starting;expect(d.models.calls).toHaveLength(0);expect(d.storage.read('tasks','appointment')!.status).toBe('pending');d.storage.close();
});
