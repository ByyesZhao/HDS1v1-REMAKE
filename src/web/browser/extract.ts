import type {BrowserPageResult,BrowserEngine} from './types';
import {normalizePublicUrl} from './url';
export const BROWSER_EXTRACTOR_VERSION='dom-v1/readability-0.6.0';
/** Self-contained function: the identical DOM algorithm runs in the browser and fixture tests. */
export function extractDomEvidence(document:Document,finalUrl:string,engine:BrowserEngine|null=null,ReadabilityCtor?:new(doc:Document)=>{parse():{textContent:string;title:string}|null}):BrowserPageResult{
 const result:BrowserPageResult={finalUrl,title:document.title??'',access:'ok',search:null,main:null};
 const select=(selector:string)=>document.querySelector(selector);
 const visible=(node:Element)=>!node.closest('[hidden],[aria-hidden="true"]')&&!/display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style')??'');
 const wall=select('form#challenge-form,form#captcha-form,#b_captcha,iframe[src*="recaptcha"],iframe[src*="hcaptcha"],form[action*="captcha"]');
 if(wall&&visible(wall)){result.access='captcha';return result;}
 const password=select('form input[type="password"]');if(password&&visible(password)&&!select('article,main,[role="main"]')){result.access='login_wall';return result;}
 let detected=engine;
 if(!detected){try{const url=new URL(finalUrl);if(/(^|\.)bing\.com$/.test(url.hostname)&&url.pathname==='/search')detected='bing';else if(/(^|\.)duckduckgo\.com$/.test(url.hostname)&&url.searchParams.has('q'))detected='duckduckgo';}catch{}}
 if(detected){
  const selectors=detected==='bing'?'#b_results .b_algo h2 a':'a.result__a,[data-testid="result"] a[data-testid="result-title-a"]';
  const links=Array.from(document.querySelectorAll(selectors)).filter(visible).map(a=>({url:a.getAttribute('href')??'',title:(a.textContent??'').trim()})).filter(a=>!!a.url&&!!a.title);
  const empty=select(detected==='bing'?'#b_results .b_no':'#links .no-results,.results .no-results,.no-results');
  result.search={state:links.length?'results':empty&&visible(empty)?'empty':'unready',links,evidence:links.length?selectors:empty&&visible(empty)?'engine empty-result element':null};return result;
 }
 const clone=document.cloneNode(true) as Document;
 for(const e of Array.from(clone.querySelectorAll('script,style,noscript,template,nav,header,footer,aside,form,button,[aria-busy="true"],[role="contentinfo"],[class*="footer"],[id*="footer"],[class*="copyright"],[id*="copyright"],[hidden],[aria-hidden="true"]')))e.remove();
 for(const e of Array.from(clone.querySelectorAll('[style]')))if(!visible(e))e.remove();
 const text=(e:Element)=>((e as HTMLElement).innerText??e.textContent??'').trim();
 for(const [selector,source] of [['article','article'],['main,[role="main"]','main']] as const){const nodes=Array.from(clone.querySelectorAll(selector));const contents=nodes.map(text).filter(Boolean);if(contents.length){result.main={text:contents.join('\n\n'),source};return result;}}
 const Ctor=ReadabilityCtor??(globalThis as unknown as {Readability?:typeof ReadabilityCtor}).Readability;
 if(Ctor){try{const readable=new Ctor(clone).parse();if(readable?.textContent?.trim())result.main={text:readable.textContent.trim(),source:'readability'};}catch{}}
 return result;
}
function candidateUrl(value:string,base:string):string|null{
 try{const url=new URL(value,base);
 if(/(^|\.)bing\.com$/.test(url.hostname)&&url.pathname==='/ck/a'){const u=url.searchParams.get('u');if(!u?.startsWith('a1'))return null;value=Buffer.from(u.slice(2),'base64url').toString('utf8');}
 else if(/(^|\.)duckduckgo\.com$/.test(url.hostname)&&url.pathname==='/l/'){value=url.searchParams.get('uddg')??'';}else value=url.toString();
 const normalized=normalizePublicUrl(value);if(!normalized)return null;const target=new URL(normalized);if((/(^|\.)bing\.com$/.test(target.hostname)&&['/search','/ck/a'].includes(target.pathname))||(/(^|\.)duckduckgo\.com$/.test(target.hostname)&&target.searchParams.has('q')))return null;return normalized;
 }catch{return null;}
}
export function extractSearchCandidates(page:BrowserPageResult,_engine:BrowserEngine){
 if(page.access!=='ok')throw Error('search page blocked: '+page.access);if(!page.search||page.search.state==='unready')throw Error('search page extraction unready');
 if(page.search.state==='empty')return [];const seen=new Set<string>(),links:Array<{url:string;title:string}>=[];
 for(const link of page.search.links){const url=candidateUrl(link.url,page.finalUrl);if(url&&!seen.has(url)){seen.add(url);links.push({url,title:link.title});}}
 if(!links.length)throw Error('search candidate extraction produced no usable public links');return links;
}
export function extractReadablePage(page:BrowserPageResult){
 if(page.access!=='ok')throw Error('web page blocked: '+page.access);
 if(page.search)throw Error('search results are not article body');
 if(!page.main?.text.trim())throw Error('page has no readable body');
 return {title:page.title,body:page.main.text};
}
