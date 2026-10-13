import {it,expect,afterEach} from 'vitest';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryRetrieval,makeRetrievalRequest} from '../src/memory/retrieval';
const at='2026-10-09T00:00:00Z',dbs:Storage[]=[];
afterEach(()=>dbs.splice(0).forEach(s=>s.close()));
function setup(){const s=new Storage(':memory:');dbs.push(s);const store=new MemoryStore(s);store.migrate(at);const life=new MemoryLifecycle(store);
 for(const id of ['one','two'])store.saveOwner(store.makeOwner({ownerType:'long',ownerId:id},{content:id==='one'?'火山石项链赠礼':'郊游看日落',sourceIds:[id+'-source'],totalAwakenings:30,retainedFrom:at,expiresAt:'2027-01-01T00:00:00Z'},at));
 return {store,life,retrieval:new MemoryRetrieval(store)};}
it('recalls promoted event specifics and abstract conclusion from one learned owner',async()=>{
 const {store,life,retrieval}=setup();life.promote('one','learned','珍惜互赠心意','stable_understanding',false,['one','two'],at);
 for(const query of ['火山石项链赠礼','珍惜互赠心意']){
 const r=await retrieval.build(makeRetrievalRequest(query,at,'personal'));
 expect(r.learned.map(r=>r.id)).toEqual(['learned']);expect(r.longTerm.map(r=>r.id)).not.toContain('one');}
 expect(store.owner({ownerType:'learned',ownerId:'learned'})?.projectionBasis?.content).toBe('火山石项链赠礼');
});
it('backfills legacy basis once without rewriting durable wording or counts',()=>{
 const {store,life}=setup();store.saveOwner(store.makeOwner({ownerType:'learned',ownerId:'old'},{content:'旧晋升措辞',canonicalMemoryId:'one',learnedKind:'durable_experience',evidenceMemoryIds:['one']},at));
 const before=JSON.stringify([store.listGrants('one'),store.listAwakenings('one'),store.canonical('one')]);
 const first=life.repairLearnedProjections(at);expect(first.changedOwnerIds).toEqual(['old']);expect(first.reindexedOwnerIds).toEqual(['old']);
 expect(store.owner({ownerType:'learned',ownerId:'old'})?.content).toBe('旧晋升措辞');
 expect(life.repairLearnedProjections(at).changedOwnerIds).toEqual([]);
 expect(JSON.stringify([store.listGrants('one'),store.listAwakenings('one'),store.canonical('one')])).toBe(before);
});
it('preserves distinct conclusions and reports missing main without fabricating evidence',async()=>{
 const {store,life,retrieval}=setup();
 for(const id of ['a','b'])store.saveOwner(store.makeOwner({ownerType:'learned',ownerId:id},{content:id,canonicalMemoryId:'one',learnedKind:'stable_understanding',evidenceMemoryIds:['one','two']},at));
 store.saveOwner(store.makeOwner({ownerType:'learned',ownerId:'missing'},{content:'lost',canonicalMemoryId:'lost',learnedKind:'durable_experience'},at));
 expect(life.repairLearnedProjections(at).missingCanonicalIds).toEqual(['lost']);
 const r=await retrieval.build(makeRetrievalRequest('火山石项链赠礼',at,'personal'));expect(r.learned.map(r=>r.id).sort()).toEqual(['a','b']);
});
it('only source metadata changes do not enqueue a vector',()=>{
 const {store,life}=setup();life.promote('one','learned','记得赠礼','durable_experience',false,['one'],at);
 const old=store.owner({ownerType:'learned',ownerId:'learned'})!;
 const row=store.canonical('one')!;store.saveOwner({...row,sourceIds:['new-source'],stateVersion:row.stateVersion+1});
 const report=life.repairLearnedProjections(at);expect(report.reindexedOwnerIds).toEqual([]);
 expect(store.owner(old)?.revision).toBe(old.revision);expect(store.owner(old)?.stateVersion).toBe(old.stateVersion+1);
});

import {setup as setupApp} from './helpers';
import {HdsiApp} from '../src/app';
import {SerialHost} from '../src/host/runtime';
it('host restores frozen foreground before repair and defers repair during background prepare',async()=>{
 const d=setupApp(),store=new MemoryStore(d.storage);store.migrate(at);
 store.saveOwner(store.makeOwner({ownerType:'long',ownerId:'main'},{content:'依据'},at));
 store.saveOwner(store.makeOwner({ownerType:'learned',ownerId:'old'},{content:'结论',canonicalMemoryId:'main'},at));
 const life=new MemoryLifecycle(store),order:string[]=[];const repair=life.repairLearnedProjections.bind(life);
 life.repairLearnedProjections=t=>{order.push('repair');return repair(t);};
 let inFlight=true;
 const maintenance={get inFlight(){return inFlight;},hasStorageFault:false,storageError:undefined,takeError:()=>undefined,applyOneReady:()=> 'none',startOne:()=>false,stop:async()=>{}} as any;
 const app=new HdsiApp({...d,memoryStore:store,memoryLifecycle:life,maintenance});
 d.storage.save('turns','frozen',{id:'frozen',at,done:false,inputMessageIds:[],dialogueWindowVersion:1,dialogueBinding:{episodeId:null,holdReply:false},frozenResult:{sentinel:'unchanged'}} as any);
 app.resumeUnfinishedTurn=async()=>{expect(store.owner({ownerType:'learned',ownerId:'old'})?.projectionBasis).toBeUndefined();expect((d.storage.read('turns','frozen')?.frozenResult as any).sentinel).toBe('unchanged');order.push('resume');d.storage.remove('turns','frozen');};
 const errors:unknown[]=[],host=new SerialHost(app,{timers:false,onError:error=>errors.push(error)});try{await host.start();expect(order).toEqual(['resume']);
 inFlight=false;await host.wake();expect(order).toEqual(['resume','repair']);await host.wake();expect(order).toEqual(['resume','repair']);expect(errors).toEqual([]);}finally{await host.stop();d.storage.close();}
});
it('repair keeps started and ready maintenance snapshots frozen',()=>{
 const {store,life}=setup();store.saveOwner(store.makeOwner({ownerType:'learned',ownerId:'old'},{content:'结论',canonicalMemoryId:'one'},at));
 const old=store.owner({ownerType:'learned',ownerId:'old'})!;
 for(const status of ['pending','ready'] as const)store.saveJob('memory_maintenance_jobs',{id:status,status,cutoff:at,createdAt:at,startedAt:at,snapshot:[old],readSet:[old],selectedIds:['old'],result:[],appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null} as any);
 const before=JSON.stringify(store.jobs('memory_maintenance_jobs'));life.repairLearnedProjections(at);expect(JSON.stringify(store.jobs('memory_maintenance_jobs'))).toBe(before);
});
