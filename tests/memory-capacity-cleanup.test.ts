import {expect,it} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {MemoryCapacity} from '../src/memory/capacity';
import {MemoryCleanup} from '../src/memory/cleanup';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {defaultMemoryCapacity} from '../src/memory/types';
function create(){const d=fixture(),cap=new MemoryCapacity(d.store,defaultMemoryCapacity);return {...d,cap,cleanup:new MemoryCleanup(d.store,cap)};}
it('archive_501_eviction_before_90_days',()=>{
 const d=create();for(let i=0;i<501;i++)long(d.store,`a${String(i).padStart(3,'0')}`,{archiveEnteredAt:at});
 expect(d.cleanup.applyOne(days(1))).toBe('applied');expect(d.cap.counts(days(1)).longArchive).toBe(500);expect(d.store.canonical('a000')).toBeNull();
});
it('archive_age_without_overflow and archive_anchor_survives_later_expiry',()=>{
 const d=create();long(d.store,'a',{archiveEnteredAt:days(10),capacityExitedAt:days(10),expiresAt:days(200)});
 expect(d.cleanup.applyOne(days(99))).toBe('none');expect(d.cleanup.nextDeadline(days(99))).toBe(days(100));expect(d.cleanup.applyOne(days(100))).toBe('applied');expect(d.store.canonical('a')).toBeNull();
});
it('natural_expiry_without_persisted_anchor',()=>{
 const d=create();long(d.store,'a',{expiresAt:days(90)});expect(d.cleanup.nextDeadline(days(110))).toBe(days(180));expect(d.cleanup.applyOne(days(180))).toBe('applied');
});
it('archive_oldest_low_awaken_first',()=>{
 const d=create();const cap=new MemoryCapacity(d.store,{...defaultMemoryCapacity,longArchiveLimit:1}),cleanup=new MemoryCleanup(d.store,cap);
 long(d.store,'important',{importance:'high',totalAwakenings:0,lastEventUpdateAt:days(-30),archiveEnteredAt:at});long(d.store,'normal',{totalAwakenings:1,archiveEnteredAt:at});
 cleanup.applyOne(days(1));expect(d.store.canonical('important')).toBeNull();expect(d.store.canonical('normal')).not.toBeNull();
});
it('short_details_expire_after_summary',()=>{
 const d=create();long(d.store,'l');const s=d.store.makeOwner({ownerType:'short',ownerId:'s'},{content:'临时详细正文',linkedLongId:'l',capacityExitedAt:days(3),shortExpiresAt:days(7)},at);d.store.saveOwner(s);
 for(const revision of [1,2])d.store.saveVector({...s,revision},'x',new Float32Array([1,0]));d.store.queueIndex(s,at);
 expect(d.cleanup.applyOne(days(6))).toBe('none');expect(d.cleanup.applyOne(days(7))).toBe('applied');expect(d.store.owner(s)).toBeNull();expect(d.store.canonical('l')).not.toBeNull();expect(d.storage.prepare('SELECT count(*) n FROM memory_index').get()!.n).toBe(0);expect(d.store.jobs('memory_index_jobs')).toEqual([]);
});
it('protect_and_repoint_references',()=>{
 const d=create();long(d.store,'old',{archiveEnteredAt:days(-100)});long(d.store,'main');
 const s=d.store.makeOwner({ownerType:'short',ownerId:'s'},{content:'s',linkedLongId:'old',shortExpiresAt:days(7)},at);d.store.saveOwner(s);
 const learned=d.store.makeOwner({ownerType:'learned',ownerId:'understanding'},{content:'认识',canonicalMemoryId:'old',evidenceMemoryIds:['old','main']},at);d.store.saveOwner(learned);
 expect(d.cleanup.applyOne(at)).toBe('blocked');expect(d.store.canonical('old')).not.toBeNull();
 d.store.saveGrant({id:'old:initial',canonicalMemoryId:'old',kind:'initial',anchorAt:at,expiresAt:days(90),triggerDates:[]});
 new MemoryLifecycle(d.store,d.cap).merge(['old','main'],'main',at);
 expect(d.store.owner(s)?.linkedLongId).toBe('main');expect(d.store.owner(learned)?.evidenceMemoryIds).toEqual(['main']);
 expect(d.store.listGrants('main')[0].canonicalMemoryId).toBe('main');
 expect(d.store.owner({ownerType:'long',ownerId:'old'})?.content).toBe('');
});
it('unfinished story protects cleanup and missing summary blocks short',()=>{
 const d=create();long(d.store,'a',{archiveEnteredAt:days(-100)});d.storage.save('turns','running',{id:'running',done:false} as any);expect(d.cleanup.applyOne(at)).toBe('blocked');
 d.storage.remove('turns','running');d.store.saveOwner(d.store.makeOwner({ownerType:'short',ownerId:'orphan'},{content:'details',linkedLongId:'missing',shortExpiresAt:at},at));expect(d.cleanup.applyOne(at)).toBe('applied');expect(d.cleanup.applyOne(at)).toBe('blocked');expect(d.store.owner({ownerType:'short',ownerId:'orphan'})).not.toBeNull();
});
