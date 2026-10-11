import {expect,it,vi} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {activeOrder,archiveOrder,capacityCounts,protectedCanonicalIds,policyCapacityCounts,policyProtectedIds} from '../src/memory/capacity';
import {readMemoryPolicySnapshot,policyCanonical} from '../src/memory/policy-snapshot';
import {readLatestAwakeningTimes,memoryOrderKeys,activePolicyOrder,archivePolicyOrder} from '../src/memory/policy-order';
import {defaultMemoryCapacity,type MemoryCandidate} from '../src/memory/types';

const key=(row:{ownerType:string;ownerId:string})=>`${row.ownerType}:${row.ownerId}`;
const fields:Partial<MemoryCandidate>={lastEventUpdateAt:days(-100),happenedAt:days(-100),createdAt:days(-100)};
const activeCases:Array<{name:string;a:Partial<MemoryCandidate>;b:Partial<MemoryCandidate>}>=[
 {name:'importance',a:{importance:'normal'},b:{importance:'high'}},
 {name:'awakening count',a:{totalAwakenings:0},b:{totalAwakenings:1}},
 {name:'negative decay',a:{kind:'short',ownerType:'short',lastEventUpdateAt:days(-1)},b:{lastEventUpdateAt:days(-1)}},
 {name:'meaningful after decay cap',a:{lastEventUpdateAt:days(-101)},b:{lastEventUpdateAt:days(-100)}},
 {name:'short meaningful after seven day cap',a:{kind:'short',ownerType:'short',lastEventUpdateAt:days(-9)},b:{kind:'short',ownerType:'short',lastEventUpdateAt:days(-8)}},
 {name:'future meaningful with zero decay',a:{lastEventUpdateAt:days(1)},b:{lastEventUpdateAt:days(2)}},
 {name:'happened time',a:{happenedAt:days(-101)},b:{happenedAt:days(-100)}},
 {name:'created time',a:{createdAt:days(-101)},b:{createdAt:days(-100)}},
];
const archiveCases:Array<{name:string;a:Partial<MemoryCandidate>;b:Partial<MemoryCandidate>}>=[
 {name:'awakening count before importance',a:{totalAwakenings:0,importance:'high'},b:{totalAwakenings:1}},
 {name:'meaningful before importance',a:{lastEventUpdateAt:days(-101),importance:'high'},b:{lastEventUpdateAt:days(-100)}},
 {name:'importance',a:{importance:'normal'},b:{importance:'high'}},
 {name:'happened time',a:{happenedAt:days(-101)},b:{happenedAt:days(-100)}},
 {name:'created time',a:{createdAt:days(-101)},b:{createdAt:days(-100)}},
];
function orderedPair(a:Partial<MemoryCandidate>,b:Partial<MemoryCandidate>,archive=false){
 const d=fixture();long(d.store,'z-first',{...fields,...a});long(d.store,'a-second',{...fields,...b});
 const owners=d.store.allOwners(),expected=owners.slice().sort(archive?archiveOrder(d.store):activeOrder(d.store,at)).map(r=>r.id);
 const snapshot=readMemoryPolicySnapshot(d.storage),latest=readLatestAwakeningTimes(d.storage,snapshot.rows.map(r=>r.id)),keys=memoryOrderKeys(snapshot.rows,snapshot,latest,at,'owner');
 expect(expected).toEqual(['z-first','a-second']);
 expect(snapshot.rows.slice().sort(archive?archivePolicyOrder(keys):activePolicyOrder(keys)).map(r=>r.id)).toEqual(['z-first','a-second']);
}
it.each(activeCases)('active_order_preserves_all_tie_breakers: $name',({a,b})=>orderedPair(a,b));
it.each(archiveCases)('archive_order_preserves_all_tie_breakers: $name',({a,b})=>orderedPair(a,b,true));
it('same epoch and ID order retain ECMAScript string comparison for both comparators',()=>{
 const d=fixture();
 long(d.store,'Z',{...fields,lastEventUpdateAt:'2026-10-11T00:00:00.000Z',happenedAt:'2026-10-11T00:00:00.000Z',createdAt:'2026-10-11T00:00:00.000Z'});
 long(d.store,'a',{...fields,lastEventUpdateAt:'2026-10-11T08:00:00+08:00',happenedAt:'2026-10-11T08:00:00+08:00',createdAt:'2026-10-11T08:00:00+08:00'});
 const snapshot=readMemoryPolicySnapshot(d.storage),keys=memoryOrderKeys(snapshot.rows,snapshot,new Map(),at,'owner');
 expect(snapshot.rows.slice().sort(activePolicyOrder(keys)).map(r=>r.id)).toEqual(['Z','a']);
 expect(snapshot.rows.slice().sort(archivePolicyOrder(keys)).map(r=>r.id)).toEqual(['Z','a']);
});
it('policy_comparators_do_not_read_database',()=>{
 const d=fixture();for(let i=0;i<20;i++)long(d.store,`id-${i}`,{...fields,lastEventUpdateAt:days(-i),importance:i%3?'normal':'high',totalAwakenings:i%4});
 const owners=d.store.allOwners(),active=owners.slice().sort(activeOrder(d.store,at)).map(r=>r.id),archive=owners.slice().sort(archiveOrder(d.store)).map(r=>r.id);
 const snapshot=readMemoryPolicySnapshot(d.storage),latest=readLatestAwakeningTimes(d.storage,snapshot.rows.map(r=>r.id)),keys=memoryOrderKeys(snapshot.rows,snapshot,latest,at,'owner');
 const fail=()=>{throw Error('comparator performed a read');};
 const spies=[vi.spyOn(d.storage,'prepare').mockImplementation(fail),vi.spyOn(d.store,'canonical').mockImplementation(fail),vi.spyOn(d.store,'listAwakenings').mockImplementation(fail)];
 try{expect(snapshot.rows.slice().sort(activePolicyOrder(keys)).map(r=>r.id)).toEqual(active);expect(snapshot.rows.slice().sort(archivePolicyOrder(keys)).map(r=>r.id)).toEqual(archive);}finally{spies.forEach(s=>s.mockRestore());}
});
it('batch awakening reads deduplicate IDs, bound parameters and select only time fields',()=>{
 const d=fixture(),prepare=d.storage.prepare.bind(d.storage),batches:number[]=[],sqls:string[]=[];
 const spy=vi.spyOn(d.storage,'prepare').mockImplementation(sql=>{sqls.push(sql);const statement=prepare(sql);return new Proxy(statement,{get(target,k){const value=Reflect.get(target,k,target);return typeof value==='function'? (...args:unknown[])=>{if(k==='all')batches.push(args.length);return Reflect.apply(value,target,args);}:value;}});});
 try{
  expect(readLatestAwakeningTimes(d.storage,[]).size).toBe(0);expect(sqls).toEqual([]);
  const ids=Array.from({length:1001},(_,i)=>`l-${i}`);expect(readLatestAwakeningTimes(d.storage,[...ids,...ids]).size).toBe(0);
  expect(batches).toEqual([500,500,1]);expect(sqls).toHaveLength(3);
  for(const sql of sqls)expect(sql).toMatch(/^SELECT canonicalMemoryId,firstEffectiveAt FROM memory_awakenings WHERE canonicalMemoryId IN /);
 }finally{spy.mockRestore();}
});
it('awakening maximum compares epochs instead of ISO text',()=>{
 const d=fixture();long(d.store,'l',{lastEventUpdateAt:days(-1)});
 for(const [date,time] of [['a','2026-10-11T08:00:00+08:00'],['b','2026-10-11T01:00:00.000Z'],['c','2026-10-11T00:00:00.000Z']])d.storage.prepare('INSERT INTO memory_awakenings VALUES(?,?,?,?,?)').run('l',date,time,'turn','["payload"]');
 expect(readLatestAwakeningTimes(d.storage,['l']).get('l')).toBe(Date.parse('2026-10-11T01:00:00.000Z'));
});
it('shared_canonical_is_loaded_once_without_losing_short_event_time',()=>{
 const d=fixture();long(d.store,'canonical',{totalAwakenings:43,lastEventUpdateAt:days(20)});long(d.store,'merged',{status:'merged',mergedInto:'canonical'});
 d.store.saveOwner(d.store.makeOwner({ownerType:'learned',ownerId:'learned'},{content:'projection',canonicalMemoryId:'merged'},at));
 for(let i=0;i<100;i++)d.store.saveOwner(d.store.makeOwner({ownerType:'short',ownerId:`s-${i}`},{content:'detail',linkedLongId:i%2?'learned':'merged',lastEventUpdateAt:days(i-50)},at));
 d.store.saveAwakening({canonicalMemoryId:'canonical',localDate:'2026-10-08',firstEffectiveAt:at,turnId:'turn',sourceIds:[]});
 const snapshot=readMemoryPolicySnapshot(d.storage),shorts=snapshot.rows.filter(r=>r.kind==='short'),ids=shorts.map(r=>policyCanonical(snapshot,r.linkedLongId!,'owner')!.id);
 const prepare=d.storage.prepare.bind(d.storage),batches:string[][]=[];
 const spy=vi.spyOn(d.storage,'prepare').mockImplementation(sql=>{const statement=prepare(sql);return new Proxy(statement,{get(target,k){const value=Reflect.get(target,k,target);return typeof value==='function'?(...args:unknown[])=>{if(k==='all')batches.push(args as string[]);return Reflect.apply(value,target,args);}:value;}});});
 const latest=readLatestAwakeningTimes(d.storage,ids);spy.mockRestore();expect(batches).toEqual([['canonical']]);
 const keys=memoryOrderKeys(shorts,snapshot,latest,at,'owner');
 expect(keys.get('short:s-0')).toMatchObject({meaningfulMs:Date.parse(at),awakeningCount:43});
 expect(keys.get('short:s-99')).toMatchObject({meaningfulMs:Date.parse(days(49)),awakeningCount:43,decay:0});
});
it('policy protections and counts preserve normal versus retained references and canonical modes',()=>{
 const d=fixture();long(d.store,'live');long(d.store,'blank',{content:'\uFEFF\u2029',archiveEnteredAt:days(-1)});long(d.store,'old',{status:'merged',mergedInto:'live'});
 d.store.saveOwner(d.store.makeOwner({ownerType:'short',ownerId:'expired'},{content:'detail',shortExpiresAt:days(-1),linkedLongId:'blank'},at));
 d.store.saveOwner(d.store.makeOwner({ownerType:'short',ownerId:'active'},{content:'detail',shortExpiresAt:days(7),linkedLongId:'old'},at));
 d.store.saveOwner(d.store.makeOwner({ownerType:'learned',ownerId:'learned'},{content:'projection',canonicalMemoryId:'old',evidenceMemoryIds:['old','live']},at));
 const owners=d.store.allOwners(),snapshot=readMemoryPolicySnapshot(d.storage);
 expect([...policyProtectedIds(snapshot,at)]).toEqual(['live']);expect([...policyProtectedIds(snapshot,at,true)]).toEqual(['live','blank']);
 expect(policyProtectedIds(snapshot,at)).toEqual(protectedCanonicalIds(owners,at));expect(policyProtectedIds(snapshot,at,true)).toEqual(protectedCanonicalIds(owners,at,true));
 expect(policyCapacityCounts(snapshot,at,defaultMemoryCapacity)).toEqual(capacityCounts(owners,at,defaultMemoryCapacity));
 // Later table wins in metadata mode; owner mode starts in memories.
 d.store.saveOwner(d.store.makeOwner({ownerType:'detail',ownerId:'old'},{content:'same ID detail'},at));
 const crossed=readMemoryPolicySnapshot(d.storage),shorts=crossed.rows.filter(r=>r.kind==='short'),ownerKeys=memoryOrderKeys(shorts,crossed,new Map([['live',Date.parse(days(2))]]),at,'owner'),metadataKeys=memoryOrderKeys(shorts,crossed,new Map([['live',Date.parse(days(2))]]),at,'metadata');
 expect(ownerKeys.get(key(shorts.find(r=>r.id==='active')!))?.meaningfulMs).toBe(Date.parse(days(2)));
 expect(metadataKeys.get('short:active')?.meaningfulMs).toBe(Date.parse(at));
});
