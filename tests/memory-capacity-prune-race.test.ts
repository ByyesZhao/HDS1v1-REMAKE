import {expect,it,vi} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {consolidationTask} from '../src/model/contracts';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function create(){const d=fixture();let resolve!:(v:any)=>void;const waiting=new Promise<any>(r=>resolve=r);const models:any={runModel:async(t:any)=>t.parse(await waiting)};const index=new MemoryIndex(d.store,{model:'offline',embed:async()=>await waiting},{clock:d.clock});const maintenance=new MemoryMaintenance(d.store,new MemoryLifecycle(d.store),index,models,{clock:d.clock});return {...d,resolve,maintenance,index};}
function job(d:ReturnType<typeof create>,status='pending'){
 const a=long(d.store,'a'),b=long(d.store,'b');const raw={units:[a,b].map(r=>({unitKey:r.id,action:'refine',readOwners:[r.id],ids:[r.id],content:`摘要${r.id}`,sourceIds:r.sourceIds}))};
 d.store.saveJob('memory_maintenance_jobs',{id:'deep',createdAt:at,cutoff:at,status,snapshot:[a,b],selectedIds:['a','b'],readSet:[a,b],result:status==='ready'?consolidationTask([a,b],['a','b']).parse(raw):null,appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null});return raw;
}
it('late_prepare_does_not_restore_pruned_snapshot',async()=>{
 const d=create(),raw=job(d);expect(d.maintenance.startOne(at)).toBe(true);d.store.purgeOwner({ownerType:'long',ownerId:'a'},at);d.resolve(raw);await flush();
 const persisted=d.store.job<any>('memory_maintenance_jobs','deep');expect(JSON.stringify(persisted)).not.toContain('经历-a');expect(persisted.snapshot.map((r:any)=>r.id)).toEqual(['b']);expect(d.maintenance.applyOneReady(at)).toBe('applied');expect(d.store.canonical('a')).toBeNull();expect(d.store.canonical('b')?.content).toBe('摘要b');await d.maintenance.stop();
});
it('missing_owner_stale_other_unit_applies',()=>{
 const d=create();job(d,'ready');d.store.purgeOwner({ownerType:'long',ownerId:'a'},at);expect(d.maintenance.applyOneReady(at)).toBe('applied');expect(d.store.canonical('b')?.content).toBe('摘要b');expect(d.store.job<any>('memory_maintenance_jobs','deep').staleUnitKeys).toContain('a');
});
it('late_index_no_vector_resurrection',async()=>{
 const d=create(),a=long(d.store,'a');d.store.queueIndex(a,at,d.index.configSignature);d.maintenance.startOne(at);d.store.purgeOwner(a,at);d.resolve([1,0]);await flush();expect(d.store.jobs('memory_index_jobs')).toEqual([]);expect(d.storage.prepare('SELECT count(*) n FROM memory_index').get()!.n).toBe(0);await d.maintenance.stop();
});
it('timeout_no_pruned_retry',async()=>{
 vi.useFakeTimers();const d=create();job(d);d.maintenance.startOne(at);d.store.purgeOwner({ownerType:'long',ownerId:'a'},at);d.store.purgeOwner({ownerType:'long',ownerId:'b'},at);
 await vi.advanceTimersByTimeAsync(120000);expect(d.store.job<any>('memory_maintenance_jobs','deep').status).toBe('done');expect(d.maintenance.startOne(days(1))).toBe(false);await d.maintenance.stop();vi.useRealTimers();
});
it('completed_payload_compaction preserves webpage counters and unfinished recovery',()=>{
 const d=fixture(),web=new WebSearchService(new WebSearchStore(d.storage),undefined,d.clock);const ref=web.store.openStage('turn','done','memory','memory');web.store.saveCheckpoint(ref.runId,{input:{secret:'详细正文'},privateLookupResult:{content:'详细正文'},repair:{original:'详细正文',errors:'x'},repairCount:1,lookupUsed:true,pendingOperationId:null,toolResults:[]});
 web.compactOwnerCheckpoint('turn','done');expect(web.store.snapshot(ref.runId).checkpoint).toBeNull();expect(web.store.snapshot(ref.runId).counters).toEqual({successReads:0,failures:0});
 d.storage.save('post_jobs','done',{turnId:'done',result:{schemaVersion:3,shortTermChanges:[{content:'详细正文'}],longTermChanges:[],detailChanges:[]} as any});d.storage.save('turns','done',{id:'done',done:true} as any);
 d.storage.save('post_jobs','running',{turnId:'running',result:{schemaVersion:3,shortTermChanges:[{content:'恢复正文'}],longTermChanges:[],detailChanges:[]} as any});d.storage.save('turns','running',{id:'running',done:false} as any);
 d.store.compactCompletedPayloads();expect(d.storage.read('post_jobs','done')?.result).toBeNull();expect(d.storage.read('post_jobs','running')?.result?.shortTermChanges).toHaveLength(1);
});
