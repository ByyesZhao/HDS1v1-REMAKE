import { expect, it } from 'vitest';
import { fixture, long, at } from './memory-capacity-fixture';
it('legacy_owner_runtime_normalization', () => {
  const {store,storage}=fixture(); long(store,'old');
  const row=store.owner({ownerType:'long',ownerId:'old'})!;
  expect(row).toMatchObject({capacityExitedAt:null,capacityExitReason:null,archiveEnteredAt:null,evidenceMemoryIds:[]});
  expect(storage.runtime()).toMatchObject({memoryCapacityVersion:null,memoryIdle:null});
  expect(store.schemaVersion()).toBe(3);
});
it('dirty_latest_version',()=>{
  const {store}=fixture(); const row=long(store,'a');
  store.queueDirty(row,'event',at); store.queueDirty(row,'awaken',at);
  const newer={...row,stateVersion:2}; store.queueDirty(newer,'capacity',at);
  store.completeDirty(row,row);
  expect(store.dirtyOwners()).toHaveLength(1);
  expect(store.dirtyOwners()[0]).toMatchObject({stateVersion:2,status:'pending',reasons:['event','awaken','capacity']});
});
it('done_watermark_no_requeue',()=>{
  const {store}=fixture(); const row=long(store,'a'); store.queueDirty(row,'event',at);
  const result={...row,revision:2}; store.completeDirty(row,result); store.queueDirty(result,'expiry',at);
  expect(store.dirtyOwners()).toEqual([]);
  store.queueDirty({...result,stateVersion:2},'awaken',at); expect(store.dirtyOwners()).toHaveLength(1);
});
