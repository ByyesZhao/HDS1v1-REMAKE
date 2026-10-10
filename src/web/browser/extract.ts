import type {BrowserPageResult,BrowserEngine} from './types';
import {normalizePublicUrl} from './url';
export const BROWSER_EXTRACTOR_VERSION='dom-v2/readability-0.6.0';
/** Self-contained function: the identical DOM algorithm runs in the browser and fixture tests. */
export function extractDomEvidence(document:Document,finalUrl:string,engine:BrowserEngine|null=null,ReadabilityCtor?:new(doc:Document)=>{parse():{textContent:string;title:string}|null}):BrowserPageResult{
 const result:BrowserPageResult={finalUrl,title:document.title??'',access:'ok',search:null,main:null};
 const select=(selector:string)=>document.querySelector(selector);
 // Measure connected original nodes before cloning/removing styles. CSS visibility
 // is inherited but can be overridden; display:none and hidden ancestors cannot.
 const nodes=Array.from(document.querySelectorAll('*'));
 const states=new Map<Element,{blocked:boolean;visibility:string;visible:boolean}>();
 for(const node of nodes){const parent=node.parentElement?states.get(node.parentElement):undefined;
  const computed=document.defaultView?.getComputedStyle?.(node),inline=node.getAttribute('style')??'';
  const display=computed?.display??(/display\s*:\s*none/i.test(inline)?'none':'');
  const visibility=computed?.visibility??(/visibility\s*:\s*(hidden|collapse)/i.exec(inline)?.[1]??(/visibility\s*:\s*visible/i.test(inline)?'visible':parent?.visibility??'visible'));
  const blocked=!!parent?.blocked||node.hasAttribute('hidden')||node.getAttribute('aria-hidden')==='true'||display==='none';
  states.set(node,{blocked,visibility,visible:!blocked&&!['hidden','collapse'].includes(visibility)});
 }
 const visible=(node:Element)=>states.get(node)?.visible??false;
 const wall=Array.from(document.querySelectorAll('form#challenge-form,form#captcha-form,#b_captcha,iframe[src*="recaptcha"],iframe[src*="hcaptcha"],form[action*="captcha"]')).find(visible);
 if(wall&&visible(wall)){result.access='captcha';return result;}
 const password=select('form input[type="password"]');if(password&&visible(password)&&!select('article,main,[role="main"]')){result.access='login_wall';return result;}
 let detected=engine;
 if(!detected){try{const url=new URL(finalUrl);if(/(^|\.)bing\.com$/.test(url.hostname)&&url.pathname==='/search')detected='bing';else if(/(^|\.)duckduckgo\.com$/.test(url.hostname)&&url.searchParams.has('q'))detected='duckduckgo';}catch{}}
 if(detected){
  const selectors=detected==='bing'?'#b_results .b_algo h2 a':'a.result__a,[data-testid="result"] a[data-testid="result-title-a"]';
  const links=Array.from(document.querySelectorAll(selectors)).filter(visible).map(a=>({url:a.getAttribute('href')??'',title:(a.textContent??'').trim()})).filter(a=>!!a.url&&!!a.title);
  const empty=Array.from(document.querySelectorAll(detected==='bing'?'#b_results .b_no':'#links .no-results,.results .no-results,.no-results')).find(visible);
  result.search={state:links.length?'results':empty&&visible(empty)?'empty':'unready',links,evidence:links.length?selectors:empty&&visible(empty)?'engine empty-result element':null};return result;
 }
 const clone=document.cloneNode(true) as Document;
 const copies=Array.from(clone.querySelectorAll('*'));
 for(let i=0;i<nodes.length;i++){const state=states.get(nodes[i])!,copy=copies[i];
  if(state.blocked)copy.remove();
  else if(!state.visible){for(const child of Array.from(copy.childNodes))if(child.nodeType===3)child.remove();copy.replaceWith(...Array.from(copy.childNodes));}
 }
 for(const e of Array.from(clone.querySelectorAll('script,style,noscript,template,nav,header,footer,aside,form,button,[aria-busy="true"],[role="navigation"],[role="status"],[role="progressbar"],[role="contentinfo"],[class*="footer"],[id*="footer"],[class*="copyright"],[id*="copyright"],[hidden],[aria-hidden="true"]')))e.remove();
 const text=(e:Element)=>((e as HTMLElement).innerText??e.textContent??'').trim();
 // Evidence excludes links/headings/status shells; it does not shorten accepted body text.
 const hasBodyEvidence=(e:Element)=>{const body=e.cloneNode(true) as Element;for(const node of Array.from(body.querySelectorAll('a,[role="link"],h1,h2,h3,h4,h5,h6')))node.remove();return !!text(body);};
 for(const [selector,source] of [['article','article'],['main,[role="main"]','main']] as const){const nodes=Array.from(clone.querySelectorAll(selector));const contents=nodes.filter(hasBodyEvidence).map(text).filter(Boolean);if(contents.length){result.main={text:contents.join('\n\n'),source};return result;}}
 const Ctor=ReadabilityCtor??(globalThis as unknown as {Readability?:typeof ReadabilityCtor}).Readability;
 if(Ctor&&clone.documentElement&&hasBodyEvidence(clone.documentElement)){try{const readable=new Ctor(clone).parse();if(readable?.textContent?.trim())result.main={text:readable.textContent.trim(),source:'readability'};}catch{}}
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
