import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Storage} from '../src/storage';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {assembleWeb} from '../src/deployment/web-runtime';
import {loadSettings} from '../src/settings';
import {ModelClient} from '../src/model/client';
import {NOW,TestClock} from './helpers';
const opened:Storage[]=[];afterEach(()=>opened.splice(0).forEach(s=>s.close()));
function create(candidates:any[]=[]){const db=new Storage(':memory:');opened.push(db);const store=new WebSearchStore(db),read:string[]=[],provider={signature:'offline',search:async()=>candidates,read:async(url:string)=>{read.push(url);return {title:'Page',body:'可用资料'};}},service=new WebSearchService(store,provider,new TestClock(),{enabled:true}),session=service.openSession(store.openStage('turn','t','personal','personal_chat'));return {db,store,read,provider,service,session};}
async function search(d:ReturnType<typeof create>,requestedPages=1){const op=d.session.beginOperation({kind:'search',request:{query:'手机',requestedPages}});return d.session.searchAndRead(op.request.kind==='search'?op.request.request:{query:''},{operationId:op.operationId});}
it('production does not inject configured sources when search is empty and reports insufficiency instead',async()=>{
 const d=create(),service=assembleWeb(d.db,{webSearch:{enabled:true,maxSuccessReads:20,maxFailures:40},webSources:['https://example.test/configured']} as any,new TestClock(),d.provider);d.session=service.openSession(d.store.openStage('turn','configured','world','world'));
 const response=await search(d);expect(d.read).toEqual([]);expect(response.materials).toEqual([]);expect((response as any).message).toBe('结果不足');expect((response as any).obtainedPages).toBe(0);expect(response.counters).toEqual({successReads:0,failures:1});
});
it('a partial search keeps its useful material and tells the model how many pages remain unsatisfied',async()=>{
 const d=create([{url:'https://example.test/a',title:''}]),response=await search(d,3);expect(response.materials).toHaveLength(1);expect((response as any).message).toBe('结果不足');expect((response as any).requestedPages).toBe(3);expect((response as any).obtainedPages).toBe(1);expect(response.counters).toEqual({successReads:1,failures:0});
});
it('insufficient results reach the same model and it can finish with a question rather than invented information',async()=>{
 const d=create(),requests:any[]=[];const task={name:'personal_chat',prompt:'fixture',schema:{type:'object'},parse:(v:any)=>{if(!v.answer)throw Error('answer required');return v;}};
 const client=new ModelClient({complete:async request=>{requests.push(request);return requests.length===1?{webSearch:{query:'手机'}}:{answer:'没有查到足够的信息，你能告诉我具体型号吗？'};}});
 const answer=await client.runModel(task,{visible:'手机'},{web:d.session,lookup:null});expect(answer.answer).toContain('具体型号');expect(requests[1].webResults[0].message).toBe('结果不足');expect(d.session.snapshot().repairCount).toBe(0);expect(d.session.snapshot().operations).toHaveLength(1);
});
it('invalid candidate URLs count separately and do not prevent a subsequent valid page; replay never counts them again',async()=>{
 const d=create([{url:'/relative',title:''},{url:'file:///D:/fixture',title:''},{url:'https://example.test/a',title:''}]);const response=await search(d);expect(response.materials).toHaveLength(1);expect(response.counters).toEqual({successReads:1,failures:2});expect(response.failures?.map(f=>f.reason)).toEqual(['read_error','read_error']);const op=d.session.snapshot().operations[0];expect(op.status).toBe('done');await d.session.searchAndRead({query:'手机'},{operationId:op.operationId});expect(d.session.snapshot().counters).toEqual({successReads:1,failures:2});expect(d.read).toEqual(['https://example.test/a']);
});
it('an invalid provider result shape becomes a confirmed search error instead of a stranded operation',async()=>{
 const d=create();d.provider.search=async()=>null as any;const response=await search(d);expect(response.failures?.[0].reason).toBe('search_error');expect(response.counters.failures).toBe(1);expect(d.session.snapshot().operations[0].status).toBe('done');expect((response as any).message).toBe('结果不足');
});
it('deployment configuration rejects non-HTTP source URLs before a provider is ever enabled',()=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-review7-settings-'));try{const sample=JSON.parse(readFileSync('examples/story.sample.json','utf8'));delete sample.backgroundFile;for(const url of ['ftp://example.test/a','file:///D:/fixture']){writeFileSync(join(root,'story.json'),JSON.stringify({...sample,webSources:[url]}));expect(()=>loadSettings(join(root,'story.json'),{})).toThrow();}}finally{rmSync(root,{recursive:true,force:true});}
});
it('accepting a valid tool clears obsolete repair text while preserving the consumed repair allowance',async()=>{
 const d=create([{url:'https://example.test/a',title:''}]),requests:any[]=[],values=[{bad:1},{webSearch:{query:'手机'}},{answer:'done'}];const task={name:'personal_chat',prompt:'fixture',schema:{type:'object'},parse:(v:any)=>{if(!v.answer)throw Error('answer required');return v;}};
 await new ModelClient({complete:async request=>{requests.push(request);return values.shift();}}).runModel(task,{}, {web:d.session,lookup:null});expect(requests[1].repair).toBeDefined();expect(requests[2].repair).toBeUndefined();expect(d.session.snapshot().repairCount).toBe(1);
});
it('forty invalid candidate pages exhaust only failures and never read the forty-first valid candidate',async()=>{
 const d=create([...Array.from({length:40},(_,i)=>({url:`/invalid-${i}`,title:''})),{url:'https://example.test/a',title:''}]),response=await search(d);expect(response.stopReason).toBe('quota');expect(response.counters).toEqual({successReads:0,failures:40});expect(d.read).toEqual([]);expect(response.message).toBe('结果不足');
});
it('resuming after an invalid URL and interrupted read keeps the confirmed failure without searching again',async()=>{
 const d=create([{url:'/invalid',title:''},{url:'https://example.test/a',title:''}]),controller=new AbortController();d.provider.read=async()=>{controller.abort(Error('interrupted'));throw controller.signal.reason;};
 const op=d.session.beginOperation({kind:'search',request:{query:'手机'}});await expect(d.session.searchAndRead({query:'手机'},{operationId:op.operationId,signal:controller.signal})).rejects.toThrow('interrupted');expect(d.session.snapshot().counters).toEqual({successReads:0,failures:1});expect(d.session.snapshot().operations[0].nextCandidateIndex).toBe(1);
 const restored=new WebSearchService(new WebSearchStore(d.db),{signature:'offline',search:async()=>{throw Error('unexpected re-search');},read:async()=>({title:'restored',body:'可用正文'})},new TestClock(),{enabled:true}).openSession(d.session.ref);
 const response=await restored.searchAndRead({query:'手机'},{operationId:op.operationId});expect(response.materials).toHaveLength(1);expect(response.counters).toEqual({successReads:1,failures:1});expect(restored.snapshot().operations[0].status).toBe('done');
});
