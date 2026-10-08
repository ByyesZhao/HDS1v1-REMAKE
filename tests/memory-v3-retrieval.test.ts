import { afterEach, expect, it } from 'vitest';
import { ChatEpisodes as DialogueEpisodes } from '../src/dialogue/chat-episodes';
import { DialogueStore } from '../src/dialogue/store';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';
import { MemoryRetrieval, makeRetrievalRequest } from '../src/memory/retrieval';
import { MemoryLifecycle } from '../src/memory/lifecycle';
import { ContextBuilder } from '../src/memory/context';
import { NOW, setup, saveInput } from './helpers';
import { generateTurn } from '../src/app';
import { addMs } from '../src/time';
const stores:Storage[]=[]; afterEach(()=>stores.splice(0).forEach(s=>s.close()));
function create(limits:any={}) {const storage=new Storage(':memory:');stores.push(storage);const store=new MemoryStore(storage);store.migrate(NOW);const retrieval=new MemoryRetrieval(store,undefined,limits);return {storage,store,retrieval};}
function owner(store:MemoryStore,id:string,kind:'detail'|'short'|'long'|'learned',data:any={}) {
  const row=store.makeOwner({ownerType:kind,ownerId:id},{content:'手机经历完整尾部',topics:['手机'],sourceIds:['source'],retainedFrom:NOW,expiresAt:addMs(NOW,90*86400000),shortExpiresAt:addMs(NOW,7*86400000),...data},NOW);store.saveOwner(row);return row;
}
const request=(q='手机',at=NOW)=>makeRetrievalRequest(q,at,'personal_chat',null,['visible']);
it('guards archive and detail history independently and never derives permission from hidden input',async()=>{
  const {storage,store,retrieval}=create();owner(store,'phone','detail',{key:'phone',value:'新手机',aliases:['手机']});
  storage.save('detail_history','h',{id:'h',key:'phone',previousValue:'旧手机',newValue:'新手机',effectiveAt:NOW,reason:'换机',sourceIds:[],turnId:'old'});
  owner(store,'expired','long',{expiresAt:addMs(NOW,-1)});
  expect((await retrieval.build(request())).detailHistory).toEqual([]);
  await expect(retrieval.lookup({query:'以前的手机',scope:'archive',includeDetailHistory:true},request())).rejects.toThrow('permission');
  expect((await retrieval.build(request('以前用什么手机'))).detailHistory).toHaveLength(1);
  expect((await retrieval.build(request('还记得那次手机经历吗'))).longTerm.map(x=>x.id)).toContain('expired');
  const d=setup();stores.push(d.storage);saveInput(d.storage,'hidden','回忆一下去年那次生日');
  d.storage.set('character',{...d.storage.character(),scene:{mode:'chat',description:'自习',shared:null,activity:{description:'自习',startsAt:NOW,expectedEndAt:addMs(NOW,60000),phoneAccess:false}}});
  await generateTurn(d,{inputMessageIds:['hidden'],taskIds:[],triggerKinds:['input']},'turn');
  const n=d.models.calls[0];expect(n.input.visibleMessages).toBeUndefined();expect(n.input.resources.owners.filter((r:any)=>r.kind==='long')).toEqual([]);
  await expect(n.options!.lookup!({query:'生日',scope:'archive',includeDetailHistory:false})).rejects.toThrow('permission');
});
it('switches at seven days to preview even without vectors or completed maintenance, and archives after ninety days',async()=>{
  const {store,retrieval}=create();new MemoryLifecycle(store).apply({schemaVersion:3,shortTermChanges:[{action:'create',clientRef:'event',content:'手机详细全文',eventSummary:'手机简要事件',feelingSummary:'开心',topics:['手机'],sourceIds:['s'],importance:'normal'}],longTermChanges:[],detailChanges:[]},'t',NOW,['s']);
  expect((await retrieval.build(request())).shortTerm[0].content).toBe('手机详细全文');expect((await retrieval.build(request())).longTerm).toEqual([]);
  const edge=addMs(NOW,7*86400000),context=await retrieval.build(request('手机',edge));expect(context.shortTerm).toEqual([]);expect(context.longTerm[0].content).toContain('手机简要事件');
  const expiry=addMs(edge,90*86400000);expect((await retrieval.build(request('手机',expiry))).longTerm).toEqual([]);
  expect((await retrieval.build(request('还记得那次手机',expiry))).longTerm).toHaveLength(1);
});
it('provides every relevant item beyond old quotas and excludes generic weak matches and merged records',async()=>{
  const {store,retrieval}=create();
  for(let i=0;i<100;i++)owner(store,`l${i}`,'long',{content:`手机事件${i} ${'正文'.repeat(60)}尾部${i}`});
  for(let i=0;i<15;i++){owner(store,`d${i}`,'detail',{key:`phone${i}`,value:`手机型号${i}`,aliases:['手机']});owner(store,`s${i}`,'short');owner(store,`a${i}`,'learned',{content:'稳定认识'.repeat(100),alwaysInclude:true,learnedKind:'stable_understanding'});}
  owner(store,'negative','long',{content:'今天她继续学习并计划聊天',topics:['生活']});owner(store,'merged','long',{status:'merged',mergedInto:'l0'});
  const c=await retrieval.build(request());expect(c.longTerm).toHaveLength(100);expect(c.details).toHaveLength(15);expect(c.shortTerm).toHaveLength(15);expect(c.learned).toHaveLength(15);
  expect(c.longTerm.every(x=>x.content.includes(`尾部${x.id.slice(1)}`)&&x.sourceIds[0]==='source')).toBe(true);expect(JSON.stringify(c).length).toBeGreaterThan(8000);
  const empty=await retrieval.build(request('今天她继续生活计划聊天'));expect(empty.longTerm).toEqual([]);
});
it('shares one optional long limit across ordinary and on-demand learned records, leaves alwaysInclude independent',async()=>{
  const {store,retrieval}=create({longItemsLimit:2});owner(store,'l','long');owner(store,'m','long');owner(store,'learned','learned');owner(store,'always','learned',{alwaysInclude:true,learnedKind:'stable_understanding',content:'认识'.repeat(600)});
  const c=await retrieval.build(request());expect(c.longTerm.length+c.learned.filter(x=>!x.alwaysInclude).length).toBe(2);expect(c.learned.some(x=>x.id==='always')).toBe(true);
});
it('keeps complete recent dialogue episodes, budgets only complete records, and organizer ignores unused recent history',async()=>{
  const {storage,store,retrieval}=create();for(let i=0;i<31;i++)new DialogueEpisodes(new DialogueStore(storage)).acceptMessage({id:`m${i}`,content:'已看原文'.repeat(300),direction:'outgoing',receivedAt:addMs(NOW,i),platformMessageIds:[],batchId:null,seenTurnId:null,turnId:'old',outboxSeq:i});
  owner(store,'l','long',{content:'手机正文完整尾部'});const builder=new ContextBuilder(storage,retrieval);const c=await builder.build(request());expect(c.recent.map(x=>x.id)).toEqual(Array.from({length:31},(_,i)=>`m${i}`));
  const organized=await builder.buildForMemory({...request(),budget:2000});expect(organized.retrieved[0].content).toBe('手机正文完整尾部');
  const limited=await builder.build({...request(),budget:1});expect(limited.longTerm).toEqual([]);expect(c.longTerm[0].content).toBe('手机正文完整尾部');
});
it('filters vector candidates by current state and revision and does not enable uncalibrated semantic-only',async()=>{
  const {store,storage}=create();storage.set('memory_embedding_signature','sig');const matching=owner(store,'l','long');store.saveVector(matching,'sig',new Float32Array([1,0]));owner(store,'unrelated','long',{content:'化学考试',topics:['考试']});
  const index:any={configSignature:'sig',query:async()=>new Float32Array([1,0]),stats:{lexicalFallbacks:0}};const retrieval=new MemoryRetrieval(store,index);
  expect((await retrieval.build(request())).longTerm.map(x=>x.id)).toEqual(['l']);store.saveOwner({...matching,revision:2,content:'无关正文',topics:[]});expect((await retrieval.build(request())).longTerm).toEqual([]);
});
it('SQL filtering and unlimited relevant recall hold with ten thousand records at three and six months',async()=>{
  const {store,storage,retrieval}=create();storage.transaction(()=>{for(let i=0;i<10000;i++)owner(store,`row${i}`,'long',{content:i<100?'手机生日经历':'数学考试复习',topics:i<100?['手机']:['考试'],expiresAt:addMs(NOW,200*86400000)});});
  for(const days of[90,180]){const started=performance.now();const result=await retrieval.build(request('手机生日经历',addMs(NOW,days*86400000)));expect(result.longTerm).toHaveLength(100);expect(result.longTerm.some(x=>x.id==='row9999')).toBe(false);expect(performance.now()-started).toBeLessThan(5000);}
});
it('applies calibrated semantic thresholds before RRF60 and puts explicit aliases ahead of fused ranks',async()=>{
  const {store,storage}=create();storage.set('memory_embedding_signature','sig');const a=owner(store,'a','long'),b=owner(store,'b','long');
  store.saveVector(a,'sig',new Float32Array([.8,.6]));store.saveVector(b,'sig',new Float32Array([1,0]));const weak=owner(store,'weak','long',{content:'无关数学',topics:[]});store.saveVector(weak,'sig',new Float32Array([.3,.95]));
  owner(store,'exact','detail',{key:'phone',aliases:['手机'],value:'A'});
  const index:any={configSignature:'sig',query:async()=>new Float32Array([1,0]),stats:{lexicalFallbacks:0}};const r=new MemoryRetrieval(store,index,{}, {lexical:{fact:1,experience:1},semantic:{fact:.7,experience:.7,configSignature:'sig'}});
  const c=await r.build(request());expect(c.details[0].id).toBe('exact');expect(c.longTerm.map(x=>x.id)).toEqual(['a','b']);
  // A and B tie after opposing route ranks; deterministic ID order breaks the tie.
  expect(c.longTerm.some(x=>x.id==='weak')).toBe(false);
});
