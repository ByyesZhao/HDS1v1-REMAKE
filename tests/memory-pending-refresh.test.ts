import {it,expect} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {MemoryIdle} from '../src/memory/idle';
const min=(n:number)=>new Date(Date.parse(at)+n*60000).toISOString();
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup(){const d=fixture(),idle=new MemoryIdle(d.storage,15,true);idle.record('story',at);d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:days(1)});
 const index=new MemoryIndex(d.store,{model:'offline',embed:async()=>[1,0]},{clock:d.clock});
 const maintenance=new MemoryMaintenance(d.store,new MemoryLifecycle(d.store),index,d.models,{clock:d.clock,idle});
 d.models.outputs.memory_consolidation=(i:any)=>({units:i.selectedIds.map((id:string)=>({unitKey:id,action:'retain',ids:[id],readOwners:[id],sourceIds:[]}))});return {...d,idle,index,maintenance};}
it('idle wait creates no snapshot and t20 dispatch freezes the t5 update once',async()=>{
 const d=setup(),old=long(d.store,'a');d.store.queueDirty(old,'event',at);
 expect(d.maintenance.startOne(at)).toBe(false);expect(d.store.jobs('memory_maintenance_jobs')).toHaveLength(0);
 const newer={...old,content:'t5 new',revision:2,stateVersion:2};d.store.saveOwner(newer);d.store.queueDirty(newer,'event',min(5));d.idle.record('input',min(5));d.clock.time=min(20);
 expect(d.maintenance.startOne(min(20))).toBe(true);expect(d.models.calls[0].input.resources.owners[0].content).toBe('t5 new');await flush();expect(d.maintenance.applyOneReady(min(20))).toBe('applied');expect(d.models.calls).toHaveLength(1);await d.maintenance.stop();
});
it.each([null,at,undefined])('only explicit unstarted pending refreshes selected and dependency closure (%s)',async startedAt=>{
 const d=setup(),a=long(d.store,'a'),b=long(d.store,'b');
 const learned=d.store.makeOwner({ownerType:'learned',ownerId:'u'},{content:'old',canonicalMemoryId:'a',evidenceMemoryIds:['a','b']},at);d.store.saveOwner(learned);d.store.queueDirty(learned,'learned',at);d.store.reserveDirty(learned);
 d.store.saveJob('memory_maintenance_jobs',{id:'j',startedAt,kind:'audit',cutoff:at,createdAt:at,status:'pending',snapshot:[learned,a,b],selectedIds:['u'],readSet:[learned,a,b],result:null,appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null});
 const current={...b,content:'new evidence',revision:2,stateVersion:2};d.store.saveOwner(current);d.store.queueDirty(current,'event',min(5));d.clock.time=min(20);
 d.models.outputs.memory_consolidation={units:[{unitKey:'u',action:'review_learned',ids:['u'],targetId:'u',readOwners:['u','a','b'],sourceIds:[],decision:'retain'}]};
 expect(d.maintenance.startOne(min(20))).toBe(true);const input=d.models.calls[0].input;
 const evidence=input.resources.owners.find((r:any)=>r.id==='b');expect(evidence.content??evidence.eventSummary).toBe(startedAt===null?'new evidence':b.content);
 expect(input.context.cutoff).toBe(startedAt===null?min(20):at);await flush();await d.maintenance.stop();
});
it('exact release never frees a newer reservation',()=>{
 const d=setup(),old=long(d.store,'a');d.store.queueDirty(old,'event',at);d.store.reserveDirty(old);
 const row={...old,stateVersion:2};d.store.queueDirty(row,'event',min(5));d.store.reserveDirty(row);d.store.releaseDirtyVersion(old);
 expect(d.store.dirtyOwners()[0].status).toBe('reserved');
 d.store.releaseDirtyVersion(row);expect(d.store.dirtyOwners()[0].status).toBe('pending');
});
