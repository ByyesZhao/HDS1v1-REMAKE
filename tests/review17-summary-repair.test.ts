import {expect,it} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {memoryTask,consolidationTask} from '../src/model/contracts';
import {MemoryCapacity} from '../src/memory/capacity';import {MemoryCleanup} from '../src/memory/cleanup';
import {MemoryLifecycle} from '../src/memory/lifecycle';import {MemoryMaintenance} from '../src/memory/maintenance';import {MemoryIndex} from '../src/memory/index';import {MemoryIdle} from '../src/memory/idle';
import {defaultMemoryCapacity} from '../src/memory/types';
const change={action:'create',clientRef:'s',content:'保留详细过程',eventSummary:'',feelingSummary:'',sourceIds:['e'],topics:[],importance:'normal'};
it.each([['',''],[' \n','\t']])('basic memory rejects two blank summaries: %s / %s',(eventSummary,feelingSummary)=>{
 expect(()=>memoryTask(['e'],[]).parse({schemaVersion:3,shortTermChanges:[{...change,eventSummary,feelingSummary}],longTermChanges:[],detailChanges:[]})).toThrow(/summary/i);
});
it.each([['事件',''],['','有点安心']])('one meaningful summary suffices: %s / %s',(eventSummary,feelingSummary)=>{
 expect(()=>memoryTask(['e'],[]).parse({schemaVersion:3,shortTermChanges:[{...change,eventSummary,feelingSummary}],longTermChanges:[],detailChanges:[]})).not.toThrow();
});
function broken(sources=['e']){
 const d=fixture(),l=long(d.store,'l',{content:'',eventSummary:'',feelingSummary:'',expiresAt:days(90)}),s=d.store.makeOwner({ownerType:'short',ownerId:'s'},{content:'唯一详细过程',eventSummary:'',feelingSummary:'',sourceIds:sources,shortExpiresAt:days(7),linkedLongId:l.id},at);
 d.store.saveOwner(s);for(const r of [s,l]){d.store.queueDirty(r,'event',at);d.store.completeDirty(r,r);}
 const cap=new MemoryCapacity(d.store,{...defaultMemoryCapacity,longArchiveLimit:0});return {...d,l,s,cap,cleanup:new MemoryCleanup(d.store,cap)};
}
it('readonly retained-reference policy protects missing summary after short expiry',()=>{
 const d=broken();expect(d.cap.protectedIds(days(6),true).has('l')).toBe(true);expect(d.cap.protectedIds(days(188),true).has('l')).toBe(true);
});
it('overdue missing summary protects long and registers one repair despite processed watermark',()=>{
 const d=broken();expect(d.cleanup.applyOne(days(188))).toBe('applied');expect(d.store.canonical('l')).not.toBeNull();expect(d.store.dirtyOwners().map(r=>r.ownerId)).toContain('s');
 const v=d.store.owner(d.s)!.stateVersion;expect(d.cleanup.applyOne(days(188))).toBe('blocked');expect(d.store.owner(d.s)!.stateVersion).toBe(v);
 expect(d.cleanup.nextDeadline(days(188))).toBeNull();expect(d.cleanup.status().blockedIds).toContain('s:missing_summary');
});
it('without historical sources stays protected and blocked without empty repair loops',()=>{
 const d=broken([]);d.store.saveOwner({...d.l,sourceIds:[]});expect(d.cleanup.applyOne(days(188))).toBe('blocked');expect(d.store.canonical('l')).not.toBeNull();expect(d.store.dirtyOwners()).toHaveLength(0);expect(d.cleanup.nextDeadline(days(188))).toBeNull();
});
it('missing summary repair cannot silently retain or discard the only summary identity',()=>{
 const d=broken();for(const action of ['retain','discard'])expect(()=>consolidationTask([d.s,d.l],['s']).parse({units:[{unitKey:'r',action,ids:['s','l'],readOwners:['s','l'],sourceIds:[]}]})).toThrow(/summary/i);
});
it('idle repair closes cleanup in short-then-long order without granting new lifetime',async()=>{
 const d=broken(),idle=new MemoryIdle(d.storage,15,true),life=new MemoryLifecycle(d.store,d.cap),index=new MemoryIndex(d.store,{model:'offline',embed:async()=>[1,0]},{clock:d.clock});
 d.clock.time=days(188);idle.record('story',d.clock.now());d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:null});
 d.store.saveVector(d.s,'old',new Float32Array([1,0]));d.store.saveVector(d.l,'old',new Float32Array([1,0]));
 d.models.outputs.memory_consolidation=(input:any)=>({units:[{unitKey:'repair',action:'refine',ids:[...new Set([...input.selectedIds,'s','l'])],readOwners:['s','l'],content:'简要事件与感受',eventSummary:'简要事件',feelingSummary:'安心',sourceIds:['e']}]});
 const m=new MemoryMaintenance(d.store,life,index,d.models,{clock:d.clock,idle});
 try{
  d.cleanup.applyOne(d.clock.now());expect(m.startOne(d.clock.now())).toBe(false);d.clock.advance(15*60000);expect(m.startOne(d.clock.now())).toBe(true);
  for(let i=0;i<30;i++)await Promise.resolve();expect(m.applyOneReady(d.clock.now())).toBe('applied');
  expect(d.store.canonical('l')).toMatchObject({content:'简要事件与感受',expiresAt:days(90),lastEventUpdateAt:at});expect(d.store.listGrants('l')).toHaveLength(0);
  expect(d.cleanup.applyOne(d.clock.now())).toBe('applied');expect(d.store.owner(d.s)).toBeNull();expect(d.store.canonical('l')).not.toBeNull();
  expect(d.cleanup.applyOne(d.clock.now())).toBe('applied');expect(d.store.canonical('l')).toBeNull();
  expect(d.storage.prepare('SELECT count(*) n FROM memory_index').get()!.n).toBe(0);expect(d.store.dirtyOwners()).toHaveLength(0);expect(d.store.jobs('memory_index_jobs')).toHaveLength(0);
  expect(d.store.jobs<any>('memory_maintenance_jobs').every(j=>j.snapshot.length===0&&j.result===null)).toBe(true);
  expect(d.cleanup.nextDeadline(d.clock.now())).toBeNull();expect(m.nextDeadline(d.clock.now())).toBeNull();
 }finally{await m.stop();}
});
