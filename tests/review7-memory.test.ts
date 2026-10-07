import {afterEach,expect,it} from 'vitest';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryRetrieval,makeRetrievalRequest} from '../src/memory/retrieval';
import {NOW} from './helpers';
import {addMs} from '../src/time';
import {memoryTask} from '../src/model/contracts';
const day=86400000,opened:Storage[]=[];
afterEach(()=>opened.splice(0).forEach(s=>s.close()));
function create(limits:any={}){const db=new Storage(':memory:');opened.push(db);const store=new MemoryStore(db);store.migrate(NOW);return {db,store,life:new MemoryLifecycle(store),retrieval:new MemoryRetrieval(store,undefined,limits)};}
function event(d:ReturnType<typeof create>,importance:'normal'|'high'='normal'){
 d.life.apply({schemaVersion:3,shortTermChanges:[{action:'create',clientRef:'event',content:'手机详细经历',eventSummary:'手机经历',feelingSummary:'开心',topics:['手机'],sourceIds:['e'],importance}],longTermChanges:[],detailChanges:[]},'t',NOW,['e']);
}
it('archive and structured lookup hide a normal preview until its exact seventh day, while expiry remains recoverable',async()=>{
 const d=create();event(d);const request=(at:string)=>makeRetrievalRequest('还记得那次手机经历吗',at,'personal_chat');
 const early=await d.retrieval.build(request(addMs(NOW,day)));expect(early.shortTerm).toHaveLength(1);expect(early.longTerm).toEqual([]);
 expect((await d.retrieval.lookup({query:'手机',scope:'archive',includeDetailHistory:false},request(addMs(NOW,day)))).longTerm).toEqual([]);
 expect((await d.retrieval.build(request(addMs(NOW,7*day)))).longTerm).toHaveLength(1);
 expect((await d.retrieval.build(request(addMs(NOW,97*day)))).longTerm).toHaveLength(1);
 expect((await d.retrieval.build(makeRetrievalRequest('手机',addMs(NOW,97*day),'personal_chat'))).longTerm).toEqual([]);
});
it('an important event remains immediately visible to archive and current retrieval',async()=>{
 const d=create();event(d,'high');for(const query of ['手机','还记得那次手机经历吗'])expect((await d.retrieval.build(makeRetrievalRequest(query,NOW,'personal_chat'))).longTerm).toHaveLength(1);
});
it('optional history budget preserves whole entries supported by current sources as well as current message IDs',()=>{
 const d=create(),protectedRow=d.store.makeOwner({ownerType:'long',ownerId:'memory'},{content:'完整手机记录',sourceIds:['current']},NOW);
 const context={longTerm:[d.store.makeOwner({ownerType:'long',ownerId:'old'},{content:'可移除旧记录',sourceIds:['old-source']},NOW),protectedRow],recent:[{id:'current',content:'当前消息'}]};
 d.retrieval.budget(context,1,['current']);expect(context.longTerm.map(r=>r.id)).toEqual(['memory']);expect(context.recent.map(r=>r.id)).toEqual(['current']);expect(context.longTerm[0].content).toBe('完整手机记录');
});
it('counts an always-included understanding removed by an explicitly enabled optional limit exactly once',async()=>{
 const d=create({alwaysIncludeCharactersLimit:1});d.store.saveOwner(d.store.makeOwner({ownerType:'learned',ownerId:'s'},{content:'完整稳定认识',alwaysInclude:true,learnedKind:'stable_understanding'},NOW));
 const context=await d.retrieval.build(makeRetrievalRequest('不相关主题',NOW,'personal_chat'));expect(context.learned).toEqual([]);expect(d.retrieval.metrics.excludedByLimits).toBe(1);
});
it('create and update store memory facts without replaying DTO operation fields',()=>{
 const d=create();event(d);const id='t:short:0';d.life.apply({schemaVersion:3,shortTermChanges:[{action:'update',id,content:'手机新进展',eventSummary:'手机经历',feelingSummary:'开心',topics:['手机'],sourceIds:['e'],hasNewEventProgress:true}],longTermChanges:[],detailChanges:[]},'next',addMs(NOW,day),['e']);
 const row=d.store.owner({ownerType:'short',ownerId:id})!;expect(row.content).toBe('手机新进展');for(const key of ['action','clientRef','existingLongId','hasNewEventProgress'])expect(row).not.toHaveProperty(key);
});
it('old persisted DTO control fields are excluded from retrieval without requiring a database rewrite',async()=>{
 const d=create();event(d);const row=d.store.owner({ownerType:'short',ownerId:'t:short:0'})!;d.db.prepare('UPDATE memories SET data=? WHERE id=?').run(JSON.stringify({...row,action:'create',clientRef:'old',existingLongId:'old-long',hasNewEventProgress:true}),row.id);
 const context=await d.retrieval.build(makeRetrievalRequest('手机',NOW,'personal_chat'));expect(context.shortTerm).toHaveLength(1);for(const key of ['action','clientRef','existingLongId','hasNewEventProgress'])expect(context.shortTerm[0]).not.toHaveProperty(key);
});
it('merging preserves earliest and latest known event times separately from latest processing progress',()=>{
 const d=create();const rows=[{id:'a',happenedAt:addMs(NOW,-10*day),happenedUntil:addMs(NOW,-9*day),lastEventUpdateAt:addMs(NOW,-3*day)},{id:'b',happenedAt:addMs(NOW,-8*day),happenedUntil:addMs(NOW,-7*day),lastEventUpdateAt:addMs(NOW,-day)}];
 for(const row of rows)d.store.saveOwner(d.store.makeOwner({ownerType:'long',ownerId:row.id},{content:'同一手机经历',sourceIds:['e'],retainedFrom:NOW,...row} as any,NOW));
 d.life.merge(['a','b'],'a',NOW);const main=d.store.canonical('a')!;expect(main.happenedAt).toBe(addMs(NOW,-10*day));expect((main as any).happenedUntil).toBe(addMs(NOW,-7*day));expect(main.lastEventUpdateAt).toBe(addMs(NOW,-day));
});
it('memory contract retains source-supported event times and progress extends the linked range without using processing time as its endpoint',()=>{
 const d=create();event(d);const at=addMs(NOW,3*day),end=addMs(NOW,day),id='t:short:0';
 const value={schemaVersion:3,shortTermChanges:[{action:'update',id,content:'手机新经历',eventSummary:'手机新经历',feelingSummary:'开心',topics:['手机'],sourceIds:['e'],hasNewEventProgress:true,happenedAt:end,happenedUntil:end}],longTermChanges:[],detailChanges:[]};
 const parsed=memoryTask(['e'],[],[id]).parse(value);expect((parsed.shortTermChanges[0] as any).happenedUntil).toBe(end);d.life.apply(parsed,'update',at,['e']);const short=d.store.owner({ownerType:'short',ownerId:id})!,long=d.store.canonical(short.linkedLongId!)!;
 for(const row of [short,long]){expect(row.happenedAt).toBe(NOW);expect((row as any).happenedUntil).toBe(end);expect(row.lastEventUpdateAt).toBe(at);}
});
it('promotion clears the renewal-window count immediately while preserving total evidence',()=>{
 const d=create();const row=d.store.makeOwner({ownerType:'long',ownerId:'a'},{content:'手机经历',totalAwakenings:30,windowAwakenings:2,expiresAt:addMs(NOW,90*day)},NOW);d.store.saveOwner(row);d.life.promote('a','p','手机经历','durable_experience',false,['a'],NOW);const current=d.store.canonical('a')!;expect(current.windowAwakenings).toBe(0);expect(current.totalAwakenings).toBe(30);expect(current.expiresAt).toBeNull();
});
it('a short summary-only edit leaves the detailed-text embedding revision unchanged',()=>{
 const d=create();event(d);const row=d.store.owner({ownerType:'short',ownerId:'t:short:0'})!,before=d.store.jobs<any>('memory_index_jobs').filter(j=>j.owner.ownerId===row.id).length;
 d.life.apply({schemaVersion:3,shortTermChanges:[{action:'update',id:row.id,content:row.content,eventSummary:'手机新的简要摘要',feelingSummary:row.feelingSummary,topics:row.topics,sourceIds:['e'],hasNewEventProgress:false}],longTermChanges:[],detailChanges:[]},'u',addMs(NOW,day),['e']);
 expect(d.store.owner(row)!.eventSummary).toBe('手机新的简要摘要');expect(d.store.owner(row)!.revision).toBe(row.revision);expect(d.store.jobs<any>('memory_index_jobs').filter(j=>j.owner.ownerId===row.id)).toHaveLength(before);
});
it('a durable experience projection follows corrected event time and newly supported sources without re-embedding unchanged text',()=>{
 const d=create();event(d,'high');const id='t:short:0',long=d.store.canonical(`${id}:long`)!;d.store.saveOwner({...long,totalAwakenings:30});d.life.promote(long.id,'learned',long.content,'durable_experience',false,[long.id],NOW);d.life.synchronizeProjections(d.store.canonical(long.id)!,NOW);const before=d.store.owner({ownerType:'learned',ownerId:'learned'})!;
 const end=addMs(NOW,day),at=addMs(NOW,3*day);d.life.apply({schemaVersion:3,shortTermChanges:[{action:'update',id,content:'手机详细经历',eventSummary:'手机经历',feelingSummary:'开心',topics:['手机'],sourceIds:['fresh'],hasNewEventProgress:true,happenedAt:end,happenedUntil:end}],longTermChanges:[],detailChanges:[]},'next',at,['fresh']);
 const learned=d.store.owner(before)!;expect((learned as any).happenedUntil).toBe(end);expect(learned.sourceIds).toContain('fresh');expect(learned.projectionBasis?.sourceIds).toContain('fresh');expect(learned.revision).toBe(before.revision);expect(learned.lastEventUpdateAt).toBe(at);
});
