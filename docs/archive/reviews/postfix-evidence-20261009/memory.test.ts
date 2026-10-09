import {afterEach,expect,it} from 'vitest';
import {setup} from '../../../../tests/helpers';
import {MemoryStore} from '../../../../src/memory/store';
import {MemoryLifecycle} from '../../../../src/memory/lifecycle';
import {MemoryIndex} from '../../../../src/memory/index';
import {MemoryMaintenance} from '../../../../src/memory/maintenance';
import {ModelClient,type CompletionRequest} from '../../../../src/model/client';
import {WebSearchService} from '../../../../src/web/service';
import {WebSearchStore} from '../../../../src/web/store';
import {MemoryRetrieval,makeRetrievalRequest} from '../../../../src/memory/retrieval';
import type {IndexJob,MaintenanceJob} from '../../../../src/memory/types';
import {HdsiApp} from '../../../../src/app';
import {SerialHost} from '../../../../src/host/runtime';

const opened:ReturnType<typeof setup>[]=[];
afterEach(()=>opened.splice(0).forEach(d=>d.storage.close()));
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
function fixture(){const d=setup();opened.push(d);const store=new MemoryStore(d.storage);store.migrate(d.clock.now());return {...d,store,life:new MemoryLifecycle(store)};}

it('F4: real thirty-date promotion and canonical merge retain concrete lexical recall once',async()=>{
 const d=fixture(),at=d.clock.now();
 for(const id of ['a','b'])d.store.saveOwner(d.store.makeOwner({ownerType:'long',ownerId:id},{content:id==='a'?'火山石项链赠礼':'黄昏登山',sourceIds:['event-'+id],retainedFrom:at,expiresAt:new Date(Date.parse(at)+90*86400000).toISOString()},at));
 for(let i=0;i<30;i++)d.life.awaken({id:'a',turnId:'turn-'+i,at:new Date(Date.parse(at)+i*86400000).toISOString(),sourceIds:['event-a'],allowedIds:['a'],allowedSourceIds:['event-a']});
 const promotedAt=new Date(Date.parse(at)+29*86400000).toISOString();
 expect(d.store.canonical('a')!.totalAwakenings).toBe(30);
 d.life.promote('a','lesson','彼此会认真保存赠礼','stable_understanding',false,['a','b'],promotedAt);
 d.life.merge(['a','b'],'a',promotedAt);
 const lesson=d.store.owner({ownerType:'learned',ownerId:'lesson'})!;
 expect(lesson.canonicalMemoryId).toBe('a');expect(lesson.evidenceMemoryIds).toEqual(['a']);
 expect(lesson.evidenceVersions!.map(v=>v.ownerId)).toEqual(['a']);
 expect(d.life.repairLearnedProjections(promotedAt).changedOwnerIds).toEqual([]);
 const recalled=await new MemoryRetrieval(d.store).build(makeRetrievalRequest('火山石项链赠礼',promotedAt,'personal_chat'));
 expect(recalled.learned.map(r=>r.id)).toEqual(['lesson']);expect(recalled.longTerm).toEqual([]);
});

it('F5: failed started index retry preserves text while a newer unstarted revision remains queued',async()=>{
 const d=fixture(),texts:string[]=[];let failed=false;
 const index=new MemoryIndex(d.store,{model:'offline',embed:async text=>{texts.push(text);if(!failed){failed=true;throw Error('temporary');}return [1,0];}},{clock:d.clock});
 const maintenance=new MemoryMaintenance(d.store,d.life,index,d.models,{clock:d.clock,retryDelayMs:1000});
 const old=d.store.makeOwner({ownerType:'long',ownerId:'a'},{content:'old'},d.clock.now());d.store.saveOwner(old);d.store.queueIndex(old,d.clock.now());
 expect(maintenance.startOne(d.clock.now())).toBe(true);await flush();
 const first=d.store.jobs<IndexJob>('memory_index_jobs')[0];expect(first.startedAt).toBe(d.clock.now());expect(first.status).toBe('pending');
 const changed={...old,content:'new',revision:2,stateVersion:2};d.store.saveOwner(changed);d.store.queueIndex(changed,d.clock.now());
 expect(d.store.jobs<IndexJob>('memory_index_jobs',['pending'])).toHaveLength(2);
 d.clock.advance(1000);expect(maintenance.startOne(d.clock.now())).toBe(true);await flush();
 expect(texts).toHaveLength(2);expect(texts[1]).toContain('old');expect(maintenance.applyOneReady(d.clock.now())).toBe('stale');
 expect(maintenance.startOne(d.clock.now())).toBe(true);await flush();expect(texts[2]).toContain('new');expect(maintenance.applyOneReady(d.clock.now())).toBe('applied');await maintenance.stop();
});

