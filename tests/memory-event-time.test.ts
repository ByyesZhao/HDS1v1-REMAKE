import {it,expect,afterEach} from 'vitest';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {memoryTask} from '../src/model/contracts';
import {MemoryRetrieval,makeRetrievalRequest} from '../src/memory/retrieval';
import {projectOwner} from '../src/model/context-views';
const original='2026-10-01T02:00:00.000Z',later='2026-10-09T02:00:00.000Z',earlier='2026-09-20T02:00:00.000Z';
const dbs:Storage[]=[];afterEach(()=>dbs.splice(0).forEach(s=>s.close()));
function setup(){const db=new Storage(':memory:');dbs.push(db);const store=new MemoryStore(db);store.migrate(original);return {db,store,life:new MemoryLifecycle(store)};}
function raw(id?:string,progress=false,times:object={}){return {schemaVersion:3,shortTermChanges:[{action:'create',clientRef:'test',...(id?{existingLongId:id,hasNewEventProgress:progress}:{}),content:'考试具体经历',eventSummary:'参加考试',feelingSummary:'轻松',topics:['考试'],sourceIds:['retell'],importance:'high',...times}],longTermChanges:[],detailChanges:[]};}
function saveLong(store:MemoryStore,id='exam',extra:object={}){const r=store.makeOwner({ownerType:'long',ownerId:id},{content:'参加考试',happenedAt:original,happenedUntil:original,retainedFrom:original,expiresAt:'2026-12-30T02:00:00.000Z',sourceIds:['old'],...extra},original);store.saveOwner(r);return r;}
function apply(d:ReturnType<typeof setup>,id?:string,progress=false,times:object={}){d.life.apply(memoryTask(['retell'],id?[id]:[]).parse(raw(id,progress,times)),'new',later,['retell']);return d.store.owner({ownerType:'short',ownerId:'new:short:0'})!;}
it.each([false,true])('linked create inherits canonical event range without dates (progress=%s)',progress=>{
 const d=setup(),old=saveLong(d.store),grants=d.store.listGrants(old.id),short=apply(d,old.id,progress);
 expect(short).toMatchObject({happenedAt:original,happenedUntil:original,createdAt:later,shortExpiresAt:'2026-10-16T02:00:00.000Z'});
 expect(d.store.canonical(old.id)).toMatchObject({happenedAt:original,happenedUntil:original,lastEventUpdateAt:progress?later:original,expiresAt:old.expiresAt,totalAwakenings:0});
 expect(d.store.listGrants(old.id)).toEqual(grants);
});
it.each([undefined,'exam'] as const)('create uses a sole explicit date without another synthetic endpoint: %s',id=>{
 for(const field of ['happenedAt','happenedUntil']){
 const d=setup();if(id)saveLong(d.store);const short=apply(d,id,false,{[field]:earlier});
 expect(short).toMatchObject({happenedAt:earlier,happenedUntil:earlier});
 expect(d.store.canonical(short.linkedLongId!)).toMatchObject({happenedAt:earlier,happenedUntil:id?original:earlier});
 }
});
it('new event defaults to recording time, known endpoints normalize by epoch',()=>{
 const d=setup();expect(apply(d)).toMatchObject({happenedAt:later,happenedUntil:later});
 const e=setup();expect(apply(e,undefined,false,{happenedAt:'2026-10-01T13:00:00+08:00',happenedUntil:'2026-10-01T04:00:00Z'})).toMatchObject({happenedAt:'2026-10-01T04:00:00Z',happenedUntil:'2026-10-01T13:00:00+08:00'});
});
it('missing old end inherits start, preview progress changes grant but not event dates',()=>{
 const d=setup(),old=saveLong(d.store,'exam',{happenedUntil:undefined,retainedFrom:'2026-10-10T02:00:00.000Z',expiresAt:'2027-01-08T02:00:00.000Z'});
 apply(d,old.id,true);expect(d.store.canonical(old.id)).toMatchObject({happenedAt:original,happenedUntil:original,retainedFrom:'2026-10-16T02:00:00.000Z',expiresAt:'2027-01-14T02:00:00.000Z'});
 expect(d.store.listGrants(old.id).filter(g=>g.kind==='initial')).toHaveLength(1);
});
it('false progress allows explicit historic extension and never shrinks union',()=>{
 for(const date of ['2026-09-30T02:00:00Z','2026-10-02T02:00:00Z']){
 const d=setup(),old=saveLong(d.store,'exam',{happenedUntil:'2026-10-03T02:00:00Z'});apply(d,old.id,false,{happenedAt:date});
 expect(d.store.canonical(old.id)).toMatchObject({happenedAt:date.startsWith('2026-09')?date:original,happenedUntil:'2026-10-03T02:00:00Z',expiresAt:old.expiresAt,totalAwakenings:0,lastEventUpdateAt:original});
 }
});
it('merged and learned aliases resolve canonical before date inheritance',()=>{
 for(const alias of ['old','learned']){
 const d=setup();saveLong(d.store);saveLong(d.store,'old',{happenedAt:original,happenedUntil:original});
 d.life.merge(['exam','old'],'exam',later);
 d.store.saveOwner(d.store.makeOwner({ownerType:'learned',ownerId:'learned'},{canonicalMemoryId:'exam',content:'认识',learnedKind:'durable_experience',evidenceMemoryIds:['exam']},later));
 expect(apply(d,alias)).toMatchObject({linkedLongId:'exam',happenedAt:original,happenedUntil:original});
 }
});
it('retrieval and model owner views preserve event date after retalk',async()=>{
 const d=setup();saveLong(d.store);apply(d,'exam');
 const r=await new MemoryRetrieval(d.store).build(makeRetrievalRequest('考试',later,'personal'));
 const row=r.longTerm.find(r=>r.id==='exam')!;expect(row).toBeDefined();
 for(const stage of ['narrative','personal','memory'] as const)expect(projectOwner(row,stage)).toMatchObject({happenedAt:original,happenedUntil:original});
});
it('legacy saved post without progress retains dates and old grant',()=>{
 const d=setup(),old=saveLong(d.store),v=raw(old.id);delete (v.shortTermChanges[0] as any).hasNewEventProgress;
 d.db.save('post_jobs','legacy',{turnId:'legacy',result:v as any});
 d.life.apply(d.db.read('post_jobs','legacy')!.result!,'legacy',later,['retell']);
 expect(d.store.canonical(old.id)).toMatchObject({happenedAt:original,happenedUntil:original,lastEventUpdateAt:original,expiresAt:old.expiresAt});
});

