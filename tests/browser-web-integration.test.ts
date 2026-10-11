import {it,expect} from 'vitest';import {Storage} from '../src/storage';import {WebSearchStore} from '../src/web/store';import {WebSearchService} from '../src/web/service';import {TestClock} from './helpers';import {createManagedBrowserProvider} from '../src/web/browser/provider';
import {createRequire} from 'node:module';import {resolve} from 'node:path';import {extractDomEvidence} from '../src/web/browser/extract';import {ModelClient} from '../src/model/client';import type {ModelTask} from '../src/types';
const {parseHTML}=createRequire(resolve('package.json'))('linkedom') as {parseHTML:(html:string)=>{document:Document}};
it('browser_plain_text_survives_service_normalization',async()=>{
 const expected='关系：a < b && c > d。 List<String> <nav>示例</nav> &lt;';
 const html='<html><body><nav>REAL_NAV_SENTINEL</nav><article>关系：a &lt; b &amp;&amp; c &gt; d。 List&lt;String&gt; &lt;nav&gt;示例&lt;/nav&gt; &amp;lt;</article></body></html>';
 const browser=createManagedBrowserProvider({openPage:async()=>({read:async r=>extractDomEvidence(parseHTML(html).document,r.url),close:async()=>{}})},{engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1}),db=new Storage(':memory:');
 try{
  const store=new WebSearchStore(db),web=new WebSearchService(store,browser.provider,new TestClock(),{enabled:true}),session=web.openSession(store.openStage('turn','plain-text','personal','personal_life'));
  const result=await operation(session,{kind:'read',url:'https://example.org/article'});
  expect(result.materials[0].body).toBe(expected);expect(result.materials[0].body).not.toContain('REAL_NAV_SENTINEL');expect(result.counters).toEqual({successReads:1,failures:0});
  const task:ModelTask<{answer:string}>={name:'personal_life',prompt:'fixture',schema:{type:'object',properties:{answer:{type:'string'}},required:['answer']},parse:v=>v as {answer:string}};let envelope:any;
  await new ModelClient({complete:async request=>{envelope=request;return {answer:'ok'};}}).runModel(task,{}, {web:session,lookup:null});
  expect(envelope.webMaterials[0].body).toBe(expected);
 }finally{await browser.dispose();db.close();}
});
async function operation(s:any,r:any){const operationId=s.beginOperation(r).operationId;return r.kind==='search'?s.searchAndRead(r.request,{operationId}):s.readPage(r.url,{operationId});}
it('existing phases keep independent counters and B cache reuse with browser provider',async()=>{
 const db=new Storage(':memory:');let reads=0;
 const browser=createManagedBrowserProvider({openPage:async()=>({read:async r=>{if(r.kind==='article')reads++;return {finalUrl:r.url,title:'public',access:'ok',search:r.kind==='search'?{state:'results',links:[{url:'https://example.org/article',title:'candidate'}],evidence:'fixture'}:null,main:r.kind==='article'?{text:'Full target body',source:'article'}:null};},close:async()=>{}})},{engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1});
 try{const store=new WebSearchStore(db),web=new WebSearchService(store,browser.provider,new TestClock(),{enabled:true});
 const a=web.openSession(store.openStage('turn','t','world','world')),b=web.openSession(store.openStage('turn','t','personal','personal_life'));
 await operation(a,{kind:'search',request:{query:'q',requestedPages:1}});await operation(b,{kind:'search',request:{query:'q',requestedPages:1}});await operation(a,{kind:'read',url:'https://example.org/article'});
 expect(a.snapshot().counters.successReads).toBe(1);expect(b.snapshot().counters.successReads).toBe(1);expect(reads).toBe(1);
 }finally{await browser.dispose();db.close();}
});
it('actual engine empty is one no_candidates failure and 20/40 limits stay separate',async()=>{
 const db=new Storage(':memory:');let fail=false;const browser=createManagedBrowserProvider({openPage:async()=>({read:async r=>{if(fail)throw Error('fixture blocked');return {finalUrl:r.url,title:'p',access:'ok',search:r.kind==='search'?{state:'empty',links:[],evidence:'fixture empty element'}:null,main:{text:'body',source:'article'}};},close:async()=>{}})},{engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1});
 try{const store=new WebSearchStore(db),web=new WebSearchService(store,browser.provider,new TestClock(),{enabled:true});const empty=web.openSession(store.openStage('turn','t','empty','memory'));const result=await operation(empty,{kind:'search',request:{query:'q',requestedPages:1}});expect(result.stopReason).toBe('no_candidates');expect(empty.snapshot().counters).toEqual({successReads:0,failures:1});
 const good=web.openSession(store.openStage('turn','t','good','personal_life'));for(let i=0;i<25;i++)await operation(good,{kind:'read',url:'https://example.org/p'+i});expect(good.snapshot().counters).toEqual({successReads:20,failures:0});
 fail=true;const bad=web.openSession(store.openStage('turn','t','bad','world'));for(let i=0;i<45;i++)await operation(bad,{kind:'read',url:'https://example.org/f'+i});expect(bad.snapshot().counters).toEqual({successReads:0,failures:40});
 }finally{await browser.dispose();db.close();}
});
