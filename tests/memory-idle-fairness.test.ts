import {expect,it} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {MemoryIdle} from '../src/memory/idle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {consolidationTask} from '../src/model/contracts';
const min=(n:number)=>new Date(Date.parse(at)+n*60000).toISOString();
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function create(){const d=fixture(),idle=new MemoryIdle(d.storage,15,true);idle.record('story',at);d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:days(1)});const index=new MemoryIndex(d.store,{model:'offline',embed:async()=>[1,0]},{clock:d.clock}),maintenance=new MemoryMaintenance(d.store,new MemoryLifecycle(d.store),index,d.models,{clock:d.clock,idle});d.models.outputs.memory_consolidation=(input:any)=>({units:input.selectedIds.map((id:string)=>({unitKey:id,action:'retain',ids:[id],readOwners:[id],sourceIds:[]}))});return {...d,idle,index,maintenance};}
function deep(d:ReturnType<typeof create>,status='ready'){
 const a=long(d.store,'a'),b=long(d.store,'b');const result=consolidationTask([a,b],['a','b']).parse({units:[a,b].map(r=>({unitKey:r.id,action:'refine',ids:[r.id],readOwners:[r.id],content:`整理${r.id}`,sourceIds:r.sourceIds}))});
 d.store.saveJob('memory_maintenance_jobs',{id:'deep',createdAt:at,cutoff:at,status,snapshot:[a,b],selectedIds:['a','b'],readSet:[a,b],result:status==='ready'?result:null,appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null});return {a,b};
}
it('deep_ready_ineligible_index_runs',async()=>{
 const d=create();deep(d);const row=long(d.store,'index');d.store.queueIndex(row,min(1),d.index.configSignature);
 expect(d.maintenance.applyOneReady(min(2))).toBe('none');expect(d.maintenance.startOne(min(2))).toBe(true);await flush();expect(d.maintenance.applyOneReady(min(2))).toBe('applied');expect(d.store.canonical('a')?.content).toBe('经历-a');expect(d.maintenance.nextDeadline(min(2))).toBe(min(15));await d.maintenance.stop();
});
it('eligible_fifo_no_index_starvation',async()=>{
 const d=create();deep(d,'pending');const row=long(d.store,'later');d.store.queueIndex(row,min(1),d.index.configSignature);d.clock.time=min(15);
 expect(d.maintenance.startOne(min(15))).toBe(true);expect(d.models.calls[0].name).toBe('memory_consolidation');await flush();expect(d.maintenance.applyOneReady(min(15))).toBe('applied');await d.maintenance.stop();
});
it('new_input_between_units_resets_15_minutes',async()=>{
 const d=create();deep(d);expect(d.maintenance.applyOneReady(min(15))).toBe('applied');d.idle.record('input',min(16));expect(d.maintenance.applyOneReady(min(16))).toBe('none');
 expect(d.maintenance.startOne(min(16))).toBe(true);await flush();expect(d.maintenance.applyOneReady(min(16))).toBe('applied');
 expect(d.maintenance.nextDeadline(min(16))).toBe(min(31));expect(d.maintenance.applyOneReady(min(31))).toBe('applied');await d.maintenance.stop();
});
it('empty_night_zero_calls and eligible_batches_not_every_15_minutes',async()=>{
 const d=create();d.clock.time=min(15);expect(d.maintenance.startOne(min(15))).toBe(false);expect(d.models.calls).toEqual([]);
 for(let i=0;i<21;i++){const r=long(d.store,`e${String(i).padStart(2,'0')}`);d.store.queueDirty(r,'event',at);}
 d.maintenance.startOne(min(15));expect(d.models.calls[0].input.selectedIds).toHaveLength(20);await flush();while(d.maintenance.applyOneReady(min(15))!=='none'){}
 expect(d.maintenance.startOne(min(15))).toBe(true);expect(d.models.calls[1].input.selectedIds).toHaveLength(1);await flush();d.maintenance.applyOneReady(min(15));expect(d.maintenance.startOne(min(15))).toBe(false);expect(d.models.calls).toHaveLength(2);await d.maintenance.stop();
});
it('blocked_ready_no_zero_timer and retry_pause_stop_gates',async()=>{
 const d=create();deep(d);const state=d.storage.character();state.scene.activity={description:'洗澡',startsAt:at,expectedEndAt:min(3),phoneAccess:false};d.storage.set('character',state);
 expect(d.maintenance.nextDeadline(min(30))).toBe(days(1));expect(d.maintenance.applyOneReady(min(30))).toBe('none');
 state.scene.activity=null;d.storage.set('character',state);d.storage.set('runtime',{...d.storage.runtime(),paused:true});expect(d.maintenance.applyOneReady(min(30))).toBe('none');expect(d.maintenance.startOne(min(30))).toBe(false);await d.maintenance.stop();expect(d.maintenance.nextDeadline(min(30))).toBeNull();
});
