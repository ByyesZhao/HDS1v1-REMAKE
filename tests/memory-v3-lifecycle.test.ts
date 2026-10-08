import { afterEach, describe, expect, it } from 'vitest';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';
import { MemoryLifecycle } from '../src/memory/lifecycle';
import { memoryTask } from '../src/model/contracts';
import { addMs } from '../src/time';
import type { MemoryResultV3 } from '../src/memory/types';
import { setup as setupApp } from './helpers';
import { HdsiApp } from '../src/app';
const at='2026-10-07T00:00:00.000Z';const day=86400_000;const stores:Storage[]=[];
afterEach(()=>stores.splice(0).forEach(s=>s.close()));
function setup(){const s=new Storage(':memory:');stores.push(s);const store=new MemoryStore(s);store.migrate(at);return{store,life:new MemoryLifecycle(store)};}
const empty=():MemoryResultV3=>({schemaVersion:3,shortTermChanges:[],longTermChanges:[],detailChanges:[]});
const create=(importance:'normal'|'high'='normal'):MemoryResultV3=>({...empty(),shortTermChanges:[{action:'create',clientRef:'one',content:'考试过程，紧张后放松',eventSummary:'参加考试',feelingSummary:'先紧张后轻松',topics:['考试'],sourceIds:['e'],importance}]});
const awake=(life:MemoryLifecycle,id:string,turnId:string,when:string)=>life.awaken({id,turnId,at:when,sourceIds:['e'],reason:'主动重谈考试',allowedIds:[id],allowedSourceIds:['e']});
describe('memory lifecycle V0.3',()=>{
  it('creates detailed 7-day short and preview long, normal/high have distinct initial anchors',()=>{
    const{store,life}=setup();life.apply(create(),'t',at,['e']);life.apply(create('high'),'h',at,['e']);
    expect(store.owner({ownerType:'short',ownerId:'t:short:0'})).toMatchObject({shortExpiresAt:'2026-10-14T00:00:00.000Z',linkedLongId:'t:short:0:long',totalAwakenings:0});
    expect(store.owner({ownerType:'long',ownerId:'t:short:0:long'})).toMatchObject({retainedFrom:'2026-10-14T00:00:00.000Z',expiresAt:'2027-01-12T00:00:00.000Z',content:'参加考试\n先紧张后轻松'});
    expect(store.owner({ownerType:'long',ownerId:'h:short:0:long'})?.retainedFrom).toBe(at);
  });
  it('new progress extends short/unscheduled preview but does not automatically awaken, paraphrase does not extend',()=>{
    const{store,life}=setup();life.apply(create(),'t',at,['e']);const id='t:short:0';
    const update=(progress:boolean)=>({...empty(),shortTermChanges:[{action:'update' as const,id,content:'更新过程',eventSummary:'考试继续',feelingSummary:'轻松',topics:['考试'],sourceIds:['e'],hasNewEventProgress:progress}]});
    life.apply(update(false),'u',addMs(at,day),['e']);expect(store.owner({ownerType:'short',ownerId:id})?.shortExpiresAt).toBe(addMs(at,7*day));
    life.apply(update(true),'u2',addMs(at,2*day),['e']);expect(store.owner({ownerType:'short',ownerId:id})?.shortExpiresAt).toBe(addMs(at,9*day));expect(store.canonical(`${id}:long`)?.totalAwakenings).toBe(0);
    expect(store.listGrants(`${id}:long`).filter(g=>g.kind==='initial')).toHaveLength(1);
    const anchor=store.canonical(`${id}:long`)!.expiresAt;life.apply(update(true),'u3',addMs(at,10*day),['e']);expect(store.canonical(`${id}:long`)?.expiresAt).toBe(anchor);
  });
  it('a new detailed record linked to an existing event updates the same summary without renewing or creating a duplicate long',()=>{
    const {store,life}=setup();life.apply(create('high'),'original',at,['e']);const id='original:short:0:long',expires=store.canonical(id)!.expiresAt;
    const result=create();(result.shortTermChanges[0] as any).existingLongId=id;result.shortTermChanges[0].eventSummary='同一次考试增加了补考结果';life.apply(result,'next',addMs(at,10*day),['e']);
    expect(store.canonical(id)!.eventSummary).toContain('补考结果');expect(store.canonical(id)!.expiresAt).toBe(expires);expect(store.owner({ownerType:'long',ownerId:'next:short:0:long'})).toBeNull();
  });
  it('deduplicates Shanghai dates, renews after three distinct dates and does not reuse consumed dates',()=>{
    const{store,life}=setup();life.apply(create('high'),'t',at,['e']);const id='t:short:0:long';
    awake(life,id,'a',at);awake(life,id,'b',addMs(at,1000));awake(life,id,'c',addMs(at,day));awake(life,id,'d',addMs(at,2*day));
    expect(store.canonical(id)).toMatchObject({totalAwakenings:3,windowAwakenings:0,expiresAt:addMs(at,92*day)});
    expect(store.listAwakenings(id)).toHaveLength(3);expect(store.listGrants(id).filter(g=>g.kind==='renew')).toHaveLength(1);
    awake(life,id,'e',addMs(at,2*day+1000));expect(store.canonical(id)?.windowAwakenings).toBe(0);
  });
  it('archive updates do not revive, genuine awakening reactivates once and starts a clean window',()=>{
    const{store,life}=setup();life.apply(create('high'),'t',at,['e']);const id='t:short:0:long';awake(life,id,'late',addMs(at,100*day));
    expect(store.canonical(id)).toMatchObject({expiresAt:addMs(at,190*day),windowAwakenings:0,totalAwakenings:1});expect(store.listGrants(id).at(-1)?.kind).toBe('reactivate');
    awake(life,id,'again',addMs(at,100*day+1000));expect(store.canonical(id)?.windowAwakenings).toBe(0);
  });
  it('merges overlapping date logs by UPSERT, preserves earliest turn/provenance and existing grants',()=>{
    const{store,life}=setup();life.apply(create('high'),'a',at,['e']);life.apply(create('high'),'b',at,['e']);const a='a:short:0:long',b='b:short:0:long';
    awake(life,a,'20a','2026-10-20T01:00:00+08:00');awake(life,a,'22a','2026-10-22T02:00:00+08:00');awake(life,b,'21b','2026-10-21T01:00:00+08:00');awake(life,b,'22b','2026-10-22T01:00:00+08:00');
    life.merge([a,b],a);expect(store.listAwakenings(a)).toHaveLength(3);expect(store.listAwakenings(b)).toHaveLength(0);expect(store.listAwakenings(a).at(-1)?.turnId).toBe('22b');expect(store.canonical(a)?.totalAwakenings).toBe(3);expect(store.canonical(b)?.id).toBe(a);
    const grants=JSON.stringify(store.listGrants(a));life.merge([a,b],a);expect(JSON.stringify(store.listGrants(a))).toBe(grants);
  });
  it('rolls back an overlapping merge, counts and grants in the callers formal transaction',()=>{
    const{store,life}=setup();life.apply(create('high'),'a',at,['e']);life.apply(create('high'),'b',at,['e']);const a='a:short:0:long',b='b:short:0:long';awake(life,a,'a',at);awake(life,b,'b',at);
    expect(()=>store.storage.transaction(()=>{life.merge([a,b],a);throw new Error('failed commit');})).toThrow('failed commit');
    expect(store.canonical(b)?.id).toBe(b);expect(store.listAwakenings(a)).toHaveLength(1);expect(store.listAwakenings(b)).toHaveLength(1);expect(store.listGrants(a)).toHaveLength(1);
  });
  it('30 distinct dates register one evidence candidate; durable promotion retains canonical counts without expiry',()=>{
    const{store,life}=setup();life.apply(create('high'),'t',at,['e']);const id='t:short:0:long';for(let i=0;i<30;i++)awake(life,id,`d${i}`,addMs(at,i*day));
    expect(life.promotionCandidates(addMs(at,30*day))).toHaveLength(1);life.evaluateRetain(id);expect(life.promotionCandidates(addMs(at,30*day))).toHaveLength(0);
    awake(life,id,'31',addMs(at,30*day));expect(life.promotionCandidates(addMs(at,30*day))).toHaveLength(1);life.promote(id,'learned','考试经验','durable_experience',false,[id],at);
    expect(store.canonical(id)).toMatchObject({status:'durable',expiresAt:null});expect(store.owner({ownerType:'learned',ownerId:'learned'})?.canonicalMemoryId).toBe(id);
    awake(life,'learned','future',addMs(at,300*day));expect(store.canonical(id)?.totalAwakenings).toBe(32);
  });
  it('validates nonempty current sources by operation; self web read only supports short and replay does not advance dates',()=>{
    const good=create();good.shortTermChanges[0].sourceIds=['web'];const task=memoryTask(['e'],['old'],['short'],['web']);expect(()=>task.parse(good)).not.toThrow();
    expect(()=>task.parse({...empty(),detailChanges:[{action:'create',key:'phone',value:'A',aliases:[],reason:'网页',sourceIds:['web']}]})).toThrow(/sourceIds/);
    expect(()=>task.parse({...empty(),longTermChanges:[{action:'awaken',id:'old',reason:'提及',sourceIds:['web']}]})).toThrow(/sourceIds/);
    expect(()=>task.parse({...good,shortTermChanges:[{...good.shortTermChanges[0],sourceIds:[]}]})).toThrow(/sourceIds/);
    expect(()=>task.parse({...good,shortTermChanges:[{...good.shortTermChanges[0],sourceIds:['unknown']}]})).toThrow(/sourceIds/);
    const{store,life}=setup();life.apply(good,'t',at,['e'],['web']);life.apply(good,'t',addMs(at,day),['e'],['web']);expect(store.owner({ownerType:'short',ownerId:'t:short:0'})?.createdAt).toBe(at);
  });
  it('organizes role self-reading without a chat source and persists its ID for postprocessing recovery',async()=>{
    const d=setupApp();stores.push(d.storage);(d as any).getSelfWebReadSources=(turnId:string)=>[{id:'web',turnId,runId:'life-run',operationId:'op',materialId:'page',url:'https://example.test',readAt:at,sourceKind:'self_web_read',phase:'personal_life'}];
    const output=create();output.shortTermChanges[0].sourceIds=['web'];d.models.outputs.memory=output;
    const transaction=d.storage.transaction.bind(d.storage);let calls=0;d.storage.transaction=((fn:any)=>{if(++calls===2)throw new Error('commit stopped');return transaction(fn);}) as any;
    const app=new HdsiApp(d);await expect(app.runTurn({inputMessageIds:[],taskIds:[],triggerKinds:['autonomous']})).rejects.toThrow('commit stopped');
    const turn=d.storage.unfinishedTurn()!;expect(d.storage.read('post_jobs',turn.id)).toMatchObject({selfWebReadSources:[{id:'web'}],memoryIds:{one:`${turn.id}:short:0`}});
    delete (d as any).getSelfWebReadSources;await app.resumeUnfinishedTurn();expect(new MemoryStore(d.storage).owner({ownerType:'short',ownerId:`${turn.id}:short:0`})?.sourceIds).toEqual(['web']);
  });
});