it('F5 contract gap: a started maintenance retry must retain its saved model repair checkpoint',async()=>{
 const d=fixture(),requests:CompletionRequest[]=[],row=d.store.makeOwner({ownerType:'short',ownerId:'s'},{content:'旧事件',shortExpiresAt:d.clock.now()},d.clock.now());
 d.store.saveOwner(row);d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:d.clock.now()});
 const web=new WebSearchService(new WebSearchStore(d.storage),undefined,d.clock);
 const client=new ModelClient({complete:async request=>{requests.push({...request});if(requests.length===1)return {invalid:true};if(requests.length===2)throw Error('temporary transport interruption');return {units:[{unitKey:'keep',action:'retain',ids:['s'],readOwners:['s'],sourceIds:[]}]};}});
 const index=new MemoryIndex(d.store,{model:'offline',embed:async()=>[1,0]},{clock:d.clock});
 const maintenance=new MemoryMaintenance(d.store,d.life,index,client,{clock:d.clock,web,retryDelayMs:1000});
 expect(maintenance.startOne(d.clock.now())).toBe(true);await flush();
 const job=d.store.jobs<MaintenanceJob>('memory_maintenance_jobs')[0];
 expect(job.status).toBe('pending');expect(job.startedAt).toBe(d.clock.now());expect(requests[1].repair).toBeDefined();
 const ref=web.store.openStage('maintenance',job.id,'consolidation','memory_consolidation');
 const afterFailure=web.store.snapshot(ref.runId);
 d.clock.advance(1000);expect(maintenance.startOne(d.clock.now())).toBe(true);await flush();await maintenance.stop();
 expect(requests).toHaveLength(3);
 expect({checkpointAfterFailure:afterFailure.checkpoint,retryRepair:requests[2].repair}).toEqual({checkpointAfterFailure:expect.objectContaining({repairCount:1}),retryRepair:requests[1].repair});
});

it('F4: actual index completion callback retries deferred host repair without an extra manual wake',async()=>{
 const d=fixture(),at=d.clock.now();
 const main=d.store.makeOwner({ownerType:'long',ownerId:'main'},{content:'主事件依据',status:'durable'},at);d.store.saveOwner(main);
 const old=d.store.makeOwner({ownerType:'learned',ownerId:'old'},{content:'旧认识',canonicalMemoryId:'main'},at);d.store.saveOwner(old);
 let release!:(v:number[])=>void,host:SerialHost;const gate=new Promise<number[]>(resolve=>{release=resolve;});
 const index=new MemoryIndex(d.store,{model:'offline',embed:async()=>gate},{clock:d.clock});
 const maintenance=new MemoryMaintenance(d.store,d.life,index,d.models,{clock:d.clock,onReady:()=>void host.wake()});
 d.store.queueIndex(main,at);expect(maintenance.startOne(at)).toBe(true);
 host=new SerialHost(new HdsiApp({...d,memoryStore:d.store,memoryLifecycle:d.life,maintenance}),{timers:false});
 await host.start();expect(d.store.owner(old)!.projectionBasis).toBeUndefined();
 release([1,0]);for(let i=0;i<5;i++)await new Promise<void>(resolve=>setImmediate(resolve));
 expect(d.store.owner(old)!.projectionBasis?.content).toBe('主事件依据');await host.stop();
});
