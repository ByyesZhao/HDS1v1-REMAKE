import {expect,it,vi} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {MemoryCapacity} from '../src/memory/capacity';
import {MemoryCleanup} from '../src/memory/cleanup';
import {defaultMemoryCapacity,type MemoryCandidate,type MemoryCapacityConfig} from '../src/memory/types';

function create(config:MemoryCapacityConfig=defaultMemoryCapacity){const d=fixture(),capacity=new MemoryCapacity(d.store,config);return {...d,capacity,cleanup:new MemoryCleanup(d.store,capacity)};}
function short(d:ReturnType<typeof create>,id:string,data:Partial<MemoryCandidate>={}){
 const row=d.store.makeOwner({ownerType:'short',ownerId:id},{content:`real detail ${id}`,sourceIds:[`real-source-${id}`],linkedLongId:'summary',shortExpiresAt:at,...data},at);d.store.saveOwner(row);return row;
}
// Observe real SQLite statements and real purge calls; every wrapper calls through.
function work(d:ReturnType<typeof create>){
 const tally={snapshotLoads:0,metadataRows:0,fullOwnerRows:0,awakeningSelects:0,awakeningIds:[] as string[],ownerWrites:0,grantWrites:0,dirtyWrites:0,purges:0};
 const prepare=d.storage.prepare.bind(d.storage),purge=d.store.purgeOwner.bind(d.store);
 const purgeSpy=vi.spyOn(d.store,'purgeOwner').mockImplementation((owner,now)=>{tally.purges++;return purge(owner,now);});
 const all=vi.spyOn(d.store,'allOwners'),history=vi.spyOn(d.store,'listAwakenings');
 const spy=vi.spyOn(d.storage,'prepare').mockImplementation(sql=>{
  if(sql.includes("SELECT name FROM sqlite_master"))tally.snapshotLoads++;
  return new Proxy(prepare(sql),{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return (...args:unknown[])=>{
   const result=Reflect.apply(value,target,args),rows=key==='all'&&Array.isArray(result)?result.length:key==='get'&&result?1:0;
   if(/^SELECT data FROM (memories|details|learned_background)\b/.test(sql))tally.fullOwnerRows+=rows;
   if(sql.includes('AS hasContent FROM'))tally.metadataRows+=rows;
   if(/^SELECT\b/.test(sql)&&sql.includes('FROM memory_awakenings')){tally.awakeningSelects++;tally.awakeningIds.push(...args as string[]);}
   if(key==='run'&&/^(INSERT|UPDATE|DELETE)/.test(sql)){
    if(/\b(memories|details|learned_background)\b/.test(sql))tally.ownerWrites++;
    if(sql.includes('memory_retention_grants'))tally.grantWrites++;
    if(sql.includes('memory_dirty_owners'))tally.dirtyWrites++;
   }
   return result;
  };}});
 });
 return {tally,stop(){const calls={allOwners:all.mock.calls.length,listAwakenings:history.mock.calls.length};spy.mockRestore();purgeSpy.mockRestore();all.mockRestore();history.mockRestore();return calls;}};
}
it.each([128,4096])('next_deadline_reads_one_metadata_snapshot_without_sorting (%i characters)',size=>{
 const d=create(),content='x'.repeat(size);
 d.storage.transaction(()=>{
  for(let i=0;i<1000;i++)long(d.store,`l-${String(i).padStart(4,'0')}`,{content});
  for(let i=0;i<100;i++)short(d,`s-${i}`,{content,linkedLongId:`l-${String(i).padStart(4,'0')}`,shortExpiresAt:days(7)});
  for(let i=0;i<500;i++)long(d.store,`a-${i}`,{content,archiveEnteredAt:days(-89)});
 });
 const w=work(d),deadline=d.cleanup.nextDeadline(at),calls=w.stop();
 expect(deadline).toBe('2026-10-09T02:00:00.000Z');expect(calls).toEqual({allOwners:0,listAwakenings:0});
 expect(w.tally).toEqual({snapshotLoads:1,metadataRows:1600,fullOwnerRows:0,awakeningSelects:0,awakeningIds:[],ownerWrites:0,grantWrites:0,dirtyWrites:0,purges:0});
});
it('next_deadline_eligible_archive_needs_no_awakening_reads',()=>{
 const d=create();for(let i=0;i<501;i++)long(d.store,`a-${i}`,{archiveEnteredAt:at});
 const w=work(d),deadline=d.cleanup.nextDeadline(at);w.stop();expect(deadline).toBe(at);
 expect(w.tally).toMatchObject({snapshotLoads:1,metadataRows:501,fullOwnerRows:0,awakeningSelects:0,ownerWrites:0,purges:0});
});
it('cleanup_projection_preserves_expired_and_old_reference_rules',()=>{
 const d=create();long(d.store,'summary');long(d.store,'kept-short',{status:'discarded'});long(d.store,'kept-evidence',{status:'discarded'});
 long(d.store,'delete-old',{status:'merged',mergedInto:'summary'});
 short(d,'a-exited',{capacityExitedAt:days(-1)});short(d,'b-merged-active',{mergedInto:'summary'});
 short(d,'inactive-ref',{status:'durable',linkedLongId:'kept-short',shortExpiresAt:null});
 d.store.saveOwner(d.store.makeOwner({ownerType:'learned',ownerId:'understanding'},{content:'knowledge',evidenceMemoryIds:['kept-evidence']},at));
 for(const id of ['a-exited','b-merged-active','delete-old']){
  const w=work(d);expect(d.cleanup.applyOne(at)).toBe('applied');w.stop();expect(w.tally).toMatchObject({snapshotLoads:1,fullOwnerRows:0,purges:1});
  expect(d.store.owner({ownerType:id==='delete-old'?'long':'short',ownerId:id})).toBeNull();
 }
 expect(d.cleanup.applyOne(at)).toBe('none');expect(d.store.owner({ownerType:'long',ownerId:'kept-short'})).not.toBeNull();expect(d.store.owner({ownerType:'long',ownerId:'kept-evidence'})).not.toBeNull();
});
it.each(['empty','whitespace','durable','long-source'] as const)('missing_summary_repairs_only_changed_basis: %s',mode=>{
 const d=create(),l=long(d.store,'summary',{content:mode==='whitespace'?'\t\uFEFF\u2029':'',status:mode==='durable'?'durable':'active',sourceIds:mode==='long-source'?['long-evidence']:[]});
 const s=short(d,'s',{sourceIds:mode==='long-source'?[]:['short-evidence'],eventSummary:'event tail',feelingSummary:'feeling tail',topics:['topic tail']}),originalShort=d.store.owner(s)!,originalLong=d.store.owner(l)!;
 expect(d.cleanup.nextDeadline(at)).toBe(at);expect(d.cleanup.status()).toEqual({blockedIds:['s:missing_summary'],oldestBlock:'s:missing_summary'});
 const w=work(d);expect(d.cleanup.applyOne(at)).toBe('applied');w.stop();
 expect(w.tally).toMatchObject({snapshotLoads:1,fullOwnerRows:2,ownerWrites:1,dirtyWrites:1,purges:0});
 const updated=d.store.owner(s)!;expect(updated).toEqual({...originalShort,stateVersion:2,summaryRepairBasis:'[1,2,1,1]'});
 expect(d.store.owner(l)).toEqual(originalLong);expect(d.store.dirtyOwners()).toMatchObject([{ownerId:'s',stateVersion:2,reasons:['expiry']}]);
 expect(d.cleanup.nextDeadline(at)).toBe(mode==='durable'?null:days(180));expect(d.cleanup.applyOne(at)).toBe('blocked');
 expect(d.store.owner(s)?.stateVersion).toBe(2);expect(d.cleanup.status().blockedIds).toEqual(['s:missing_summary']);
 d.store.saveOwner({...l,stateVersion:2});expect(d.cleanup.nextDeadline(at)).toBe(at);expect(d.cleanup.applyOne(at)).toBe('applied');
 expect(d.store.owner(s)?.summaryRepairBasis).toBe('[1,3,1,2]');
});
it.each(['no-sources','blank-short','merged-short','same-basis'] as const)('missing_summary_ineligible_pair_stays_blocked: %s',mode=>{
 const d=create();long(d.store,'summary',{content:'',sourceIds:[]});short(d,'s',{sourceIds:mode==='no-sources'?[]:['evidence'],content:mode==='blank-short'?'\u00A0\u2003':'detail',mergedInto:mode==='merged-short'?'other':null,summaryRepairBasis:mode==='same-basis'?'[1,1,1,1]':undefined});
 const w=work(d);expect(d.cleanup.nextDeadline(at)).toBe(days(180));expect(d.cleanup.applyOne(at)).toBe('blocked');w.stop();
 expect(d.cleanup.status()).toEqual({blockedIds:['s:missing_summary'],oldestBlock:'s:missing_summary'});expect(w.tally).toMatchObject({fullOwnerRows:0,ownerWrites:0,dirtyWrites:0,purges:0});
});
it('apply_one_purges_only_first_eligible_and_keeps_archive_priority',()=>{
 const d=create({...defaultMemoryCapacity,longArchiveLimit:1});long(d.store,'summary');short(d,'short');long(d.store,'discarded',{status:'discarded'});
 long(d.store,'overdue-high',{archiveEnteredAt:days(-100),totalAwakenings:2});long(d.store,'overdue-low',{archiveEnteredAt:days(-100),totalAwakenings:1});long(d.store,'young',{archiveEnteredAt:days(-1),totalAwakenings:0});
 for(const id of ['short','discarded','overdue-low','overdue-high']){
  const w=work(d);expect(d.cleanup.applyOne(at)).toBe('applied');w.stop();expect(w.tally).toMatchObject({snapshotLoads:1,fullOwnerRows:0,purges:1});
  if(id==='overdue-low')expect(w.tally).toMatchObject({awakeningSelects:1,awakeningIds:['overdue-high','overdue-low']});
  expect(d.store.owner({ownerType:id==='short'?'short':'long',ownerId:id})).toBeNull();expect(d.store.canonical('young')).not.toBeNull();
 }
 expect(d.cleanup.applyOne(at)).toBe('none');
});
it.each(['paused','unfinishedTurn','openBatch'] as const)('cleanup_gates_do_not_load_policy_snapshot: %s',gate=>{
 const d=create();long(d.store,'old',{archiveEnteredAt:days(-100)});
 if(gate==='unfinishedTurn')d.storage.save('turns','running',{id:'running',done:false} as any);
 else d.storage.set('runtime',{...d.storage.runtime(),...(gate==='paused'?{paused:true}:{openBatch:{id:'open'}})});
 const w=work(d);expect(d.cleanup.applyOne(at)).toBe('blocked');expect(d.cleanup.nextDeadline(at)).toBeNull();w.stop();
 expect(w.tally).toMatchObject({snapshotLoads:0,metadataRows:0,fullOwnerRows:0,awakeningSelects:0,ownerWrites:0,purges:0});
});
it('cleanup_capacity_fallback_reuses_snapshot',()=>{
 const d=create({...defaultMemoryCapacity,longActiveLimit:1});long(d.store,'a');long(d.store,'b');
 const w=work(d);expect(d.cleanup.applyOne(at)).toBe('applied');w.stop();
 expect(w.tally).toMatchObject({snapshotLoads:1,metadataRows:2,fullOwnerRows:1,ownerWrites:1,dirtyWrites:1,purges:0});
 expect(d.store.canonical('a')).toMatchObject({archiveEnteredAt:at,stateVersion:2});expect(d.store.canonical('b')?.archiveEnteredAt).toBeNull();
});
it('cleanup_capacity_fallback_keeps_budget_one_pair_atomic',()=>{
 const d=create({...defaultMemoryCapacity,shortActiveLimit:0,longActiveLimit:0});
 long(d.store,'summary',{retainedFrom:days(7),expiresAt:days(97)});short(d,'s',{shortExpiresAt:days(7)});
 const w=work(d);expect(d.cleanup.applyOne(at)).toBe('applied');w.stop();
 expect(w.tally).toMatchObject({snapshotLoads:1,metadataRows:2,fullOwnerRows:2,ownerWrites:2,grantWrites:1,dirtyWrites:2,purges:0});
 expect(d.store.owner({ownerType:'short',ownerId:'s'})).toMatchObject({capacityExitedAt:at,stateVersion:2});
 expect(d.store.canonical('summary')).toMatchObject({retainedFrom:at,expiresAt:days(90),stateVersion:2,archiveEnteredAt:null});
 expect(d.store.listGrants('summary')).toMatchObject([{kind:'initial',anchorAt:at,expiresAt:days(90)}]);
});
it('cleanup_uses_owner_canonical_while_deadline_uses_metadata_canonical',()=>{
 const d=create();long(d.store,'collision',{content:'actual memory summary'});long(d.store,'blank',{content:'',status:'durable',sourceIds:[]});
 d.store.saveOwner(d.store.makeOwner({ownerType:'learned',ownerId:'collision'},{content:'knowledge',canonicalMemoryId:'blank',status:'discarded'},at));
 const s=short(d,'s',{linkedLongId:'collision'});
 // The later learned pool shadows the memory ID only for metadata lookup.
 expect(d.cleanup.nextDeadline(at)).toBe(at);expect(d.cleanup.status().blockedIds).toEqual(['s:missing_summary']);
 const w=work(d);expect(d.cleanup.applyOne(at)).toBe('applied');w.stop();expect(w.tally).toMatchObject({fullOwnerRows:0,ownerWrites:1,dirtyWrites:1,purges:1});
 expect(d.store.owner(s)).toBeNull();expect(d.cleanup.status().blockedIds).toEqual([]);expect(d.store.canonical('collision')?.content).toBe('actual memory summary');
});
it('repair_hydrates_selected_canonical_directly_without_loading_chain_owners',()=>{
 const d=create();const summary=long(d.store,'summary',{content:'',status:'durable'});long(d.store,'old',{status:'durable',mergedInto:'summary'});
 d.store.saveOwner(d.store.makeOwner({ownerType:'learned',ownerId:'alias'},{status:'durable',canonicalMemoryId:'old',content:'alias'},at));
 const s=short(d,'s',{linkedLongId:'alias'}),before=d.store.owner(s)!;
 const w=work(d);expect(d.cleanup.applyOne(at)).toBe('applied');w.stop();expect(w.tally).toMatchObject({snapshotLoads:1,fullOwnerRows:2,ownerWrites:1,dirtyWrites:1,purges:0});
 expect(d.store.owner(s)).toEqual({...before,stateVersion:2,summaryRepairBasis:'[1,2,1,1]'});expect(d.store.owner(summary)?.content).toBe('');
});
it('cleanup_preserves_blocked_id_order_and_protected_archive_marker',()=>{
 const d=create({...defaultMemoryCapacity,longArchiveLimit:0});long(d.store,'a',{archiveEnteredAt:days(-100)});long(d.store,'b',{archiveEnteredAt:days(-100)});
 long(d.store,'summary',{content:'',status:'durable',sourceIds:[]});short(d,'s',{content:'',sourceIds:[]});
 d.store.saveOwner(d.store.makeOwner({ownerType:'learned',ownerId:'refs'},{content:'evidence',canonicalMemoryId:'b',evidenceMemoryIds:['a']},at));
 const w=work(d);expect(d.cleanup.applyOne(at)).toBe('blocked');w.stop();
 expect(w.tally).toMatchObject({snapshotLoads:1,fullOwnerRows:0,awakeningSelects:0,ownerWrites:0,purges:0});
 expect(d.cleanup.status()).toEqual({blockedIds:['s:missing_summary','a:reference','b:reference','archive:protected'],oldestBlock:'s:missing_summary'});
 expect(d.cleanup.nextDeadline(at)).toBeNull();
});
it.each(['long','short'] as const)('deadline_overflow_can_preserves_merged_active_qualifier: %s',kind=>{
 const d=create({...defaultMemoryCapacity,longActiveLimit:kind==='long'?0:null,shortActiveLimit:kind==='short'?0:null});
 if(kind==='long'){
  long(d.store,'summary');short(d,'protect',{shortExpiresAt:days(7)});long(d.store,'merged-active',{mergedInto:'summary'});
 }else{
  long(d.store,'summary');short(d,'missing',{linkedLongId:'absent',shortExpiresAt:days(7)});short(d,'merged-active',{mergedInto:'summary',shortExpiresAt:days(7)});
 }
 const w=work(d);expect(d.cleanup.nextDeadline(at)).toBe(at);w.stop();expect(w.tally).toMatchObject({snapshotLoads:1,fullOwnerRows:0,awakeningSelects:0,ownerWrites:0});
 expect(d.cleanup.applyOne(at)).toBe('blocked');
});
it('next_deadline_keeps_original_iso_string_for_equal_epoch_deadlines',()=>{
 const d=create();long(d.store,'summary');short(d,'a',{shortExpiresAt:'2026-10-09T10:00:00+08:00'});short(d,'b',{shortExpiresAt:'2026-10-09T02:00:00.000Z'});
 expect(d.cleanup.nextDeadline(at)).toBe('2026-10-09T10:00:00+08:00');
});
