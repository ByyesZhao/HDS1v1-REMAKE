import {expect,it} from 'vitest';
import {fixture,long,at,days,request} from './memory-capacity-fixture';
import {MemoryCapacity,archiveStart,isArchivedLong} from '../src/memory/capacity';
import {defaultMemoryCapacity} from '../src/memory/types';
it('archive_membership_sql_matches_policy',()=>{
 const {store}=fixture();
 long(store,'live');long(store,'expired',{expiresAt:at});long(store,'capacity',{capacityExitedAt:days(-2)});
 long(store,'anchored',{archiveEnteredAt:days(-10)});long(store,'durable',{status:'durable',expiresAt:days(-2)});
 long(store,'merged',{status:'merged',mergedInto:'live',expiresAt:days(-2)});long(store,'discarded',{status:'discarded',expiresAt:days(-2)});
 const rows=store.allOwners();expect(rows.filter(r=>isArchivedLong(r,at)).map(r=>r.id).sort()).toEqual(['anchored','capacity','expired']);
 expect(store.archivedLongs(at).map(r=>r.id).sort()).toEqual(['anchored','capacity','expired']);
 expect(new MemoryCapacity(store,defaultMemoryCapacity).counts(at).longArchive).toBe(3);
 expect(store.selectCandidates(request()).map(r=>r.id)).toEqual(['live']);
 expect(store.selectCandidates(request(at,'archive')).map(r=>r.id).sort()).toEqual(['anchored','capacity','expired','live']);
 expect(archiveStart(store.canonical('expired')!,at)).toBe(at);
});
it('archive_query_not_reactivate and preview gate',()=>{
 const {store}=fixture();long(store,'archived',{archiveEnteredAt:at});long(store,'preview',{retainedFrom:days(7),capacityExitedAt:at});
 const before=store.canonical('archived');expect(store.selectCandidates(request(at,'archive')).map(r=>r.id)).toEqual(['archived']);expect(store.canonical('archived')).toEqual(before);
});
