import { afterEach,expect,it,vi } from 'vitest';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { SerialHost } from '../src/host/runtime';
import { HdsiApp } from '../src/app';
import { MemoryStore } from '../src/memory/store';
import { MemoryLifecycle } from '../src/memory/lifecycle';
import { MemoryIndex } from '../src/memory/index';
import { MemoryMaintenance } from '../src/memory/maintenance';
import { setup,NOW } from './helpers';
import { addMs } from '../src/time';
const disposals:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const dispose of disposals.splice(0))await dispose();vi.useRealTimers();});
function create(options:any={}) {
  const d=setup();const store=new MemoryStore(d.storage);store.migrate(NOW);const index=new MemoryIndex(store,{model:'test',embed:async()=>[1,0]},{clock:d.clock});
  let resolve!:(v:any)=>void;const blocked=new Promise<any>(r=>resolve=r);const calls:any[]=[];
  const original=d.models.runModel.bind(d.models);d.models.runModel=async(task,input,opts)=>{if(task.name==='memory_consolidation'){calls.push({task,input,opts});return task.parse(await blocked);}return original(task,input,opts);};
  let host:SerialHost;const maintenance=new MemoryMaintenance(store,new MemoryLifecycle(store),index,d.models,{clock:d.clock,onReady:()=>void host.wake()});
  const app=new HdsiApp({...d,maintenance} as any);host=new SerialHost(app,{timers:false,...options});disposals.push(async()=>{await host.stop();d.storage.close();});
  return {d,store,maintenance,host,calls,resolve,app};
}
function expired(store:MemoryStore,id='a') {const short=store.makeOwner({ownerType:'short',ownerId:id},{content:'手机详细记录',sourceIds:['s'],shortExpiresAt:addMs(NOW,-1),linkedLongId:`${id}:long`},addMs(NOW,-8*86400000));store.saveOwner(short);store.saveOwner(store.makeOwner({ownerType:'long',ownerId:`${id}:long`},{content:'手机preview',sourceIds:['s'],retainedFrom:addMs(NOW,-1),expiresAt:addMs(NOW,90*86400000)},short.createdAt));}
function ready(store:MemoryStore){const rows=['a','b'].map(id=>store.makeOwner({ownerType:'long',ownerId:id},{content:'手机preview',sourceIds:['s']},NOW));rows.forEach(r=>store.saveOwner(r));store.saveJob('memory_maintenance_jobs',{id:'ready',cutoff:NOW,createdAt:NOW,status:'ready',snapshot:rows,readSet:rows,result:rows.map((r,i)=>({unitKey:`u${i}`,action:'refine',readSet:[r],ids:[r.id],content:`手机refined${i}`,sourceIds:['s']})),appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null});}
function response(d:ReturnType<typeof setup>){d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'回应',draft:'收到'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'收到'}]};}
it('sends and finishes a real 15-second input batch while the backend promise stays unresolved',async()=>{
  const {d,store,host,calls,maintenance,resolve}=create();expired(store);d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:NOW});await host.start();expect(calls).toHaveLength(1);expect(maintenance.inFlight).toBe(true);
  response(d);await host.acceptInput({id:'input',receivedAt:d.clock.now(),content:'你好',platformMessageIds:[]});expect(d.storage.read('messages','input')).not.toBeNull();const cutoff=d.storage.runtime().openBatch!.readyAt;d.clock.advance(15000);await host.wake();
  expect(cutoff).toBe(addMs(NOW,15000));expect(d.sender.sent[0].payload).toBe('收到');expect(d.storage.unfinishedTurn()).toBeNull();expect(d.storage.outbox(d.storage.all('turns')[0].id)[0].status).toBe('confirmed');expect(maintenance.inFlight).toBe(true);
  resolve({units:[{unitKey:'u',action:'retain',readOwners:['a','a:long'],ids:['a','a:long'],sourceIds:['s'],reason:'保留preview'}]});await yieldImmediate();await host.wake();
});
it('yields after one ready unit, accepts actual input and delays the second until its story completes',async()=>{
  let yielded=0;const {d,store,host}=create({yieldToEvents:async()=>{if(++yielded===1){await host.acceptInput({id:'input',receivedAt:d.clock.now(),content:'手机',platformMessageIds:[]});}await yieldImmediate();}});response(d);ready(store);await host.start();
  expect(store.owner({ownerType:'long',ownerId:'a'})!.content).toBe('手机refined0');expect(store.owner({ownerType:'long',ownerId:'b'})!.content).toBe('手机preview');expect(d.storage.runtime().openBatch!.readyAt).toBe(addMs(NOW,15000));
  d.clock.advance(15000);await host.wake();expect(d.sender.sent).toHaveLength(1);expect(d.storage.read('messages','input')!.seenTurnId).not.toBeNull();expect(store.owner({ownerType:'long',ownerId:'b'})!.content).toBe('手机refined1');
});
it('uses real setImmediate to give an already queued input I/O callback priority over the next unit',async()=>{
  const {d,store,host}=create();ready(store);response(d);const arrived=new Promise<void>(resolve=>setImmediate(()=>{void host.acceptInput({id:'real-io',receivedAt:d.clock.now(),content:'你好',platformMessageIds:[]}).then(()=>resolve());}));await host.start();await arrived;
  expect(d.storage.read('messages','real-io')).not.toBeNull();expect(store.owner({ownerType:'long',ownerId:'b'})!.content).toBe('手机preview');d.clock.advance(15000);await host.wake();expect(d.storage.read('messages','real-io')!.seenTurnId).toBeTruthy();
  expect(store.owner({ownerType:'long',ownerId:'a'})!.content).toBe('手机refined0');
});
it('does not start or apply maintenance during open batching or pause, and status contains only operational counts',async()=>{
  const {d,store,host,maintenance}=create();ready(store);await host.acceptInput({id:'input',receivedAt:NOW,content:'私密查询正文',platformMessageIds:[]});await host.wake();expect(store.owner({ownerType:'long',ownerId:'a'})!.content).toBe('手机preview');await host.pause();d.clock.advance(15000);await host.wake();expect(d.storage.runtime().openBatch).toBeNull();expect(maintenance.inFlight).toBe(false);expect(store.owner({ownerType:'long',ownerId:'a'})!.content).toBe('手机preview');const status=await host.status();expect(status).toContain('维护');expect(status).not.toContain('私密查询正文');await host.resume();expect(store.owner({ownerType:'long',ownerId:'a'})!.content).toBe('手机refined0');
});
it('stop aborts backend before waiting for a running foreground turn and suppresses late ready callbacks',async()=>{
  const {d,store,host,calls,maintenance,resolve}=create();expired(store);d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:NOW});await host.start();let finish!:()=>void;const original=d.models.runModel.bind(d.models);d.models.runModel=async(task,input,opts)=>{if(task.name==='narrative')await new Promise<void>(r=>finish=r);return original(task,input,opts);};
  await host.acceptInput({id:'input',receivedAt:NOW,content:'你好',platformMessageIds:[]});d.clock.advance(15000);const foreground=host.wake();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));let stopped=false;const stopping=host.stop().then(()=>stopped=true);expect(calls[0].opts.signal.aborted).toBe(true);expect(stopped).toBe(false);finish();await foreground;await stopping;expect(maintenance.inFlight).toBe(false);
  resolve({units:[{unitKey:'u',action:'retain',readOwners:['a','a:long'],ids:['a','a:long'],sourceIds:['s'],reason:'保留'}]});await yieldImmediate();expect(store.jobs<any>('memory_maintenance_jobs')[0].status).not.toBe('ready');
});
it('recovers an old story before due world, school, input story and ready maintenance',async()=>{
  const {d,store,host}=create();ready(store);response(d);d.models.outputs.world={changes:[]};d.models.outputs.school={changes:[]};
  d.storage.save('turns','old',{id:'old',at:NOW,inputMessageIds:[],triggerTaskIds:[],triggerKinds:['autonomous'],batchIds:[],entryMode:'chat',completedAt:null,frozenResult:null,outputComplete:false,done:false});
  d.storage.set('runtime',{...d.storage.runtime(),nextWorldAt:NOW,nextSchoolAt:NOW});await host.acceptInput({id:'input',receivedAt:NOW,content:'你好',platformMessageIds:[]});d.clock.advance(15000);await host.start();
  const calls=d.models.calls.map(c=>c.name);expect(calls.slice(0,3)).toEqual(['narrative','personal_life','memory']);expect(calls.slice(3,5)).toEqual(['world','school']);expect(calls.slice(5)).toEqual(['narrative','personal_chat','expression','memory']);expect(store.job<any>('memory_maintenance_jobs','ready').appliedUnitKeys).toEqual(['u0','u1']);
});
it('an in-flight request does not arm a zero-delay maintenance wake loop; pause can persist ready until resume',async()=>{
  vi.useFakeTimers();const {d,store,host,resolve,calls}=create({timers:true});expired(store);d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:NOW});await host.start();const wake=vi.spyOn(host,'wake');d.clock.advance(1000);await vi.advanceTimersByTimeAsync(1000);expect(wake).not.toHaveBeenCalled();await host.pause();resolve({units:[{unitKey:'u',action:'refine',readOwners:['a','a:long'],ids:['a','a:long'],content:'手机refined',sourceIds:['s']}]});for(let i=0;i<15;i++)await Promise.resolve();expect(calls).toHaveLength(1);expect(store.jobs<any>('memory_maintenance_jobs')[0].status).toBe('ready');expect(store.owner({ownerType:'long',ownerId:'a:long'})!.content).toBe('手机preview');
  vi.useRealTimers();await host.resume();expect(store.owner({ownerType:'long',ownerId:'a:long'})!.content).toBe('手机refined');
});
