import { afterEach,expect,it,vi } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';
import { MemoryLifecycle } from '../src/memory/lifecycle';
import { MemoryIndex } from '../src/memory/index';
import { MemoryMaintenance } from '../src/memory/maintenance';
import { TestClock,NOW,setup,saveInput } from './helpers';
import {HdsiApp} from '../src/app';
import {MemoryCapacity} from '../src/memory/capacity';
import {addMs} from '../src/time';
import {defaultMemoryCapacity} from '../src/memory/types';
const stores:Storage[]=[];const dirs:string[]=[];afterEach(()=>{stores.splice(0).forEach(s=>s.close());dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}));});
function open(path:string){const storage=new Storage(path);stores.push(storage);const store=new MemoryStore(storage);store.migrate(NOW);const clock=new TestClock(),models:any={runModel:vi.fn()},index=new MemoryIndex(store,{model:'test',embed:async()=>[1,0]},{clock});const maintenance=new MemoryMaintenance(store,new MemoryLifecycle(store),index,models,{clock});return {storage,store,maintenance,models,index};}
it('reopens ready without recomputing, rolls back owner and marker together, and skips completed units',()=>{
  const dir=mkdtempSync(join(tmpdir(),'hdsi-maint-'));dirs.push(dir);const path=join(dir,'test.sqlite');let d=open(path);const row=d.store.makeOwner({ownerType:'long',ownerId:'a'},{content:'手机preview',sourceIds:['s']},NOW);d.store.saveOwner(row);
  d.store.saveJob('memory_maintenance_jobs',{id:'job',cutoff:NOW,createdAt:NOW,status:'ready',snapshot:[row],readSet:[row],result:[{unitKey:'u',action:'refine',readSet:[row],ids:['a'],content:'手机refined',eventSummary:'手机',feelingSummary:'开心',sourceIds:['s']}],appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null});
  d.storage.close();stores.splice(stores.indexOf(d.storage),1);d=open(path);
  // Fail the done marker after the owner update, while allowing failure accounting.
  d.storage.prepare("CREATE TRIGGER fail_done BEFORE UPDATE ON memory_maintenance_jobs WHEN json_extract(NEW.data,'$.status')='done' BEGIN SELECT RAISE(ABORT,'commit failed'); END").run();
  expect(d.maintenance.applyOneReady(NOW)).toBe('none');expect(d.store.owner(row)!.content).toBe('手机preview');
  expect(d.store.job<any>('memory_maintenance_jobs','job')).toMatchObject({status:'ready',appliedUnitKeys:[],failureCount:1,executionAttemptCount:1,retryAt:addMs(NOW,300000)});expect(d.storage.runtime().paused).toBe(false);expect(d.models.runModel).not.toHaveBeenCalled();
  d.storage.prepare('DROP TRIGGER fail_done').run();d.storage.close();stores.splice(stores.indexOf(d.storage),1);d=open(path);
  expect(d.maintenance.applyOneReady(NOW)).toBe('none');expect(d.maintenance.applyOneReady(addMs(NOW,300000))).toBe('applied');expect(d.store.owner(row)!.content).toBe('手机refined');
  expect(d.store.job<any>('memory_maintenance_jobs','job')).toMatchObject({status:'done',appliedUnitKeys:['u'],failureCount:1,executionAttemptCount:2});expect(d.maintenance.applyOneReady(addMs(NOW,300000))).toBe('none');expect(d.models.runModel).not.toHaveBeenCalled();
});
it('resets computing to pending, preserves cutoff and atomically writes ready index with done marker',()=>{
  const d=open(':memory:');const row=d.store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'A',key:'phone',value:'A'},NOW);d.store.saveOwner(row);d.store.queueIndex(row,NOW,d.index.configSignature);const job=d.store.jobs<any>('memory_index_jobs')[0];d.store.saveJob('memory_index_jobs',{...job,status:'computing'});d.storage.set('memory_maintenance_cycle',{cutoff:NOW});
  const resumed=new MemoryMaintenance(d.store,new MemoryLifecycle(d.store),d.index,d.models,{clock:new TestClock()});expect(d.store.job<any>('memory_index_jobs',job.id).status).toBe('pending');expect(d.storage.get('memory_maintenance_cycle')).toEqual({cutoff:NOW});
  d.store.saveJob('memory_index_jobs',{...job,status:'ready',result:[1,0]});
  d.storage.prepare("CREATE TRIGGER fail_index_done BEFORE UPDATE ON memory_index_jobs WHEN json_extract(NEW.data,'$.status')='done' BEGIN SELECT RAISE(ABORT,'index rollback'); END").run();
  expect(resumed.applyOneReady(NOW)).toBe('none');expect(d.storage.prepare('SELECT count(*) AS n FROM memory_index').get()!.n).toBe(0);expect(d.store.job<any>('memory_index_jobs',job.id)).toMatchObject({status:'ready',result:[1,0],retryAt:addMs(NOW,300000)});
  d.storage.prepare('DROP TRIGGER fail_index_done').run();expect(resumed.applyOneReady(NOW)).toBe('none');expect(resumed.applyOneReady(addMs(NOW,300000))).toBe('applied');expect(d.storage.prepare('SELECT count(*) AS n FROM memory_index').get()!.n).toBe(1);
  expect(d.store.job<any>('memory_index_jobs',job.id)).toMatchObject({status:'done',completionReason:'applied'});expect(resumed.applyOneReady(addMs(NOW,300000))).toBe('none');expect(d.models.runModel).not.toHaveBeenCalled();
});
it('accepts an index after state-only change but rejects obsolete text revision and signature',()=>{
  const d=open(':memory:');const row=d.store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'A'},NOW);d.store.saveOwner(row);d.store.queueIndex(row,NOW,d.index.configSignature);let job=d.store.jobs<any>('memory_index_jobs')[0];d.store.saveJob('memory_index_jobs',{...job,status:'ready',result:[1,0]});d.store.saveOwner({...row,stateVersion:2});expect(d.maintenance.applyOneReady(NOW)).toBe('applied');
  d.store.saveOwner({...row,revision:2,stateVersion:3});d.store.queueIndex({...row,revision:2,stateVersion:3},NOW,d.index.configSignature);job=d.store.jobs<any>('memory_index_jobs').find(j=>j.status==='pending');d.store.saveJob('memory_index_jobs',{...job,status:'ready',result:[1,0]});d.store.saveOwner({...row,revision:3,stateVersion:4});expect(d.maintenance.applyOneReady(NOW)).toBe('stale');expect(d.store.job<any>('memory_index_jobs',job.id).completionReason).toBe('stale');
});
it('supersedes only one old-config pending index per apply call without issuing an incompatible remote request',()=>{
  const d=open(':memory:');for(const id of ['a','b']){const row=d.store.makeOwner({ownerType:'detail',ownerId:id},{content:'A'},NOW);d.store.saveOwner(row);d.store.queueIndex(row,NOW,'old-config');}
  expect(d.maintenance.applyOneReady(NOW)).toBe('stale');expect(d.store.jobs<any>('memory_index_jobs').filter(j=>j.configSignature==='old-config'&&j.status==='pending')).toHaveLength(1);expect(d.store.jobs<any>('memory_index_jobs').filter(j=>j.configSignature===d.index.configSignature)).toHaveLength(1);expect(d.models.runModel).not.toHaveBeenCalled();
});
it('ordinary story commit normalizes all short deltas without a finite background budget',async()=>{
 const d=setup();stores.push(d.storage);saveInput(d.storage,'a','记录三个片段');
 const store=new MemoryStore(d.storage);store.migrate(NOW);
 const capacity=new MemoryCapacity(store,{...defaultMemoryCapacity,shortActiveLimit:1,longActiveLimit:2}),normalize=vi.spyOn(capacity,'normalize');
 d.models.outputs.memory={schemaVersion:3,shortTermChanges:Array.from({length:3},(_,i)=>({action:'create',clientRef:`s-${i}`,content:`详情${i}`,eventSummary:`摘要${i}`,feelingSummary:'开心',topics:[],sourceIds:['a'],importance:'normal'})),longTermChanges:[],detailChanges:[]};
 await new HdsiApp({...d,memoryStore:store,memoryLifecycle:new MemoryLifecycle(store,capacity),memoryCapacity:capacity}).runTurn({inputMessageIds:['a'],taskIds:[],triggerKinds:['input']});
 expect(normalize).toHaveBeenCalledTimes(1);expect(normalize.mock.calls[0]).toEqual([NOW,[]]);
 expect(normalize.mock.results[0].value.changedOwners).toHaveLength(4);
 expect(capacity.counts(NOW)).toMatchObject({shortActive:1,longOccupied:3,protectedLong:1,longOverflow:1});
 expect(store.allOwners().filter(row=>row.kind==='short'&&row.capacityExitedAt===NOW)).toHaveLength(2);
 expect(d.storage.all('turns')[0]).toMatchObject({done:true,frozenResult:null});
 normalize.mockRestore();
});
