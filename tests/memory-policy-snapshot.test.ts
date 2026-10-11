import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {fixture,long,at} from './memory-capacity-fixture';
import type {MemoryCandidate} from '../src/memory/types';
import {memoryMetadata,metadataCanonical} from '../src/memory/metadata';
import {readMemoryPolicySnapshot,policyRow,replacePolicyRow,policyCanonical} from '../src/memory/policy-snapshot';
import {summaryRepairPair,summaryRepairPolicyPair,summaryRepairBasis} from '../src/memory/summary-repair';

it('policy_projection_matches_content_and_source_predicates',()=>{
 const d=fixture(),marker='正文尾部标记_POLICY_ONLY',cases=[
  {content:'',sourceIds:[]},{content:' ',sourceIds:['source']},{content:'\t\n',sourceIds:[]},
  {content:'\u00a0\u2003\ufeff',sourceIds:['source']},{content:'中文正文',sourceIds:[]},
  {content:'\u0000',sourceIds:[]},
  {content:undefined,value:'旧细节值',sourceIds:['source']},{content:'',value:'不能替代空正文',sourceIds:[]},
  {content:'x'.repeat(4096)+marker,sourceIds:['source']},
 ];
 cases.forEach((data,i)=>{
  const owner=d.store.makeOwner({ownerType:'long',ownerId:`sample-${i}`},{...data,content:data.content??data.value??''},at);
  const raw={...owner,...data};
  d.storage.prepare('INSERT INTO memories(id,data) VALUES(?,?)').run(owner.id,JSON.stringify(raw));
 });
 const sql:string[]=[],db={prepare:(query:string)=>{sql.push(query);return d.storage.prepare(query);}};
 const snapshot=readMemoryPolicySnapshot(db);
 expect(snapshot.rows).toHaveLength(cases.length);
 for(const [i,data] of cases.entries()){
  const row=snapshot.memoryById.get(`sample-${i}`)!;
  expect(row.hasContent).toBe((data.content??data.value??'').trim().length>0);
  expect(row.hasSources).toBe(data.sourceIds.length>0);
  for(const field of ['content','value','eventSummary','feelingSummary','topics','sourceIds','projectionBasis','normalizedVector'])expect(field in row).toBe(false);
 }
 expect(JSON.stringify(snapshot.rows)).not.toContain(marker);
 expect(sql).toHaveLength(4);
 expect(sql.every(query=>!/^SELECT data\b/i.test(query))).toBe(true);
});

it('policy_projection_matches_in_memory_rows_and_missing_table_defaults',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE details(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  db.prepare('INSERT INTO details VALUES(?,?)').run('sql-key',JSON.stringify({id:'json-id',ownerId:'json-owner',value:'值',sourceIds:[],evidenceMemoryIds:['a','b']}));
  const snapshot=readMemoryPolicySnapshot(db),row=snapshot.rows[0];
  expect(row).toMatchObject({table:'details',id:'sql-key',ownerId:'sql-key',kind:'detail',ownerType:'detail',hasContent:true,hasSources:false,capacityExitedAt:null,capacityExitReason:null,archiveEnteredAt:null,evidenceMemoryIds:['a','b']});
  expect(row.canonicalMemoryId).toBeUndefined();expect(row.learnedKind).toBeUndefined();expect(row.summaryRepairBasis).toBeUndefined();
  const d=fixture(),owner=long(d.store,'full',{content:'\u00a0\ufeff',sourceIds:[],evidenceMemoryIds:['evidence'],normalizedVector:new Float32Array([1,0])});
  const stored=readMemoryPolicySnapshot(d.storage).memoryById.get('full');
  expect(policyRow(owner,'memories')).toEqual(stored);
 }finally{db.close();}
});

it('policy_canonical_modes_match_existing_readers',()=>{
 const d=fixture();
 long(d.store,'A');long(d.store,'B',{status:'merged',mergedInto:'A'});
 const save=(ownerType:MemoryCandidate['ownerType'],id:string,data:Partial<MemoryCandidate>)=>{const row=d.store.makeOwner({ownerType,ownerId:id},{...data,content:data.content??''},at);d.store.saveOwner(row);return row;};
 save('learned','C',{canonicalMemoryId:'B',mergedInto:'B'});
 save('short','S1',{linkedLongId:'B'});save('short','S2',{linkedLongId:'C'});
 long(d.store,'detail-shadow');save('detail','detail-shadow',{content:'same id detail'});
 long(d.store,'learned-shadow');save('learned','learned-shadow',{canonicalMemoryId:'A'});
 save('learned','broken',{canonicalMemoryId:'missing'});
 long(d.store,'jump-detail',{mergedInto:'detail-shadow'});
 save('learned','learned-only',{canonicalMemoryId:'C'});
 const snapshot=readMemoryPolicySnapshot(d.storage),old=memoryMetadata(d.storage);
 for(const id of ['A','B','C','S1','S2','detail-shadow','learned-shadow','broken','jump-detail','learned-only','missing']){
  expect(policyCanonical(snapshot,id,'metadata')?.id??null).toBe(metadataCanonical(old,id)?.id??null);
  expect(policyCanonical(snapshot,id,'owner')?.id??null).toBe(d.store.canonical(id)?.id??null);
 }
 expect(policyCanonical(snapshot,'detail-shadow','metadata')).toBeNull();
 expect(policyCanonical(snapshot,'detail-shadow','owner')?.id).toBe('detail-shadow');
 expect(policyCanonical(snapshot,'learned-shadow','metadata')?.id).toBe('A');
 expect(policyCanonical(snapshot,'learned-shadow','owner')?.id).toBe('learned-shadow');
 expect(policyCanonical(snapshot,'learned-only','metadata')?.id).toBe('A');
 expect(policyCanonical(snapshot,'learned-only','owner')).toBeNull();
});

