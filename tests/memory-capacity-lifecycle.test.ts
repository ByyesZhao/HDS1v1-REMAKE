import {expect,it} from 'vitest';
import {fixture,long,at,days,request} from './memory-capacity-fixture';
import {MemoryCapacity} from '../src/memory/capacity';
import {defaultMemoryCapacity} from '../src/memory/types';
import {MemoryLifecycle} from '../src/memory/lifecycle';
const change=(i:number)=>({action:'create' as const,clientRef:`s${i}`,content:`详情${i}`,eventSummary:`概要${i}`,feelingSummary:'开心',topics:[],sourceIds:['e'],importance:'normal' as const});
it('short_101_summary_immediate',()=>{
 const {store}=fixture(),cap=new MemoryCapacity(store,defaultMemoryCapacity),life=new MemoryLifecycle(store,cap);
 life.apply({schemaVersion:3,shortTermChanges:Array.from({length:101},(_,i)=>change(i)),longTermChanges:[],detailChanges:[]},'t',at,['e']);
 const result=cap.normalize(days(3)); expect(result.counts.shortActive).toBe(100);
 const s=store.owner({ownerType:'short',ownerId:'t:short:0'})!,l=store.canonical(s.linkedLongId!)!;
 expect(s).toMatchObject({capacityExitedAt:days(3),shortExpiresAt:days(7)});
 expect(l).toMatchObject({retainedFrom:days(3),expiresAt:days(93),totalAwakenings:0});
 expect(store.listGrants(l.id)[0].anchorAt).toBe(days(3));
 expect(store.selectCandidates(request(days(3))).map(r=>r.id)).toContain(l.id);
 expect(store.selectCandidates(request(days(3),'archive')).map(r=>r.id)).not.toContain(s.id);
});
it('long_1001_includes_preview',()=>{
 const {store}=fixture(),cap=new MemoryCapacity(store,defaultMemoryCapacity);
 for(let i=0;i<1001;i++)long(store,`l-${String(i).padStart(4,'0')}`,{retainedFrom:days(7)});
 expect(cap.normalize(at).counts).toMatchObject({longOccupied:1000,longPreview:1000,longVisible:0,longArchive:1});
});
it('same_long_multiple_shorts_count and canonical_awaken_rank',()=>{
 const {store}=fixture(),cap=new MemoryCapacity(store,{...defaultMemoryCapacity,shortActiveLimit:1});
 long(store,'old',{totalAwakenings:9});long(store,'new',{totalAwakenings:0});
 for(const [id,linkedLongId] of [['a','old'],['b','new']])store.saveOwner(store.makeOwner({ownerType:'short',ownerId:id},{content:id,shortExpiresAt:days(7),linkedLongId},at));
 expect(cap.counts(at).shortActive).toBe(2);cap.normalize(at);
 expect(store.owner({ownerType:'short',ownerId:'b'})?.capacityExitedAt).toBe(at);
 const b=store.owner({ownerType:'short',ownerId:'b'})!;store.saveOwner({...b,capacityExitedAt:null,linkedLongId:'old'});
 expect(cap.counts(at).shortActive).toBe(2);
});
it('active_sort_and_protection',()=>{
 const {store}=fixture(),cap=new MemoryCapacity(store,{...defaultMemoryCapacity,longActiveLimit:1});
 long(store,'a',{importance:'high'});long(store,'b');long(store,'protected');
 store.saveOwner(store.makeOwner({ownerType:'short',ownerId:'s'},{content:'s',linkedLongId:'protected',shortExpiresAt:days(7)},at));
 expect(cap.normalize(at).counts).toMatchObject({longOccupied:1,protectedLong:1});expect(store.canonical('protected')?.capacityExitedAt).toBeNull();
 expect(store.canonical('a')?.capacityExitedAt).toBe(at);
});
it('capacity_reactivate_same_day',()=>{
 const {store}=fixture(),cap=new MemoryCapacity(store,defaultMemoryCapacity),life=new MemoryLifecycle(store,cap);
 long(store,'a',{capacityExitedAt:at,archiveEnteredAt:at,expiresAt:days(200)});
 const input={id:'a',turnId:'t',at:days(1),sourceIds:['e'],reason:'重谈',allowedIds:['a'],allowedSourceIds:['e']};
 life.awaken(input);store.saveOwner({...store.canonical('a')!,capacityExitedAt:days(1),archiveEnteredAt:days(1)});life.awaken(input);
 expect(store.canonical('a')).toMatchObject({capacityExitedAt:null,archiveEnteredAt:null,totalAwakenings:1,expiresAt:days(200)});
 expect(store.listGrants('a').filter(g=>g.kind==='reactivate')).toHaveLength(1);
});
it('active_short_link_to_archived_long',()=>{
 const {store}=fixture(),cap=new MemoryCapacity(store,defaultMemoryCapacity);long(store,'a',{expiresAt:days(-1)});
 store.saveOwner(store.makeOwner({ownerType:'short',ownerId:'s'},{content:'s',linkedLongId:'a',shortExpiresAt:days(7)},at));
 expect(cap.normalize(at).counts).toMatchObject({longArchive:1,protectedLong:1});expect(store.canonical('a')?.expiresAt).toBe(days(-1));
});
