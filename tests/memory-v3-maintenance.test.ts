import { afterEach,expect,it,vi } from 'vitest';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';
import { MemoryIndex } from '../src/memory/index';
import { MemoryLifecycle } from '../src/memory/lifecycle';
import { MemoryMaintenance } from '../src/memory/maintenance';
import { consolidationTask } from '../src/model/contracts';
import { TestClock,NOW } from './helpers';
import { addMs } from '../src/time';
const stores:Storage[]=[];afterEach(()=>{stores.splice(0).forEach(s=>s.close());vi.useRealTimers();});
function create(options:any={}){
  const storage=new Storage(':memory:');stores.push(storage);const store=new MemoryStore(storage);store.migrate(NOW);const clock=new TestClock();
  const calls:any[]=[];let resolve!:(v:any)=>void;const deferred=new Promise<any>(r=>resolve=r);
  const models:any={runModel:async(task:any,input:any,opts:any)=>{calls.push({task,input,opts});return task.parse(await deferred);}};
  const index=new MemoryIndex(store,{model:'test',dimensions:2,embed:async()=>[3,4]},{clock});const ready=vi.fn();
  const maintenance=new MemoryMaintenance(store,new MemoryLifecycle(store),index,models,{clock,onReady:ready,...options});
  return {storage,store,clock,index,models,maintenance,calls,resolve,ready};
}
function event(store:MemoryStore,id:string,content='手机详细过程'){
  const row=store.makeOwner({ownerType:'short',ownerId:id},{content,sourceIds:['s'],shortExpiresAt:addMs(NOW,-1),linkedLongId:`${id}:long`},addMs(NOW,-8*86400000));store.saveOwner(row);
  store.saveOwner(store.makeOwner({ownerType:'long',ownerId:`${id}:long`},{content:'手机preview',sourceIds:['s'],retainedFrom:addMs(NOW,-1),expiresAt:addMs(NOW,90*86400000)},row.createdAt));return row;
}
function result(input:any){return {units:(input.context?.selectedIds??input.selectedIds).map((id:string,i:number)=>({unitKey:`u${i}`,action:'refine',readOwners:[id,`${id}:long`],ids:[id,`${id}:long`],content:`手机refined${i}`,eventSummary:'手机事件',feelingSummary:'开心',sourceIds:['s']}))};}
async function flushed(){for(let i=0;i<10;i++)await Promise.resolve();}
it('starts without awaiting remote, commits only one independent ready unit, and rejects a changed second unit',async()=>{
  const d=create();for(const id of['a','b','c'])event(d.store,id);d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:NOW});
  expect(d.maintenance.startOne(NOW)).toBe(true);expect(d.calls).toHaveLength(1);expect(d.calls[0].opts.lookup).toBeNull();expect(d.calls[0].opts.signal).toBeInstanceOf(AbortSignal);expect(d.maintenance.startOne(NOW)).toBe(false);
  expect(d.store.owner({ownerType:'long',ownerId:'a:long'})!.content).toBe('手机preview');d.resolve(result(d.calls[0].input));await flushed();expect(d.ready).toHaveBeenCalledTimes(1);expect(d.store.jobs<any>('memory_maintenance_jobs')[0].status).toBe('ready');
  const old=d.store.owner({ownerType:'short',ownerId:'b'})!;d.store.saveOwner({...old,stateVersion:old.stateVersion+1,content:'前台的新内容'});
  expect(d.maintenance.applyOneReady(NOW)).toBe('applied');expect(d.store.owner({ownerType:'long',ownerId:'c:long'})!.content).toBe('手机preview');
  expect(d.maintenance.applyOneReady(NOW)).toBe('stale');expect(d.store.owner({ownerType:'short',ownerId:'b'})!.content).toBe('前台的新内容');
  expect(d.maintenance.applyOneReady(NOW)).toBe('applied');expect(d.store.owner({ownerType:'long',ownerId:'c:long'})!.content).toBe('手机refined2');
  const jobs=d.store.jobs<any>('memory_maintenance_jobs');expect(jobs.find(j=>j.appliedUnitKeys.length)?.staleUnitKeys).toEqual(['u1']);expect(jobs.find(j=>j.status==='done')?.result).toBeNull();expect(jobs.some(j=>j.status==='pending'&&j.snapshot.some((s:any)=>s.id==='b'))).toBe(true);
});
it('keeps twenty event batches complete by default and treats optional character target as a soft batch boundary',async()=>{
  const d=create();for(let i=0;i<21;i++)event(d.store,`e${i}`,'详细内容'.repeat(4000));d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:NOW});d.maintenance.startOne(NOW);
  expect(d.calls[0].input.context.selectedIds).toHaveLength(20);expect(d.calls[0].input.resources.owners.find((s:any)=>s.id==='e0').content.length).toBe(16000);
  d.resolve(result(d.calls[0].input));await flushed();await d.maintenance.stop();
  const small=create({batchCharacters:12000});event(small.store,'big','完整正文'.repeat(4000));event(small.store,'small');small.storage.set('runtime',{...small.storage.runtime(),nextMaintenanceAt:NOW});small.maintenance.startOne(NOW);expect(small.calls[0].input.context.selectedIds).toEqual(['big']);expect(small.calls[0].input.resources.owners[0].content.length).toBe(16000);small.resolve(result(small.calls[0].input));await flushed();await small.maintenance.stop();
});
it('holds a fixed cutoff, preserves later expiry for the next day, and schedules only the next future 04:30',async()=>{
  const d=create();event(d.store,'old');const late=event(d.store,'later');d.store.saveOwner({...late,shortExpiresAt:addMs(NOW,1000)});d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:addMs(NOW,-10*86400000)});d.maintenance.startOne(NOW);expect(d.calls[0].input.context.cutoff).toBe(NOW);expect(d.calls[0].input.context.selectedIds).toEqual(['old']);d.clock.advance(2000);d.resolve(result(d.calls[0].input));await flushed();d.maintenance.applyOneReady(d.clock.now());
  // The next scan closes this cycle but does not widen it to the later event.
  d.maintenance.startOne(d.clock.now());expect(d.calls).toHaveLength(1);expect(Date.parse(d.storage.runtime().nextMaintenanceAt!)).toBeGreaterThan(Date.parse(d.clock.now()));expect(d.storage.get('memory_maintenance_cycle')).toBeNull();
});
it('preserves preview and retry pending on capacity failure without pausing or issuing a smaller request',async()=>{
  const d=create();event(d.store,'a');d.models.runModel=vi.fn(async()=>{throw new Error('context capacity exceeded');});d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:NOW});d.maintenance.startOne(NOW);await flushed();const job=d.store.jobs<any>('memory_maintenance_jobs')[0];expect(job.status).toBe('pending');expect(job.retryAt).toBe(addMs(NOW,300000));expect(job.lastError).toBe('记忆整合执行失败，等待重试');expect(d.storage.runtime().paused).toBe(false);expect(d.store.owner({ownerType:'long',ownerId:'a:long'})!.content).toBe('手机preview');expect(d.models.runModel).toHaveBeenCalledTimes(1);expect(d.maintenance.startOne(NOW)).toBe(false);
});
it('times out consolidation at 600 seconds, aborts and delays retry; stop does not publish late results',async()=>{
  vi.useFakeTimers();const d=create();event(d.store,'a');d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:NOW});d.maintenance.startOne(NOW);await vi.advanceTimersByTimeAsync(600000);expect(d.calls[0].opts.signal.aborted).toBe(true);expect(d.store.jobs<any>('memory_maintenance_jobs')[0].status).toBe('pending');expect(d.ready).toHaveBeenCalledTimes(1);
  d.clock.advance(300000);d.maintenance.startOne(d.clock.now());const stopped=d.maintenance.stop();d.resolve(result(d.calls[0].input));await stopped;expect(d.ready).toHaveBeenCalledTimes(1);expect(d.store.jobs<any>('memory_maintenance_jobs')[0].status).not.toBe('ready');
});
it('checks closed read sets, disjoint writes, all selected events, and protects awakened memory against discard',()=>{
  const d=create();const a=event(d.store,'a');const l=d.store.owner({ownerType:'long',ownerId:'a:long'})!;const snapshot=[a,l],task=consolidationTask(snapshot,['a']);const valid=result({selectedIds:['a']});expect(task.parse(valid)).toHaveLength(1);
  expect(()=>task.parse({units:[]})).toThrow('selected');expect(()=>task.parse({units:[...valid.units,...valid.units]})).toThrow('duplicate');expect(()=>task.parse({units:[{...valid.units[0],readOwners:['outside']}]})).toThrow('readOwners');
  expect(()=>consolidationTask([a,{...l,totalAwakenings:1}],['a']).parse({units:[{unitKey:'discard',action:'discard',readOwners:['a','a:long'],ids:['a','a:long'],sourceIds:['s'],reason:'琐碎'}]})).toThrow('awaken');
});
it('selects compression and index retry jobs fairly by createdAt and ID, with ready ahead of new remote work',async()=>{
  const d=create();const row=d.store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'A'},addMs(NOW,-1000));d.store.saveOwner(row);d.store.queueIndex(row,addMs(NOW,-1000),d.index.configSignature);event(d.store,'a');d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:NOW});
  expect(d.maintenance.startOne(NOW)).toBe(true);expect(d.calls).toHaveLength(0);await flushed();expect(d.maintenance.startOne(NOW)).toBe(false);expect(d.maintenance.applyOneReady(NOW)).toBe('applied');expect(d.maintenance.startOne(NOW)).toBe(true);expect(d.calls).toHaveLength(1);d.resolve(result(d.calls[0].input));await flushed();await d.maintenance.stop();
});
