import { afterEach,expect,it,vi } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';
import { MemoryLifecycle } from '../src/memory/lifecycle';
import { MemoryIndex } from '../src/memory/index';
import { MemoryMaintenance } from '../src/memory/maintenance';
import { TestClock,NOW } from './helpers';
const stores:Storage[]=[];const dirs:string[]=[];afterEach(()=>{stores.splice(0).forEach(s=>s.close());dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}));});
function open(path:string){const storage=new Storage(path);stores.push(storage);const store=new MemoryStore(storage);store.migrate(NOW);const clock=new TestClock(),models:any={runModel:vi.fn()},index=new MemoryIndex(store,{model:'test',embed:async()=>[1,0]},{clock});const maintenance=new MemoryMaintenance(store,new MemoryLifecycle(store),index,models,{clock});return {storage,store,maintenance,models,index};}
it('reopens ready without recomputing, rolls back owner and marker together, and skips completed units',()=>{
  const dir=mkdtempSync(join(tmpdir(),'hdsi-maint-'));dirs.push(dir);const path=join(dir,'test.sqlite');let d=open(path);const row=d.store.makeOwner({ownerType:'long',ownerId:'a'},{content:'手机preview',sourceIds:['s']},NOW);d.store.saveOwner(row);
  d.store.saveJob('memory_maintenance_jobs',{id:'job',cutoff:NOW,createdAt:NOW,status:'ready',snapshot:[row],readSet:[row],result:[{unitKey:'u',action:'refine',readSet:[row],ids:['a'],content:'手机refined',eventSummary:'手机',feelingSummary:'开心',sourceIds:['s']}],appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null});
  d.storage.close();stores.splice(stores.indexOf(d.storage),1);d=open(path);const save=d.store.saveJob.bind(d.store);vi.spyOn(d.store,'saveJob').mockImplementation(()=>{throw new Error('commit failed');});expect(()=>d.maintenance.applyOneReady(NOW)).toThrow('commit failed');expect(d.store.owner(row)!.content).toBe('手机preview');expect(d.store.job<any>('memory_maintenance_jobs','job').appliedUnitKeys).toEqual([]);d.store.saveJob=save;expect(d.maintenance.applyOneReady(NOW)).toBe('applied');expect(d.maintenance.applyOneReady(NOW)).toBe('none');expect(d.models.runModel).not.toHaveBeenCalled();
});
it('resets computing to pending, preserves cutoff and atomically writes ready index with done marker',()=>{
  const d=open(':memory:');const row=d.store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'A',key:'phone',value:'A'},NOW);d.store.saveOwner(row);d.store.queueIndex(row,NOW,d.index.configSignature);const job=d.store.jobs<any>('memory_index_jobs')[0];d.store.saveJob('memory_index_jobs',{...job,status:'computing'});d.storage.set('memory_maintenance_cycle',{cutoff:NOW});
  const resumed=new MemoryMaintenance(d.store,new MemoryLifecycle(d.store),d.index,d.models,{clock:new TestClock()});expect(d.store.job<any>('memory_index_jobs',job.id).status).toBe('pending');expect(d.storage.get('memory_maintenance_cycle')).toEqual({cutoff:NOW});
  d.store.saveJob('memory_index_jobs',{...job,status:'ready',result:[1,0]});const save=d.store.saveJob.bind(d.store);vi.spyOn(d.store,'saveJob').mockImplementation(()=>{throw new Error('index rollback');});expect(()=>resumed.applyOneReady(NOW)).toThrow('index rollback');expect(d.storage.prepare('SELECT count(*) AS n FROM memory_index').get()!.n).toBe(0);d.store.saveJob=save;expect(resumed.applyOneReady(NOW)).toBe('applied');expect(d.store.job<any>('memory_index_jobs',job.id)).toMatchObject({status:'done',completionReason:'applied'});expect(resumed.applyOneReady(NOW)).toBe('none');
});
it('accepts an index after state-only change but rejects obsolete text revision and signature',()=>{
  const d=open(':memory:');const row=d.store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'A'},NOW);d.store.saveOwner(row);d.store.queueIndex(row,NOW,d.index.configSignature);let job=d.store.jobs<any>('memory_index_jobs')[0];d.store.saveJob('memory_index_jobs',{...job,status:'ready',result:[1,0]});d.store.saveOwner({...row,stateVersion:2});expect(d.maintenance.applyOneReady(NOW)).toBe('applied');
  d.store.saveOwner({...row,revision:2,stateVersion:3});d.store.queueIndex({...row,revision:2,stateVersion:3},NOW,d.index.configSignature);job=d.store.jobs<any>('memory_index_jobs').find(j=>j.status==='pending');d.store.saveJob('memory_index_jobs',{...job,status:'ready',result:[1,0]});d.store.saveOwner({...row,revision:3,stateVersion:4});expect(d.maintenance.applyOneReady(NOW)).toBe('stale');expect(d.store.job<any>('memory_index_jobs',job.id).completionReason).toBe('stale');
});
it('supersedes only one old-config pending index per apply call without issuing an incompatible remote request',()=>{
  const d=open(':memory:');for(const id of ['a','b']){const row=d.store.makeOwner({ownerType:'detail',ownerId:id},{content:'A'},NOW);d.store.saveOwner(row);d.store.queueIndex(row,NOW,'old-config');}
  expect(d.maintenance.applyOneReady(NOW)).toBe('stale');expect(d.store.jobs<any>('memory_index_jobs').filter(j=>j.configSignature==='old-config'&&j.status==='pending')).toHaveLength(1);expect(d.store.jobs<any>('memory_index_jobs').filter(j=>j.configSignature===d.index.configSignature)).toHaveLength(1);expect(d.models.runModel).not.toHaveBeenCalled();
});
