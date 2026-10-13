import {afterEach,describe,expect,it,vi} from 'vitest';
import {organizeMemory} from '../src/memory/organize';
import {stageInput} from '../src/model/context-views';
import {MemoryRetrieval,makeRetrievalRequest} from '../src/memory/retrieval';
import {fixture,linkedCreate,claim,QUERY} from './memory-existing-long-fixture';
const closed:Array<()=>void>=[];afterEach(()=>closed.splice(0).forEach(f=>f()));
const setup=(options:Parameters<typeof fixture>[0]={})=>{const d=fixture(options);closed.push(d.close);return d;};
const initial={shortUpdateIds:['S'],longAwakenIds:[],existingLongIds:['L']};
const none={shortUpdateIds:[],longAwakenIds:[],existingLongIds:[]};

describe('memory create link context and HTTP permissions',()=>{
 it.each([false,true])('real retrieval reuses preview on first response, progress=%s',async progress=>{
  const d=setup();d.responses[0]=linkedCreate('L',progress);const before=d.store.canonical('L')!;
  const result=await organizeMemory(d.deps,d.turn);expect(d.requests).toHaveLength(1);
  expect(d.envelopes[0].input.context.memoryWritePermissions).toEqual(initial);
  expect(d.envelopes[0].resources.owners.map((r:any)=>r.id)).toEqual(['S']);
  expect(d.envelopes[0].resources.owners[0].linkedLongId).toBe('L');
  expect(d.session.checkpoint()?.repairCount).toBe(0);
  d.life.apply(result,d.turn.id,d.turn.at,['new-source']);const after=d.store.canonical('L')!;
  expect(d.store.owner({ownerType:'short',ownerId:d.turn.id+':short:0'})?.linkedLongId).toBe('L');
  expect(d.store.owner({ownerType:'long',ownerId:d.turn.id+':short:0:long'})).toBeNull();
  expect(after.sourceIds).toEqual(['old-source','new-source']);expect(after.totalAwakenings).toBe(before.totalAwakenings);
  expect(d.store.listAwakenings('L')).toEqual([]);
  if(!progress){expect(after.retainedFrom).toBe(before.retainedFrom);expect(after.expiresAt).toBe(before.expiresAt);expect(after.lastEventUpdateAt).toBe(before.lastEventUpdateAt);}
  const later=await new MemoryRetrieval(d.store).build(makeRetrievalRequest(QUERY,d.turn.at,'personal_chat'));
  expect(later.longTerm).toEqual([]);
 });
 it.each([false,true])('lookup transmits cumulative permissions through visual wrapper=%s',async media=>{
  const d=setup({query:'无关新经历',media});d.responses.splice(0,1,{lookupDetails:QUERY},linkedCreate());
  const result=await organizeMemory(d.deps,d.turn);expect(d.requests).toHaveLength(2);
  expect(d.envelopes[0].input.context.memoryWritePermissions).toEqual(none);
  expect(d.envelopes[1].input.context.memoryWritePermissions).toEqual(none);
  expect(d.envelopes[1].lookupResult.context.memoryWritePermissions).toEqual(initial);
  expect(d.envelopes[1].resources.owners.map((r:any)=>r.id)).toEqual(['S']);
  expect(result.shortTermChanges[0]).toMatchObject({existingLongId:'L'});
  expect(d.session.checkpoint()).toMatchObject({repairCount:0,lookupUsed:true});
 });
 it.each(['raw','projected'])('restored %s lookup rewrites actual permissions and preserves budget',async format=>{
  const d=setup({query:'无关新经历'});const raw={retrieved:[d.short],details:[],memoryWritePermissions:claim,school:{knownSnapshots:[]}};
  const lookup=format==='raw'?raw:stageInput('memory',raw);const old=structuredClone(lookup);
  d.session.saveCheckpoint({formatVersion:2,input:{},repairCount:1,lookupUsed:true,lookupPending:false,privateLookupResult:lookup,pendingOperationId:null,toolResults:[]});
  const find=vi.spyOn(d.deps.retrieval!,'lookup');const result=await organizeMemory(d.deps,d.turn);
  expect(find).not.toHaveBeenCalled();expect(d.requests).toHaveLength(1);
  expect(d.envelopes[0].input.context.memoryWritePermissions).toEqual(none);
  expect(d.envelopes[0].lookupResult.context.memoryWritePermissions).toEqual(initial);
  expect(JSON.stringify(d.envelopes[0].lookupResult)).not.toContain('UNPROVIDED');
  expect(lookup).toEqual(old);expect(result.shortTermChanges[0]).toMatchObject({existingLongId:'L'});
  expect(d.session.checkpoint()).toMatchObject({repairCount:1,lookupUsed:true,lookupPending:false});
 });
 it('confirmed claims without rows cannot authorize an existing database ID',async()=>{
  const d=setup({query:'无关新经历',repairLimit:0});
  d.session.saveCheckpoint({formatVersion:2,input:{},repairCount:0,lookupUsed:true,privateLookupResult:{contextRefs:{x:'input.context.x'},memoryWritePermissions:claim},pendingOperationId:null,toolResults:[]});
  await expect(organizeMemory(d.deps,d.turn)).rejects.toThrow(/existingLongId/);
  expect(d.envelopes[0].lookupResult.context.memoryWritePermissions).toEqual(none);
 });
 it('only related IDs are usable; invented ID exhausts original two repairs',async()=>{
  const d=setup();d.responses[0]=linkedCreate('UNPROVIDED');
  await expect(organizeMemory(d.deps,d.turn)).rejects.toThrow(/existingLongId/);
  expect(d.requests).toHaveLength(3);expect(d.session.checkpoint()?.repairCount).toBe(2);
 });
 it('related preview is still not authorized for awaken even after lookup',async()=>{
  const d=setup({query:'无关新经历',repairLimit:0});
  d.responses.splice(0,1,{lookupDetails:QUERY},{schemaVersion:3,shortTermChanges:[],longTermChanges:[{action:'awaken',id:'L',sourceIds:['new-source'],reason:'重谈'}],detailChanges:[]});
  await expect(organizeMemory(d.deps,d.turn)).rejects.toThrow(/longTermChanges.id/);
  expect(d.envelopes[1].lookupResult.context.memoryWritePermissions.longAwakenIds).toEqual([]);
 });
});

