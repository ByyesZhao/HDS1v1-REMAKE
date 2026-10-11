import {expect,it,vi} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {MemoryCapacity,capacityCounts} from '../src/memory/capacity';
import {defaultMemoryCapacity} from '../src/memory/types';
import {readMemoryPolicySnapshot} from '../src/memory/policy-snapshot';

function work(d:ReturnType<typeof fixture>) {
 const tally={snapshotLoads:0,metadataRows:0,fullOwnerRows:0,awakeningQueries:0,awakeningIds:[] as string[],ownerWrites:0,grantWrites:0,dirtyWrites:0};
 const all=vi.spyOn(d.store,'allOwners'),awakenings=vi.spyOn(d.store,'listAwakenings');
 const prepare=d.storage.prepare.bind(d.storage);
 const spy=vi.spyOn(d.storage,'prepare').mockImplementation(sql=>{
  const statement=prepare(sql);
  if(sql.includes("SELECT name FROM sqlite_master"))tally.snapshotLoads++;
  return new Proxy(statement,{get(target,key){
   const value=Reflect.get(target,key,target);
   if(typeof value!=='function')return value;
   return (...args:unknown[])=>{
    const result=Reflect.apply(value,target,args);
    const rows=key==='all'&&Array.isArray(result)?result.length:key==='get'&&result?1:0;
    if(/^SELECT data FROM (memories|details|learned_background)\b/.test(sql))tally.fullOwnerRows+=rows;
    if(sql.includes('AS hasContent FROM'))tally.metadataRows+=rows;
    if(key==='all'&&sql.includes('FROM memory_awakenings')){tally.awakeningQueries++;tally.awakeningIds.push(...args as string[]);}
    if(key==='run'&&/^(INSERT|UPDATE|DELETE)/.test(sql)){
     if(/\b(memories|details|learned_background)\b/.test(sql))tally.ownerWrites++;
     if(sql.includes('memory_retention_grants'))tally.grantWrites++;
     if(sql.includes('memory_dirty_owners'))tally.dirtyWrites++;
    }
    return result;
   };
  }});
 });
 const calls={allOwners:0,listAwakenings:0};
 return {tally,calls,stop(){calls.allOwners=all.mock.calls.length;calls.listAwakenings=awakenings.mock.calls.length;spy.mockRestore();all.mockRestore();awakenings.mockRestore();}};
}
function fullPool(size:number,extra=false) {
 const d=fixture(),content='x'.repeat(size);
 for(let i=0;i<1000+Number(extra);i++)long(d.store,`l-${String(i).padStart(4,'0')}`,{content});
 for(let i=0;i<100;i++)d.store.saveOwner(d.store.makeOwner({ownerType:'short',ownerId:`s-${i}`},{content,linkedLongId:`l-${String(i).padStart(4,'0')}`,shortExpiresAt:days(7)},at));
 for(let i=0;i<500;i++)long(d.store,`a-${i}`,{content,expiresAt:days(-1),archiveEnteredAt:days(-1)});
 return d;
}
it.each([128,4096])('normalize_at_limits_hydrates_zero_owners (%i characters)',size=>{
 const d=fullPool(size),expected=capacityCounts(d.store.allOwners(),at,defaultMemoryCapacity),w=work(d);
 const result=new MemoryCapacity(d.store,defaultMemoryCapacity).normalize(at);w.stop();
 expect(result.changedOwners).toEqual([]);expect(result.counts).toEqual(expected);
 expect(w.calls).toEqual({allOwners:0,listAwakenings:0});
 expect(w.tally).toEqual({snapshotLoads:1,metadataRows:1600,fullOwnerRows:0,awakeningQueries:0,awakeningIds:[],ownerWrites:0,grantWrites:0,dirtyWrites:0});
});
it('normalize_single_overflow_bounds_sort_reads',()=>{
 const d=fullPool(128,true),w=work(d),result=new MemoryCapacity(d.store,defaultMemoryCapacity).normalize(at);w.stop();
 expect(result.changedOwners.map(r=>r.ownerId)).toEqual(['l-0100']);expect(result.counts).toMatchObject({longOccupied:1000,longArchive:501,protectedLong:100});
 expect(w.calls).toEqual({allOwners:0,listAwakenings:0});
 expect(w.tally).toMatchObject({snapshotLoads:1,metadataRows:1601,fullOwnerRows:1,awakeningQueries:2,ownerWrites:1,grantWrites:0,dirtyWrites:1});
 expect(w.tally.awakeningIds).toHaveLength(901);expect(new Set(w.tally.awakeningIds).size).toBe(901);
});
it.each(['references','temporary','missing','whitespace'] as const)('blocked_overflow_preserves_protected_and_missing_summary: %s',mode=>{
 const d=fixture(),config={...defaultMemoryCapacity,shortActiveLimit:mode==='references'?null:0,longActiveLimit:mode==='missing'||mode==='whitespace'?null:0};
 if(mode!=='missing')long(d.store,'l',{content:mode==='whitespace'?'\t\uFEFF\u2029':'summary'});
 if(mode!=='temporary')d.store.saveOwner(d.store.makeOwner({ownerType:'short',ownerId:'s'},{content:'detail',linkedLongId:'l',shortExpiresAt:days(7)},at));
 const w=work(d),result=new MemoryCapacity(d.store,config).normalize(at,mode==='temporary'?['l']:[]);w.stop();
 expect(result.changedOwners).toEqual([]);expect(result.counts).toMatchObject(mode==='temporary'?{longOverflow:1,protectedLong:0}:mode==='references'?{longOverflow:1,shortOverflow:0,protectedLong:1}:{shortOverflow:1});
 expect(w.tally).toMatchObject({snapshotLoads:1,fullOwnerRows:0,awakeningQueries:0,ownerWrites:0,grantWrites:0,dirtyWrites:0});
});
function pairs() {
 const d=fixture();
 for(let i=0;i<3;i++){
  long(d.store,`l-${i}`,{retainedFrom:days(7),expiresAt:days(97)});
  d.store.saveOwner(d.store.makeOwner({ownerType:'short',ownerId:`s-${i}`},{content:'detail',linkedLongId:`l-${i}`,shortExpiresAt:days(7),createdAt:days(i-3),happenedAt:days(i-3),lastEventUpdateAt:days(i-3)},at));
  d.store.saveGrant({id:`l-${i}:initial`,canonicalMemoryId:`l-${i}`,kind:'initial',anchorAt:days(7),expiresAt:days(97),triggerDates:[]});
 }
 // A later grant must survive moving the initial anchor forward.
 d.store.saveGrant({id:'l-0:renew',canonicalMemoryId:'l-0',kind:'renew',anchorAt:at,expiresAt:days(120),triggerDates:[]});
 return d;
}
const pairConfig={...defaultMemoryCapacity,shortActiveLimit:1,longActiveLimit:2};
it('story_normalize_handles_multiple_deltas',()=>{
 const d=pairs(),grants=vi.spyOn(d.store,'listGrants'),w=work(d);
 const result=new MemoryCapacity(d.store,pairConfig).normalize(at);w.stop();
 expect(result.changedOwners.map(r=>r.ownerId)).toEqual(['s-0','l-0','s-1','l-1']);
 expect(result.counts).toMatchObject({shortActive:1,longOccupied:3,longOverflow:1,protectedLong:1});expect(result.temporaryProtectedIds).toEqual(['l-0','l-1']);
 expect(grants).toHaveBeenCalledTimes(2);grants.mockRestore();expect(w.tally.fullOwnerRows).toBe(4);
 expect(d.store.canonical('l-0')).toMatchObject({retainedFrom:at,expiresAt:days(120),stateVersion:2,revision:1});
 expect(d.store.canonical('l-1')).toMatchObject({retainedFrom:at,expiresAt:days(90),stateVersion:2,revision:1});
 expect(d.store.dirtyOwners().map(r=>r.ownerId).sort()).toEqual(['l-0','l-1','s-0','s-1']);
});
it('background_budget_one_keeps_short_long_pair_atomic',()=>{
 const d=pairs(),w=work(d),result=new MemoryCapacity(d.store,pairConfig).normalize(at,[],1);w.stop();
 expect(result.changedOwners.map(r=>r.ownerId)).toEqual(['s-0','l-0']);expect(result.counts).toMatchObject({shortActive:2,longOccupied:3,protectedLong:2});
 expect(d.store.listGrants('l-0').find(r=>r.kind==='initial')).toMatchObject({anchorAt:at,expiresAt:days(90)});
 expect(d.store.canonical('l-1')).toMatchObject({retainedFrom:days(7),stateVersion:1});expect(d.store.owner({ownerType:'short',ownerId:'s-1'})?.capacityExitedAt).toBeNull();
 expect(w.tally).toMatchObject({fullOwnerRows:2,ownerWrites:2,grantWrites:1,dirtyWrites:2});
});
it('changeBudget zero leaves overflow untouched and caller snapshot is reused',()=>{
 const d=pairs(),snapshot=readMemoryPolicySnapshot(d.storage),w=work(d);
 const result=new MemoryCapacity(d.store,pairConfig).normalize(at,[],0,snapshot);w.stop();
 expect(result.changedOwners).toEqual([]);expect(result.counts).toMatchObject({shortOverflow:2,longOverflow:1});
 expect(w.tally).toMatchObject({snapshotLoads:0,metadataRows:0,fullOwnerRows:0,awakeningQueries:0,ownerWrites:0,grantWrites:0,dirtyWrites:0});
});
it('multiple exited shorts sharing one preview hydrate and update the canonical owner once',()=>{
 const d=fixture();long(d.store,'l',{retainedFrom:days(7),expiresAt:days(97)});long(d.store,'old',{status:'merged',mergedInto:'l'});
 d.store.saveOwner(d.store.makeOwner({ownerType:'learned',ownerId:'learned'},{content:'projection',canonicalMemoryId:'old'},at));
 for(let i=0;i<3;i++)d.store.saveOwner(d.store.makeOwner({ownerType:'short',ownerId:`s-${i}`},{content:'detail',linkedLongId:i%2?'learned':'old',shortExpiresAt:days(7)},at));
 const w=work(d),snapshot=readMemoryPolicySnapshot(d.storage),capacity=new MemoryCapacity(d.store,{...defaultMemoryCapacity,shortActiveLimit:0,longActiveLimit:0});
 const result=capacity.normalize(at,[],Infinity,snapshot);w.stop();
 expect(result.changedOwners.map(row=>row.ownerId)).toEqual(['s-0','l','s-1','s-2']);expect(result.temporaryProtectedIds).toEqual(['l']);
 expect(result.counts).toMatchObject({shortActive:0,longOccupied:1,longOverflow:1,protectedLong:1});
 expect(w.tally).toMatchObject({snapshotLoads:1,metadataRows:6,fullOwnerRows:4,awakeningQueries:1,awakeningIds:['l'],ownerWrites:4,grantWrites:1,dirtyWrites:4});
 expect(snapshot.byOwner.get('long:l')).toMatchObject({retainedFrom:at,stateVersion:2});expect(capacity.counts(at,snapshot)).toEqual(result.counts);
});
