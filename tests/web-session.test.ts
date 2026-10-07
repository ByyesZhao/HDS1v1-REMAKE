import { afterEach,expect,it,vi } from 'vitest';
import { Storage } from '../src/storage';
import { WebSearchStore } from '../src/web/store';
import { WebSearchService } from '../src/web/service';
import { TestClock } from './helpers';
import type { WebOperationRequest,WebSearchSession } from '../src/web/types';
const opened:Storage[]=[];afterEach(()=>opened.splice(0).forEach(s=>s.close()));
function create(){const storage=new Storage(':memory:');opened.push(storage);const store=new WebSearchStore(storage),clock=new TestClock();const provider={signature:'fixture',search:vi.fn(async(q:string)=>{if(q==='error')throw new Error('offline search error');return q==='empty'?[]:[{url:`https://example.test/${q}`,title:'列表摘要'}];}),read:vi.fn(async(url:string)=>{if(url.includes('bad'))throw new Error('offline read error');return {title:'正文',body:`资料正文 ${url}`};})};const service=new WebSearchService(store,provider,clock,{enabled:true,maxSuccessReads:20,maxFailures:40});const open=(stage='world',owner='t')=>service.openSession(store.openStage('turn',owner,stage,stage));return {storage,store,provider,service,open};}
function counts(storage:Storage,id:string,successReads:number,failures:number){const data=JSON.parse(String(storage.prepare('SELECT data FROM web_sessions WHERE id=?').get(id)!.data));data.counters={successReads,failures};storage.prepare('UPDATE web_sessions SET data=? WHERE id=?').run(JSON.stringify(data),id);}
async function operation(session:WebSearchSession,request:WebOperationRequest){const record=session.beginOperation(request);return request.kind==='search'?session.searchAndRead(request.request,{operationId:record.operationId}):session.readPage(request.url,{operationId:record.operationId});}
it.each([{s:18,f:3,url:'ok',expected:[19,3]},{s:15,f:39,url:'bad',expected:[15,40]},{s:19,f:10,url:'ok',expected:[20,10]},{s:19,f:39,url:'ok',expected:[20,39]},{s:19,f:39,url:'bad',expected:[19,40]}])('counts success and failure separately at boundary $s/$f',async({s,f,url,expected})=>{
  const d=create(),session=d.open();counts(d.storage,session.id,s,f);const response=await operation(session,{kind:'read',url:`https://example.test/${url}`});expect([response.counters.successReads,response.counters.failures]).toEqual(expected);
  if(expected[0]===20||expected[1]===40){const n=d.provider.read.mock.calls.length;expect((await operation(session,{kind:'read',url:'https://example.test/next'})).stopReason).toBe('quota');expect(d.provider.read).toHaveBeenCalledTimes(n);}
});
it('stops forty empty searches at 0/40, distinguishes no candidates and gives another stage independent allowance',async()=>{
  const d=create(),s=d.open();for(let i=0;i<40;i++)expect((await operation(s,{kind:'search',request:{query:'empty'}})).stopReason).toBe('no_candidates');expect(s.snapshot().counters).toEqual({successReads:0,failures:40});expect((await operation(s,{kind:'search',request:{query:'empty'}})).stopReason).toBe('quota');expect(d.provider.search).toHaveBeenCalledTimes(40);expect(s.snapshot().operations[0].failures[0].reason).toBe('no_candidates');
  await operation(d.open('personal_life'),{kind:'search',request:{query:'ok'}});expect(d.provider.search).toHaveBeenCalledTimes(41);
});
it('records search error and page error once per operation and only reads remaining success allowance',async()=>{
  const d=create(),s=d.open();await operation(s,{kind:'search',request:{query:'error'}});await operation(s,{kind:'read',url:'https://example.test/bad'});expect(s.snapshot().counters.failures).toBe(2);counts(d.storage,s.id,19,2);d.provider.search.mockResolvedValue([{url:'https://example.test/1',title:''},{url:'https://example.test/2',title:''},{url:'https://example.test/3',title:''}]);await operation(s,{kind:'search',request:{query:'many',requestedPages:5}});expect(s.snapshot().counters.successReads).toBe(20);expect(d.provider.read).toHaveBeenCalledTimes(2);
});
it('implements B: four same-owner stages use one fetch but each first acquisition costs one; replay costs zero',async()=>{
  const d=create(),sessions=['narrative','personal_life','expression','memory'].map(stage=>d.open(stage));
  for(const s of sessions)await operation(s,{kind:'search',request:{query:'public'}});expect(d.provider.read).toHaveBeenCalledTimes(1);expect(sessions.map(s=>s.snapshot().counters)).toEqual(Array.from({length:4},()=>({successReads:1,failures:0})));expect(sessions.slice(1).map(s=>s.snapshot().metrics.cacheHits)).toEqual([1,1,1]);
  const first=sessions[0],op=first.snapshot().operations[0];await first.searchAndRead({query:'public'},{operationId:op.operationId});expect(first.snapshot().counters.successReads).toBe(1);expect(d.provider.read).toHaveBeenCalledTimes(1);expect(d.open('unused').snapshot().counters).toEqual({successReads:0,failures:0});
  const cached=(d.service as any).cache;expect(JSON.stringify([...cached.values()].map((m:any)=>[...m.values()]))).not.toContain('checkpoint');d.service.releaseOwner('turn','t');await operation(d.open('world','new-turn'),{kind:'read',url:'https://example.test/public'});expect(d.provider.read).toHaveBeenCalledTimes(2);
});
it('a new operation with the same query advances to unread candidates instead of being mistaken for replay',async()=>{
  const d=create(),s=d.open();d.provider.search.mockResolvedValue([{url:'https://example.test/a',title:''},{url:'https://example.test/b',title:''}]);await operation(s,{kind:'search',request:{query:'same'}});await operation(s,{kind:'search',request:{query:'same'}});expect(s.snapshot().counters.successReads).toBe(2);expect(d.provider.read).toHaveBeenCalledTimes(2);expect(s.snapshot().operations[0].operationId).not.toBe(s.snapshot().operations[1].operationId);
});
it('serializes concurrent operations so the last remaining success is read only once',async()=>{
  const d=create(),s=d.open();counts(d.storage,s.id,19,3);const results=await Promise.all([operation(s,{kind:'read',url:'https://example.test/a'}),operation(s,{kind:'read',url:'https://example.test/b'})]);expect(results.map(r=>r.stopReason)).toEqual(['quota','quota']);expect(d.provider.read).toHaveBeenCalledTimes(1);expect(s.snapshot().counters).toEqual({successReads:20,failures:3});
});
it('replaying an old result reports current counters without resetting later confirmed reads',async()=>{
  const d=create(),s=d.open();await operation(s,{kind:'read',url:'https://example.test/a'});const first=s.snapshot().operations[0];await operation(s,{kind:'read',url:'https://example.test/b'});const replay=await s.readPage('https://example.test/a',{operationId:first.operationId});expect(replay.counters.successReads).toBe(2);expect(d.provider.read).toHaveBeenCalledTimes(2);
});
it('an exhausted search with only already-read candidates counts one no-material failure rather than spinning for free',async()=>{
  const d=create(),s=d.open();await operation(s,{kind:'search',request:{query:'same'}});const exhausted=await operation(s,{kind:'search',request:{query:'same'}});expect(exhausted.stopReason).toBe('no_candidates');expect(exhausted.counters).toEqual({successReads:1,failures:1});expect(exhausted.failures![0].reason).toBe('no_candidates');expect(d.provider.read).toHaveBeenCalledTimes(1);
});