it('replacing_policy_rows_preserves_pool_order_and_later_same_id_winners',()=>{
 const d=fixture(),a=long(d.store,'a'),shadow=long(d.store,'shadow');
 const detail=d.store.makeOwner({ownerType:'detail',ownerId:'shadow'},{content:'detail'},at);d.store.saveOwner(detail);
 const learned=d.store.makeOwner({ownerType:'learned',ownerId:'shadow'},{content:'learned',canonicalMemoryId:'a'},at);d.store.saveOwner(learned);
 const snapshot=readMemoryPolicySnapshot(d.storage),order=snapshot.rows.map(r=>`${r.table}:${r.id}`);
 const indexes=[snapshot.byOwner,snapshot.legacyById,snapshot.memoryById,snapshot.learnedById];
 replacePolicyRow(snapshot,{...shadow,revision:2,stateVersion:3,content:''});
 expect(snapshot.rows.map(r=>`${r.table}:${r.id}`)).toEqual(order);
 expect(snapshot.memoryById.get('shadow')).toMatchObject({revision:2,stateVersion:3,hasContent:false});
 expect(snapshot.legacyById.get('shadow')?.table).toBe('learned_background');
 replacePolicyRow(snapshot,{...detail,revision:4});
 expect(snapshot.byOwner.get('detail:shadow')?.revision).toBe(4);
 expect(snapshot.legacyById.get('shadow')?.table).toBe('learned_background');
 replacePolicyRow(snapshot,{...learned,canonicalMemoryId:'shadow',revision:5});
 expect(snapshot.legacyById.get('shadow')).toBe(snapshot.learnedById.get('shadow'));
 expect(snapshot.legacyById.get('shadow')?.revision).toBe(5);
 replacePolicyRow(snapshot,{...a,revision:6});
 expect(snapshot.legacyById.get('a')?.revision).toBe(6);
 [snapshot.byOwner,snapshot.legacyById,snapshot.memoryById,snapshot.learnedById].forEach((index,i)=>expect(index).toBe(indexes[i]));
 expect(()=>replacePolicyRow(snapshot,{...a,id:'absent',ownerId:'absent'})).toThrow();
 expect(snapshot.rows).toHaveLength(4);
});

it('policy_summary_repair_matches_full_owner_pair',()=>{
 const d=fixture(),short=d.store.makeOwner({ownerType:'short',ownerId:'s'},{content:'短期事实',sourceIds:['source'],linkedLongId:'l'},at);
 const baseLong=long(d.store,'l',{content:'',sourceIds:[]});
 const cases:Array<{short:MemoryCandidate;long:MemoryCandidate|null;want:boolean}>=[
  {short,long:baseLong,want:true},{short,long:{...baseLong,status:'durable'},want:true},
  {short:{...short,content:'\u00a0\u2003\ufeff'},long:baseLong,want:false},
  {short:{...short,sourceIds:[]},long:baseLong,want:false},
  {short:{...short,sourceIds:[]},long:{...baseLong,sourceIds:['source']},want:true},
  {short,long:{...baseLong,status:'discarded'},want:false},{short,long:{...baseLong,content:'摘要'},want:false},
  {short:{...short,status:'merged',mergedInto:'other'},long:baseLong,want:false},
  {short,long:null,want:false},
 ];
 for(const sample of cases){
  const s=policyRow(sample.short,'memories'),l=sample.long?policyRow(sample.long,'memories'):null;
  expect(summaryRepairPair(sample.short,sample.long)).toBe(sample.want);
  expect(summaryRepairPolicyPair(s,l)).toBe(sample.want);
  if(sample.long&&l)expect(summaryRepairBasis(s,l)).toBe(summaryRepairBasis(sample.short,sample.long));
 }
 const repaired={...short,summaryRepairBasis:summaryRepairBasis(short,baseLong)};
 expect(summaryRepairBasis(policyRow(repaired,'memories'),policyRow(baseLong,'memories'))).toBe(repaired.summaryRepairBasis);
 expect(summaryRepairBasis(policyRow({...repaired,revision:2},'memories'),policyRow(baseLong,'memories'))).not.toBe(repaired.summaryRepairBasis);
});
