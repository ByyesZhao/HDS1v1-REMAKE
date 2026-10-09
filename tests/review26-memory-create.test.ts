import {afterEach,describe,expect,it} from 'vitest';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {memoryTask} from '../src/model/contracts';
import {ModelClient} from '../src/model/client';

const at='2026-01-01T00:00:00.000Z',next='2026-01-02T00:00:00.000Z';
const opened:Storage[]=[];
afterEach(()=>opened.splice(0).forEach(s=>s.close()));
function setup(importance:'normal'|'high'='normal'){
 const db=new Storage(':memory:');opened.push(db);const store=new MemoryStore(db),life=new MemoryLifecycle(store);
 life.apply({schemaVersion:3,shortTermChanges:[{action:'create',clientRef:'first',content:'考试详情',eventSummary:'参加考试',feelingSummary:'紧张',topics:['考试'],sourceIds:['e1'],importance}],longTermChanges:[],detailChanges:[]},'first',at,['e1']);
 return {db,store,life,id:'first:short:0:long'};
}
function linked(id:string,progress:boolean){return {schemaVersion:3 as const,shortTermChanges:[{action:'create' as const,clientRef:'linked',existingLongId:id,hasNewEventProgress:progress,content:'重新记录考试的细节',eventSummary:'同次考试的摘要',feelingSummary:'放松',topics:['考试'],sourceIds:['e2'],importance:'normal' as const,happenedAt:at,happenedUntil:at}],longTermChanges:[],detailChanges:[]};}

describe('REVIEW26 linked short create',()=>{
 it.each([undefined,'true'])('rejects missing or nonboolean progress for linked model output: %s',progress=>{
  const raw={...linked('provided',false),shortTermChanges:[{...linked('provided',false).shortTermChanges[0],hasNewEventProgress:progress}]};
  expect(()=>memoryTask(['e2'],['provided']).parse(raw)).toThrow(/hasNewEventProgress/);
 });
 it('records linked paraphrase without postponing preview or changing meaningful event time',()=>{
  const d=setup(),before=d.store.canonical(d.id)!,grants=d.store.listGrants(d.id);
  const parsed=memoryTask(['e2'],[d.id]).parse(linked(d.id,false));
  d.life.apply(parsed,'repeat',next,['e2']);
  expect(d.store.canonical(d.id)).toMatchObject({retainedFrom:'2026-01-08T00:00:00.000Z',expiresAt:'2026-04-08T00:00:00.000Z',lastEventUpdateAt:at,totalAwakenings:0,eventSummary:'同次考试的摘要',sourceIds:['e1','e2']});
  expect(d.store.listGrants(d.id)).toEqual(grants);expect(d.store.canonical(d.id)!.stateVersion).toBeGreaterThan(before.stateVersion);
  expect(d.store.owner({ownerType:'short',ownerId:'repeat:short:0'})).toMatchObject({linkedLongId:d.id,shortExpiresAt:'2026-01-09T00:00:00.000Z'});
  expect(d.store.owner({ownerType:'long',ownerId:'repeat:short:0:long'})).toBeNull();
 });
 it('postpones preview only for declared new progress and keeps one initial grant',()=>{
  const d=setup();
  const parsed=memoryTask(['e2'],[d.id]).parse(linked(d.id,true));
  d.life.apply(parsed,'progress',next,['e2']);
  expect(d.store.canonical(d.id)).toMatchObject({retainedFrom:'2026-01-09T00:00:00.000Z',expiresAt:'2026-04-09T00:00:00.000Z',lastEventUpdateAt:next,totalAwakenings:0});
  const initial=d.store.listGrants(d.id).filter(g=>g.kind==='initial');expect(initial).toHaveLength(1);expect(initial[0]).toMatchObject({anchorAt:'2026-01-09T00:00:00.000Z',expiresAt:'2026-04-09T00:00:00.000Z'});
  const snapshot=d.store.canonical(d.id),grants=d.store.listGrants(d.id);
  d.life.apply(parsed,'progress','2026-01-03T00:00:00.000Z',['e2']);
  expect(d.store.canonical(d.id)).toEqual(snapshot);expect(d.store.listGrants(d.id)).toEqual(grants);
 });
 it.each([false,true])('does not reopen an already effective long on linked create: %s',progress=>{
  const d=setup('high'),grants=d.store.listGrants(d.id);
  d.life.apply(memoryTask(['e2'],[d.id]).parse(linked(d.id,progress)),'later',next,['e2']);
  expect(d.store.canonical(d.id)).toMatchObject({retainedFrom:at,expiresAt:'2026-04-01T00:00:00.000Z',lastEventUpdateAt:progress?next:at,totalAwakenings:0});
  expect(d.store.listGrants(d.id)).toEqual(grants);
 });
 it('saved legacy linked result without progress remains applicable without granting progress',()=>{
  const d=setup(),raw=linked(d.id,false),{hasNewEventProgress,...legacy}=raw.shortTermChanges[0];
  d.db.save('post_jobs','saved',{turnId:'saved',result:{...raw,shortTermChanges:[legacy]}});
  const saved=d.db.read('post_jobs','saved')!.result!;
  d.life.apply(saved,'saved',next,['e2']);
  expect(d.store.canonical(d.id)).toMatchObject({retainedFrom:'2026-01-08T00:00:00.000Z',expiresAt:'2026-04-08T00:00:00.000Z',lastEventUpdateAt:at});
  expect(d.store.owner({ownerType:'short',ownerId:'saved:short:0'})?.linkedLongId).toBe(d.id);
 });
 it('repairs missing linked progress through the existing model loop before applying a paraphrase',async()=>{
  const d=setup(),corrected=linked(d.id,false),{hasNewEventProgress,...missing}=corrected.shortTermChanges[0];let requests=0;
  const client=new ModelClient({complete:async()=>++requests===1?{...corrected,shortTermChanges:[missing]}:corrected});
  const result=await client.runModel(memoryTask(['e2'],[d.id]),{});
  d.life.apply(result,'repaired',next,['e2']);
  expect(requests).toBe(2);expect(d.store.canonical(d.id)).toMatchObject({retainedFrom:'2026-01-08T00:00:00.000Z',lastEventUpdateAt:at});
 });
});
