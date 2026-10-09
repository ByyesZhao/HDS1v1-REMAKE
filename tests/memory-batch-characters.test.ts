import {it,expect} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {MemoryIdle} from '../src/memory/idle';
const min=(n:number)=>new Date(Date.parse(at)+n*60000).toISOString();
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup(idle=true,limits:{batchItems?:number;batchCharacters?:number|null}={}){
 const d=fixture();d.clock.time=min(20);d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:idle?days(1):at});
 const helper=idle?new MemoryIdle(d.storage,15,true):undefined;helper?.record('story',at);
 d.models.outputs.memory_consolidation=(i:any)=>({units:i.selectedIds.map((id:string)=>({unitKey:id,action:'retain',ids:[id],readOwners:[id],sourceIds:[]}))});
 const index=new MemoryIndex(d.store,{model:'offline',embed:async()=>[1,0]},{clock:d.clock});
 const maintenance=new MemoryMaintenance(d.store,new MemoryLifecycle(d.store),index,d.models,{clock:d.clock,idle:helper,...limits});
 return {...d,maintenance,idle:helper};
}
function add(d:ReturnType<typeof setup>,id:string,content:string,idle=true){const r=long(d.store,id,{content,totalAwakenings:idle?0:30});d.store.queueDirty(r,'event',at);return r;}
it.each([true,false])('main selection honors optional full-content soft target (idle=%s)',async idle=>{
 for(const sample of [
 {texts:['a'.repeat(120),'b'.repeat(120),'c'.repeat(120)],limit:150,items:20,want:['a']},
 {texts:['a'.repeat(120),'b'.repeat(30),'c'],limit:150,items:20,want:['a','b']},
 {texts:['a'.repeat(200),'b'.repeat(10)],limit:150,items:20,want:['a']},
 {texts:['😀'.repeat(60),'😀'.repeat(15),'😀'],limit:75,items:20,want:['a','b']},
 {texts:['a'.repeat(120),'b'.repeat(120),'c'],limit:null,items:2,want:['a','b']},
 {texts:['a'.repeat(120),'b'.repeat(120),'c'],limit:null,items:20,want:['a','b','c']},
 ]){
 const d=setup(idle,{batchCharacters:sample.limit,batchItems:sample.items});
 sample.texts.forEach((text,i)=>add(d,String.fromCharCode(97+i),text,idle));
 expect(d.maintenance.startOne(d.clock.now())).toBe(true);
 const input=d.models.calls[0].input;expect(input.context.selectedIds).toEqual(sample.want);
 for(const id of sample.want)expect(input.resources.owners.find((r:any)=>r.id===id).eventSummary).toBe(sample.texts[id.charCodeAt(0)-97]);
 if(idle)for(const r of d.store.dirtyOwners().filter(r=>!sample.want.includes(r.ownerId)))expect(r).toMatchObject({status:'pending',queuedAt:at});
 await flush();await d.maintenance.stop();
 }
});
it('dependency closure is complete beyond the main character soft target',async()=>{
 const d=setup(true,{batchCharacters:150});
 const l=add(d,'long','L'.repeat(300));d.store.completeDirty(l,l);
 const s=d.store.makeOwner({ownerType:'short',ownerId:'short'},{content:'S'.repeat(120),linkedLongId:l.id,shortExpiresAt:days(2),sourceIds:['short']},at);d.store.saveOwner(s);d.store.queueDirty(s,'event',at);
 expect(d.maintenance.startOne(d.clock.now())).toBe(true);
 const input=d.models.calls[0].input;expect(input.context.selectedIds).toEqual(['short']);expect(input.resources.owners.find((r:any)=>r.id==='long').eventSummary).toBe('L'.repeat(300));await flush();await d.maintenance.stop();
});
function pending(d:ReturnType<typeof setup>,rows:ReturnType<typeof long>[],startedAt:string|null|undefined,retryAt:string|null=null){
 for(const r of rows)d.store.reserveDirty(r);
 d.store.saveJob('memory_maintenance_jobs',{id:'prior',kind:'consolidation',startedAt,cutoff:at,createdAt:at,status:'pending',snapshot:rows,selectedIds:rows.map(r=>r.id),readSet:rows,result:null,appliedUnitKeys:[],staleUnitKeys:[],retryAt,lastError:null});
}
it('unstarted growth releases deferred main without losing FIFO to later arrivals',async()=>{
 const d=setup(true,{batchCharacters:150}),a=add(d,'a','a'.repeat(60)),b=add(d,'b','b'.repeat(60));pending(d,[a,b],null);
 const newer={...a,content:'a'.repeat(120),revision:2,stateVersion:2};d.store.saveOwner(newer);d.store.queueDirty(newer,'event',min(5));
 const c=long(d.store,'c',{content:'c'.repeat(120)});d.store.queueDirty(c,'event',min(10));
 expect(d.maintenance.startOne(d.clock.now())).toBe(true);
 expect(d.models.calls[0].input.context.selectedIds).toEqual(['a']);expect(d.store.jobs('memory_maintenance_jobs')).toHaveLength(1);
 expect(d.store.dirtyOwners().find(r=>r.ownerId==='b')).toMatchObject({status:'pending',queuedAt:at});
 await flush();expect(d.maintenance.applyOneReady(d.clock.now())).toBe('applied');
 expect(d.maintenance.startOne(d.clock.now())).toBe(true);expect(d.models.calls[1].input.context.selectedIds).toEqual(['b']);
 await flush();await d.maintenance.stop();
});
it.each([null,at,undefined])('retry deadline only suppresses new batches for explicitly unstarted task (%s)',async startedAt=>{
 const d=setup(true,{batchCharacters:150}),a=add(d,'a','a'),b=add(d,'b','b');pending(d,[a],startedAt,min(30));
 expect(d.maintenance.nextDeadline(d.clock.now())).toBe(startedAt===null?min(30):d.clock.now());
 const ran=d.maintenance.startOne(d.clock.now());
 expect(ran).toBe(startedAt!==null);
 expect(d.store.jobs('memory_maintenance_jobs')).toHaveLength(startedAt===null?1:2);
 if(ran)await flush();await d.maintenance.stop();
});
it.each([null,at,undefined])('smaller target refreshes only explicitly unstarted frozen inputs (%s)',async startedAt=>{
 const d=setup(true,{batchCharacters:150}),a=add(d,'a','a'.repeat(120)),b=add(d,'b','b'.repeat(120));pending(d,[a,b],startedAt);
 expect(d.maintenance.startOne(d.clock.now())).toBe(true);
 expect(d.models.calls[0].input.context.selectedIds).toEqual(startedAt===null?['a']:['a','b']);
 expect(d.store.job<any>('memory_maintenance_jobs','prior')).toMatchObject({id:'prior',createdAt:at,cutoff:startedAt===null?d.clock.now():at});
 await flush();await d.maintenance.stop();
});
it('audit class selection keeps the first dirty category and FIFO order',async()=>{
 const d=setup(true,{batchCharacters:150});
 const detail=d.store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'a'.repeat(120),key:'phone',value:'a'.repeat(120),sourceIds:[]},at);d.store.saveOwner(detail);d.store.queueDirty(detail,'detail',at);
 const l=long(d.store,'l');d.store.queueDirty(l,'event',min(1));
 const learned=d.store.makeOwner({ownerType:'learned',ownerId:'u'},{content:'b'.repeat(120),sourceIds:[]},at);d.store.saveOwner(learned);d.store.queueDirty(learned,'learned',min(2));
 expect(d.maintenance.startOne(d.clock.now())).toBe(true);expect(d.models.calls[0].input.context.selectedIds).toEqual(['phone']);expect(d.store.job<any>('memory_maintenance_jobs',d.store.jobs<any>('memory_maintenance_jobs')[0].id).kind).toBe('audit');await flush();await d.maintenance.stop();
});

it('deferred main can remain an unreserved required dependency',async()=>{
 const d=setup(true,{batchCharacters:150}),a=add(d,'a','a'.repeat(120)),b=add(d,'b','b'.repeat(120));
 const updated={...a,linkedLongId:'b'};d.store.saveOwner(updated);pending(d,[updated,b],null);
 expect(d.maintenance.startOne(d.clock.now())).toBe(true);
 const job=d.store.job<any>('memory_maintenance_jobs','prior');expect(job.selectedIds).toEqual(['a']);expect(job.snapshot.map((r:any)=>r.id)).toContain('b');
 expect(d.store.dirtyOwners().find(r=>r.ownerId==='b')).toMatchObject({status:'pending',queuedAt:at});await flush();await d.maintenance.stop();
});
