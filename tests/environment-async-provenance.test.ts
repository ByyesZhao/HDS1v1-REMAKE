import {it,expect} from 'vitest';
import {asyncFixture} from './environment-async-fixture';
import {NOW} from './helpers';
import {MemoryStore} from '../src/memory/store';import {MemoryRetrieval} from '../src/memory/retrieval';
import {freezeEnvironmentSnapshot,lookupFrozenEnvironment,lookupBasisCurrent} from '../src/environment/snapshot';
it('candidate provenance captures IDs but never historical message bodies outside recent',()=>{
 const {d,step}=asyncFixture(),store=new MemoryStore(d.storage);store.migrate(NOW);
 d.storage.set('runtime',{...d.storage.runtime(),dialogueContextVersion:2});
 const sourceIds=[];for(let i=0;i<100;i++){const id='s'+i;sourceIds.push(id);d.storage.save('messages',id,{id,content:'z'.repeat(10000),receivedAt:NOW,direction:'incoming',seenTurnId:'old',turnId:null,outboxSeq:null,batchId:null,platformMessageIds:[],chatEpisodeId:null,sharedActivityId:'old-activity'});}
 const row=store.makeOwner({ownerType:'detail',ownerId:'phone'},{key:'phone',value:'A',content:'A',sourceIds},NOW);store.saveOwner(row);
 const snapshot=freezeEnvironmentSnapshot({...d,memoryStore:store,retrieval:new MemoryRetrieval(store)},step,NOW);
 expect(snapshot.retrieval.recent).toHaveLength(0);expect(JSON.stringify(snapshot)).not.toContain('z'.repeat(100));
 expect(JSON.stringify(snapshot).length).toBeLessThan(25000);
 expect(snapshot.retrieval.sourcePresence.filter(s=>s.table==='messages')).toHaveLength(100);d.storage.close();
});
it.each(['experiences','self_web_read_sources'] as const)('used %s provenance deletion invalidates commit but unused sources do not',async table=>{
 const {d,step}=asyncFixture(),store=new MemoryStore(d.storage);store.migrate(NOW);
 d.storage.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?)`).run('source',JSON.stringify({id:'source'}));
 const row=store.makeOwner({ownerType:'detail',ownerId:'phone'},{key:'phone',aliases:['手机'],value:'A',content:'A',sourceIds:['source']},NOW);store.saveOwner(row);
 const dep={...d,memoryStore:store,retrieval:new MemoryRetrieval(store)},snapshot=freezeEnvironmentSnapshot(dep,step,NOW);
 const used=await lookupFrozenEnvironment(snapshot,'手机',dep.retrieval);snapshot.usedBasis=used.usedBasis;
 expect(lookupBasisCurrent(dep,snapshot)).toBe(true);d.storage.prepare(`DELETE FROM ${table} WHERE id=?`).run('source');
 expect(lookupBasisCurrent(dep,snapshot)).toBe(false);snapshot.usedBasis=(await lookupFrozenEnvironment(snapshot,'无关主题',dep.retrieval)).usedBasis;
 expect(lookupBasisCurrent(dep,snapshot)).toBe(true);d.storage.close();
});
