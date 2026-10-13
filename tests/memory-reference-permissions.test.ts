import {afterEach,describe,expect,it} from 'vitest';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {memoryTask} from '../src/model/contracts';
import type {MemoryCandidate} from '../src/memory/types';

const at='2026-10-13T04:00:00.000Z',opened:Storage[]=[];
afterEach(()=>opened.splice(0).forEach(s=>s.close()));
const empty=()=>({shortUpdateIds:[] as string[],longAwakenIds:[] as string[],existingLongIds:[] as string[]});
const api=()=>import('../src/memory/references.js');
function fixture(){
 const db=new Storage(':memory:');opened.push(db);const store=new MemoryStore(db);
 const long=store.makeOwner({ownerType:'long',ownerId:'L'},{content:'同一事件',retainedFrom:'2026-10-19T04:00:00.000Z',expiresAt:'2027-01-17T04:00:00.000Z'},at);
 const short=store.makeOwner({ownerType:'short',ownerId:'S'},{content:'同一事件详细记录',linkedLongId:'L',shortExpiresAt:'2026-10-19T04:00:00.000Z'},at);
 store.saveOwner(long);store.saveOwner(short);return {db,store,long,short};
}
const linked=(id='L',progress:unknown=false,sources=['e'])=>({schemaVersion:3,shortTermChanges:[{action:'create',clientRef:'revisit',existingLongId:id,hasNewEventProgress:progress,content:'同一事件复议',eventSummary:'事件',feelingSummary:'',topics:[],sourceIds:sources,importance:'normal'}],longTermChanges:[],detailChanges:[]});
const awaken=(id='L')=>({schemaVersion:3,shortTermChanges:[],longTermChanges:[{action:'awaken',id,reason:'真实重谈',sourceIds:['e']}],detailChanges:[]});
describe('memory reference operation permissions',()=>{
 it('linked preview create has separate permissions from awakening and legacy callers',()=>{
  expect(()=>memoryTask(['e'],[],['S'],[],['L']).parse(linked())).not.toThrow();
  expect(()=>memoryTask(['e'],[],['S'],[],['L']).parse(awaken())).toThrow();
  expect(()=>memoryTask(['e'],[],['S']).parse(linked())).toThrow();
  expect(()=>memoryTask(['e'],['L'],['S']).parse(linked())).not.toThrow();
  expect(()=>memoryTask(['e'],[],['S'],[],['L']).parse(linked('U'))).toThrow();
 });
 it.each([undefined,'false'])('linked create still requires boolean progress: %s',progress=>{
  const raw=linked();raw.shortTermChanges[0].hasNewEventProgress=progress;
  expect(()=>memoryTask(['e'],[],['S'],[],['L']).parse(raw)).toThrow();
 });
 it('linked create and awakening still require authorized current sources',()=>{
  expect(()=>memoryTask(['e'],[],['S'],[],['L']).parse(linked('L',false,['old']))).toThrow();
  expect(()=>memoryTask(['e'],['L'],[],['web'],['L']).parse({...awaken(),longTermChanges:[{...awaken().longTermChanges[0],sourceIds:['web']}]})).toThrow();
 });
 it('provided short authorizes its link but no direct long operations',async()=>{
  const {store,short}=fixture(),p=empty();const {extendMemoryWritePermissions}=await api();
  extendMemoryWritePermissions(store,p,[short,short]);
  expect(p).toEqual({shortUpdateIds:['S'],longAwakenIds:[],existingLongIds:['L']});
 });
 it('learned and merged aliases authorize only the provided identity',async()=>{
  const {store,long}=fixture(),p=empty();const {extendMemoryWritePermissions}=await api();
  const alias={...long,id:'A',ownerId:'A',status:'merged' as const,mergedInto:'L'};
  const learned=store.makeOwner({ownerType:'learned',ownerId:'P'},{content:'认识',canonicalMemoryId:'L'},at);
  store.saveOwner(alias);store.saveOwner(learned);
  extendMemoryWritePermissions(store,p,[alias,learned]);
  expect(p).toEqual({shortUpdateIds:[],longAwakenIds:['A','P'],existingLongIds:['A','P']});
  expect(()=>memoryTask(['e'],p.longAwakenIds,[],[],p.existingLongIds).parse(linked('L'))).toThrow();
  expect(()=>memoryTask(['e'],p.longAwakenIds,[],[],p.existingLongIds).parse(awaken('L'))).toThrow();
  expect(()=>memoryTask(['e'],p.longAwakenIds,[],[],p.existingLongIds).parse(linked('P'))).not.toThrow();
 });
 it.each(['missing','wrong-kind','discarded','discarded-alias'])('rejects %s targets without partially extending arrays',async kind=>{
  const {store,long,short,db}=fixture(),p=empty();const {extendMemoryWritePermissions}=await api();
  if(kind==='missing')db.remove('memories','L');
  else if(kind==='wrong-kind')store.saveOwner({...long,kind:'short'} as MemoryCandidate);
  else {store.saveOwner({...long,status:'discarded'});if(kind==='discarded-alias'){store.saveOwner({...long,id:'A',ownerId:'A',status:'merged',mergedInto:'L'});short.linkedLongId='A';}}
  expect(()=>extendMemoryWritePermissions(store,p,[{id:'no-link',kind:'short'},short])).toThrow(/memory reference/);
  expect(p).toEqual(empty());
 });
 it('null links authorize only short update and snapshots are independent',async()=>{
  const {store,short}=fixture(),p=empty();const {extendMemoryWritePermissions,snapshotMemoryWritePermissions}=await api();
  extendMemoryWritePermissions(store,p,[{...short,linkedLongId:null}]);const s=snapshotMemoryWritePermissions(p);
  s.shortUpdateIds.push('U');expect(p).toEqual({shortUpdateIds:['S'],longAwakenIds:[],existingLongIds:[]});
 });
 it('raw and projected rows decode without taking authority from claims or contextRefs',async()=>{
  const {short}=fixture();const {memoryReferenceRows}=await api();
  expect(memoryReferenceRows({retrieved:[short,{id:'d',kind:'detail'}],memoryWritePermissions:{existingLongIds:['U']}})).toEqual([{id:'S',kind:'short',linkedLongId:'L'}]);
  expect(memoryReferenceRows({contextVersion:1,context:{},resources:{owners:[{id:'S',kind:'short',linkedLongId:'L'}]}})).toEqual([{id:'S',kind:'short',linkedLongId:'L'}]);
  expect(memoryReferenceRows({contextRefs:{retrieved:'input.context.x'},memoryWritePermissions:{existingLongIds:['U']}})).toEqual([]);
 });
 it.each([{retrieved:{}},{retrieved:[{id:'',kind:'short'}]},{retrieved:[{id:'S',kind:'short',linkedLongId:123}]},{contextVersion:1,resources:{owners:{}}},{retrieved:[null]},{retrieved:[{id:'L',kind:'mystery'}]}])('rejects malformed recognized rows: %j',async input=>{
  const {memoryReferenceRows}=await api();expect(()=>memoryReferenceRows(input)).toThrow(/memory reference/);
 });
});

