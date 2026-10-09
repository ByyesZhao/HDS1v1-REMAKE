import {createRequire} from 'node:module';
import type {Page} from 'puppeteer-core';
import type {BrowserPort,BrowserPageResult,BrowserReadRequest} from './types';
import {extractDomEvidence} from './extract';
import {normalizePublicUrl} from './url';
const requireLocal=createRequire(__filename);
export function createKoishiBrowserPort(pageFactory:()=>Promise<Page>):BrowserPort {
 return {async openPage(){
  const page=await pageFactory();
  const popups=new Map<Page,Promise<void>>();let closing:Promise<void>|undefined;
  const gone=(p:Page)=>p.isClosed()||!p.browser().connected;
  const closePage=async(p:Page)=>{try{await p.close();}catch(error){if(!gone(p))throw error;}};
  page.on('popup',popup=>{if(!popup)return;const drain=closePage(popup);popups.set(popup,drain);void drain.catch(()=>{});});
  return {async read(request:BrowserReadRequest,{signal,deadlineAt}):Promise<BrowserPageResult>{
   signal.throwIfAborted();
   const remaining=()=>{signal.throwIfAborted();const ms=deadlineAt-performance.now();if(ms<=0)throw Error('browser operation deadline exceeded');return Math.max(1,ms);};
   await page.setRequestInterception(true);
   page.on('request',r=>{const allowed=normalizePublicUrl(r.url())&&['document','stylesheet','script','xhr','fetch','image'].includes(r.resourceType());void (allowed?r.continue():r.abort('blockedbyclient')).catch(()=>{});});
   const response=await page.goto(request.url,{waitUntil:'domcontentloaded',timeout:remaining()});remaining();
   if(!normalizePublicUrl(page.url()))throw Error('page redirected to non-public URL');
   if(response&&response.status()>=400)return {finalUrl:page.url(),title:await page.title(),access:'http_error',search:null,main:null};
   // Readability is reinjected only after document replacement, inside the same deadline.
   // DOM polling consumes the original deadline; no second navigation or new timeout budget.
   while(true){
    try{
    if(!normalizePublicUrl(page.url()))throw Error('page redirected to non-public URL');
    const injected=await page.evaluate(()=>typeof (globalThis as any).Readability==='function');if(!injected)await page.addScriptTag({path:requireLocal.resolve('@mozilla/readability/Readability.js')});remaining();
    const result=await page.evaluate((source,url,engine)=>{(globalThis as any).__name=(fn:unknown)=>fn;const extract=(0,eval)('('+source+')');return extract(document,url,engine);},extractDomEvidence.toString(),page.url(),request.kind==='search'?request.engine:null) as BrowserPageResult;
    if(result.access!=='ok'||request.kind==='search'&&result.search?.state!=='unready'||request.kind==='article'&&(result.search!==null||result.main!==null))return result;
    }catch(error){if(!/Execution context was destroyed|Cannot find context with specified id/.test(String(error)))throw error;}
    const wait=Math.min(100,remaining());await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},wait);const abort=()=>{clearTimeout(timer);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});});remaining();
   }
  },close:()=>closing??=(async()=>{
   let failure:unknown;try{await closePage(page);}catch(error){failure=error;}
   const settled=await Promise.allSettled([...popups.values()]);
   for(const result of settled)if(result.status==='rejected')failure??=result.reason;
   if(failure&&!([page,...popups.keys()].every(gone)))throw failure;
  })(),isClosed:()=>[page,...popups.keys()].every(gone)};
 }};
}
