import {expect,it} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {MemoryIdle} from '../src/memory/idle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {consolidationTask} from '../src/model/contracts';
import type {MemoryCandidate} from '../src/memory/types';
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
 d.maintenance.startOne(min(15));expect(d.models.calls[0].input.context.selectedIds).toHaveLength(20);await flush();while(d.maintenance.applyOneReady(min(15))!=='none'){}
 expect(d.maintenance.startOne(min(15))).toBe(true);expect(d.models.calls[1].input.context.selectedIds).toHaveLength(1);await flush();d.maintenance.applyOneReady(min(15));expect(d.maintenance.startOne(min(15))).toBe(false);expect(d.models.calls).toHaveLength(2);await d.maintenance.stop();
});
it('blocked_ready_no_zero_timer and retry_pause_stop_gates',async()=>{
 const d=create();deep(d);d.storage.set('runtime',{...d.storage.runtime(),sharedClock:{activityId:'shared',status:'active',startedAt:at,lastInputAt:null,lastOutputAt:null,lastSilentCompletedAt:null,mode:'shared_offline'}});
 expect(d.maintenance.nextDeadline(min(30))).toBe(days(1));expect(d.maintenance.applyOneReady(min(30))).toBe('none');
 d.storage.set('runtime',{...d.storage.runtime(),sharedClock:null,paused:true});expect(d.maintenance.applyOneReady(min(30))).toBe('none');expect(d.maintenance.startOne(min(30))).toBe(false);await d.maintenance.stop();expect(d.maintenance.nextDeadline(min(30))).toBeNull();
});
it('reserved_linked_long_waits_for_retry_without_zero_timer',async()=>{
 const d=create(),l=long(d.store,'reserved-long'),s=d.store.makeOwner({ownerType:'short',ownerId:'new-short'},{content:'新进展',linkedLongId:l.id,sourceIds:['e']},at);
 d.store.saveOwner(s);d.store.queueDirty(s,'event',min(1));
 d.store.saveJob('memory_maintenance_jobs',{id:'retry-long',createdAt:at,cutoff:at,status:'pending',snapshot:[l],selectedIds:[l.id],readSet:[l],result:null,appliedUnitKeys:[],staleUnitKeys:[],retryAt:min(20),lastError:'temporary failure'});
 d.clock.time=min(15);expect(d.maintenance.startOne(min(15))).toBe(false);expect(d.maintenance.nextDeadline(min(15))).toBe(min(20));expect(d.models.calls).toHaveLength(0);
 await d.maintenance.stop();
});
it('dirty_detail_audit_reads_related_fact_and_source_evidence',async()=>{
 const d=create(),prior=d.store.makeOwner({ownerType:'detail',ownerId:'phone-alias'},{key:'character.phone',value:'旧A牌',content:'旧A牌',sourceIds:['old-source']},at);
 d.store.saveOwner(prior);const evidence=long(d.store,'phone-evidence',{content:'真实来源说是新B牌',sourceIds:['new-source']});
 d.store.saveOwner(d.store.makeOwner({ownerType:'detail',ownerId:'phone'},{key:'character.phone',value:'新B牌',content:'新B牌',sourceIds:['new-source']},at));
 const target=d.store.owner({ownerType:'detail',ownerId:'phone'})!;d.store.queueDirty(target,'detail',at);d.clock.time=min(15);
 d.models.outputs.memory_consolidation=(input:any)=>({units:[{unitKey:'conflict',action:'review_detail',ids:[target.id],targetId:target.id,readOwners:[target.id,prior.id,evidence.id],sourceIds:['new-source'],decision:'report_conflict',reason:'同一事实键值冲突，仅报告'}]});
 expect(d.maintenance.startOne(min(15))).toBe(true);await flush();const call=d.models.calls[0];expect(call.input.resources.owners.map((r:MemoryCandidate)=>r.id)).toEqual(expect.arrayContaining([target.id,prior.id,evidence.id]));
 expect(d.maintenance.applyOneReady(min(15))).toBe('applied');expect(d.store.owner(target)?.value).toBe('新B牌');expect(d.store.storage.prepare('SELECT count(*) n FROM memory_audit_reports').get()!.n).toBe(1);await d.maintenance.stop();
});
