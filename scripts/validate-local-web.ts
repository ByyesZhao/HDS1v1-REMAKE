import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createManagedBrowserProvider} from '../src/web/browser/provider';
import {createKoishiBrowserPort} from '../src/web/browser/koishi-port';
import {extractDomEvidence,extractReadablePage} from '../src/web/browser/extract';
import {BrowserPageSlots} from '../src/web/browser/slots';
import type {BrowserEngine,BrowserPort} from '../src/web/browser/types';
const localRequire=createRequire(resolve('package.json'));
const browserConfig=(engine:BrowserEngine)=>({engine,navigationTimeoutMs:60000,maxConcurrentPages:1});
export async function validateLocalWeb(options:{online?:boolean;probe?:boolean;engine?:BrowserEngine;report?:string}={}):Promise<any>{
 const engine=options.engine??'bing',started=performance.now();let ctx:any,managed:any,owned=0,maxOwned=0,operations=0;
 const report:any={mode:options.online?'public-browser':'offline',probe:options.probe??false,engine,query:'中国气象局',realNetworkRequests:options.online?null:0,passed:false,drained:false,pages:[],versions:{puppeteerPlugin:localRequire('koishi-plugin-puppeteer/package.json').version,readability:localRequire('@mozilla/readability/package.json').version}};
 const save=()=>{if(options.report){mkdirSync(dirname(resolve(options.report)),{recursive:true});writeFileSync(resolve(options.report),JSON.stringify(report,null,2));}};
 function tracked(port:BrowserPort):BrowserPort{return {async openPage(){
  owned++;operations++;maxOwned=Math.max(maxOwned,owned);
  let page;try{page=await port.openPage();}catch(e){owned--;throw e;}
  return {...page,async read(request,opts){const result=await page.read(request,opts);report.pages.push({kind:request.kind,finalUrl:result.finalUrl,access:result.access,searchState:result.search?.state,mainSource:result.main?.source,bodyCharacters:result.main?.text.length??0});return result;},async close(){await page.close();owned--;}};
 }};}
 try{
  let port:BrowserPort;
  if(options.online){
   const {Context}=localRequire('koishi'),runtimeRequire=createRequire(resolve('runtime/package.json'));
   ctx=new Context();ctx.plugin(runtimeRequire('@koishijs/plugin-http').default);
   const ready=new Promise<BrowserPort>(r=>ctx.inject(['puppeteer'],(inner:any)=>r(createKoishiBrowserPort(()=>inner.puppeteer.page()))));
   ctx.plugin(localRequire('koishi-plugin-puppeteer').default,{headless:true});
   await ctx.start();port=await ready;report.browserVersion=await ctx.puppeteer.browser.version();
  }else{
   const {parseHTML}=localRequire('linkedom');
   port={async openPage(){return {async read(request){
    const html=request.kind==='search'?(engine==='bing'?'<ol id="b_results"><li class="b_algo"><h2><a href="https://example.org/article">Public fixture</a></h2></li></ol>':'<div class="results"><a class="result__a" href="https://example.org/article">Public fixture</a></div>'):'<article><h1>Public synthetic article</h1><p>Full fixture body. END_OF_FULL_ARTICLE</p></article>';
    return extractDomEvidence(parseHTML(html).document,request.url,request.kind==='search'?engine:null);
   },async close(){}};}};
  }
  managed=createManagedBrowserProvider(tracked(port),browserConfig(engine));
  const searchStart=performance.now(),links=await managed.provider.search(report.query);
  report.searchMs=performance.now()-searchStart;report.candidateCount=links.length;report.candidates=links;
  if(!links.length)throw Error('no public candidates');
  const candidate=links.find((l:{url:string})=>l.url.includes('baike.baidu.com/item/'))??links.find((l:{url:string})=>new URL(l.url).pathname!=='/')??links[0];
  report.selectedUrl=candidate.url;const bodyStart=performance.now(),article=await managed.provider.read(candidate.url);
  report.readMs=performance.now()-bodyStart;report.bodyCharacters=[...article.body].length;report.articleTitle=article.title;
  report.bodyHash=createHash('sha256').update(article.body).digest('hex');report.bodyPreview=article.body.slice(0,300);report.bodyTail=article.body.slice(-300);
  if(!article.body.trim())throw Error('no target body');
  if(!options.probe){
   const query='Mozilla Readability',englishStart=performance.now(),englishLinks=await managed.provider.search(query);
   if(!englishLinks.length)throw Error('no English candidates');
   const selected=englishLinks.find((l:{url:string})=>l.url.includes('github.com/mozilla/readability'))??englishLinks[0],body=await managed.provider.read(selected.url);
   report.english={query,candidateCount:englishLinks.length,selectedUrl:selected.url,bodyCharacters:[...body.body].length,title:body.title,durationMs:performance.now()-englishStart,bodyHash:createHash('sha256').update(body.body).digest('hex')};
   if(!body.body.trim())throw Error('no English body');
   if(options.online){
    // These fixtures render in the real owned test browser; they are not public website results.
    const synthetic=async(html:string,label:string)=>{
     const fixturePort=createKoishiBrowserPort(async()=>{
      const page=await ctx.puppeteer.page();
      return new Proxy(page,{get(target,property){if(property==='goto')return async()=>{await target.setContent(html,{waitUntil:'domcontentloaded'});return {status:()=>200};};if(property==='url')return ()=> 'https://synthetic.test/'+label;const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;}});
     });
     const slots=new BrowserPageSlots(tracked(fixturePort),browserConfig(engine));
     try{return await slots.read({kind:'article',url:'https://synthetic.test/'+label});}finally{await slots.dispose();}
    };
    const dynamic=await synthetic('<main aria-busy="true">Loading</main><script>setTimeout(()=>document.querySelector("main").outerHTML="<article>Dynamic final body END_DYNAMIC</article>",250)</script>','dynamic');
    const dynamicBody=extractReadablePage(dynamic);if(!dynamicBody.body.includes('END_DYNAMIC'))throw Error('dynamic full body missing');
    report.dynamic={mode:'synthetic-real-browser',passed:true,source:dynamic.main?.source,bodyCharacters:dynamicBody.body.length};
    const unreadable=await synthetic('<form><input type="password"/></form>','login');
    let rejected=false;try{extractReadablePage(unreadable);}catch{rejected=true;}
    if(!rejected)throw Error('login shell accepted');
    report.unreadable={mode:'synthetic-real-browser',access:unreadable.access,rejected};
   }else{
    const {parseHTML}=localRequire('linkedom'),dynamic=extractDomEvidence(parseHTML('<article>Dynamic fixture END_DYNAMIC</article>').document,'https://synthetic.test/dynamic');
    const body=extractReadablePage(dynamic);report.dynamic={mode:'static-dom-fixture; timed readiness has separate port regression',passed:body.body.includes('END_DYNAMIC'),source:dynamic.main?.source};
    const unreadable=extractDomEvidence(parseHTML('<form><input type="password"/></form>').document,'https://synthetic.test/login');let rejected=false;try{extractReadablePage(unreadable);}catch{rejected=true;}report.unreadable={mode:'dom-fixture',access:unreadable.access,rejected};
   }
  }
  report.passed=true;
 }catch(error){report.error=error instanceof Error?error.message:String(error);report.passed=false;}
 finally{
  try{await managed?.dispose();report.drained=owned===0;if(!report.drained)report.passed=false;}catch(error){report.drainError=String(error);report.passed=false;}
  try{if(ctx?.canvas)await ctx.canvas.ctx.scope.dispose();await ctx?.stop();}catch(error){report.stopError=String(error);report.passed=false;}
  report.ownedPageOperations=operations;report.maximumOwnedPages=maxOwned;report.remainingOwnedPages=owned;report.durationMs=performance.now()-started;save();
 }
 return report;
}
if(process.argv[1]?.includes('validate-local-web')){
 const args=process.argv.slice(2),get=(k:string)=>args.includes(k)?args[args.indexOf(k)+1]:undefined,report=get('--report');
 if(!report)throw Error('--report required');const engine=get('--engine')??'bing';if(!['bing','duckduckgo'].includes(engine))throw Error('invalid engine');
 validateLocalWeb({online:args.includes('--online'),probe:args.includes('--probe'),engine:engine as BrowserEngine,report}).then(result=>{console.log(JSON.stringify({passed:result.passed,engine,error:result.error,candidates:result.candidateCount,bodyCharacters:result.bodyCharacters,english:result.english,dynamic:result.dynamic,unreadable:result.unreadable,drained:result.drained}));if(!result.passed)process.exitCode=1;}).catch(error=>{console.error(error);process.exitCode=1;});
}
