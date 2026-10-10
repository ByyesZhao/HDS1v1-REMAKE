import {it,expect} from 'vitest';import {createRequire} from 'node:module';import {resolve} from 'node:path';import {Readability} from '@mozilla/readability';
import {extractDomEvidence,extractReadablePage} from '../src/web/browser/extract';import {createKoishiBrowserPort} from '../src/web/browser/koishi-port';import {createManagedBrowserProvider} from '../src/web/browser/provider';
const {parseHTML}=createRequire(resolve('package.json'))('linkedom');const url='https://example.org/article';const extract=(html:string)=>extractDomEvidence(parseHTML(html).document,url,null,Readability as any);const tick=()=>new Promise(r=>setImmediate(r));
function fakePage(html:()=>string,onGoto?:()=>void){const events:Record<string,Function>={};let closed=false;return {events,page:{on(name:string,fn:Function){events[name]=fn;},setRequestInterception:async()=>{},goto:async()=>{onGoto?.();return {status:()=>200};},url:()=>url,evaluate:async(_fn:any,...args:any[])=>args.length?extract(html()):true,addScriptTag:async()=>{},close:async()=>{closed=true;},isClosed:()=>closed,browser:()=>({connected:true})}};}
it('navigation links, heading-only menus and structural loading status never establish article readiness',()=>{
 for(const html of ['<main><a href="/">Home</a><a href="/news">News</a></main>','<main><div role="status">Loading article...</div></main>','<main><h1>News</h1><a href="/">Home</a></main>']){
  expect(extract(html).main).toBeNull();expect(()=>extractReadablePage(extract(html))).toThrow();
 }
 expect(extractReadablePage(extract('<main><p>短正文。</p></main>')).body).toBe('短正文。');expect(extractReadablePage(extract('<article>一条短讯。</article>')).body).toBe('一条短讯。');
});
it('port keeps polling initial loading shell until actual body using one original deadline',async()=>{
 let polls=0;const f=fakePage(()=>++polls===1?'<main><div role="status">Loading article...</div></main>':'<main><p>Actual dynamic body.</p></main>');
 const p=await createKoishiBrowserPort(async()=>f.page as any).openPage();
 expect((await p.read({kind:'article',url},{signal:new AbortController().signal,deadlineAt:performance.now()+1000})).main?.text).toBe('Actual dynamic body.');expect(polls).toBe(2);await p.close();
});
it('dispose cannot complete or release reservation before owned popup actually closes',async()=>{
 let release!:()=>void,closed=false;const gate=new Promise<void>(r=>release=r);let f:ReturnType<typeof fakePage>;
 const popup={close:async()=>{await gate;closed=true;},isClosed:()=>closed,browser:()=>({connected:true})};
 f=fakePage(()=>'<article>Actual body.</article>',()=>f.events.popup(popup));
 const managed=createManagedBrowserProvider(createKoishiBrowserPort(async()=>f.page as any),{engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1});
 const reading=managed.provider.read(url).catch(()=>{});await tick();let drained=false;const disposal=managed.dispose().then(()=>drained=true);
 await tick();expect(drained).toBe(false);expect(closed).toBe(false);release();await disposal;await reading;expect(closed).toBe(true);expect(drained).toBe(true);
});
it('unknown popup close failure is not swallowed as a successful parent drain',async()=>{
 let f:ReturnType<typeof fakePage>;const popup={close:async()=>{throw Error('popup close failed');},isClosed:()=>false,browser:()=>({connected:true})};
 f=fakePage(()=>'<article>Actual body.</article>',()=>f.events.popup(popup));
 const managed=createManagedBrowserProvider(createKoishiBrowserPort(async()=>f.page as any),{engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1});
 await expect(managed.provider.read(url)).rejects.toThrow('popup close failed');await expect(managed.dispose()).rejects.toThrow('popup close failed');
});

it.each(['main','div role="main"'])('main_wrapped_login_is_not_full_body: %s',tag=>{
 const close=tag.startsWith('div')?'div':tag;const p=extract('<'+tag+'><h1>Sign in</h1><p>Sign in to continue reading.</p><form><input type="password"><button>Sign in</button></form></'+close+'>');expect(p.access).toBe('login_wall');expect(p.main).toBeNull();expect(()=>extractReadablePage(p)).toThrow('login_wall');
});
it.each([
 '<article><p>Independent body.</p></article><aside><h1>Sign in</h1><form><input type="password"></form></aside>',
 '<main><article><p>Independent body.</p></article><div><h1>Sign in</h1><p>Login prompt.</p><form><input type="password"></form></div></main>',
 '<main><p>Independent body.</p><div role="dialog"><p>Login prompt.</p><form><input type="password"></form></div></main>',
 '<article><p>Independent body.</p></article><form hidden><input type="password"></form><main><p>Sign in to continue.</p><form><input type="password"></form></main>',
])('independent body survives adjacent login regions: %s',html=>{expect(extractReadablePage(extract(html)).body).toBe('Independent body.');});
