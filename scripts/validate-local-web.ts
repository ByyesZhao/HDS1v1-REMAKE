import {createRequire} from 'node:module';import {resolve,dirname} from 'node:path';import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {createManagedBrowserProvider} from '../src/web/browser/provider';import {createKoishiBrowserPort} from '../src/web/browser/koishi-port';import {extractDomEvidence} from '../src/web/browser/extract';import type {BrowserEngine,BrowserPort} from '../src/web/browser/types';
const localRequire=createRequire(resolve('package.json'));
export async function validateLocalWeb(options:{online?:boolean;probe?:boolean;engine?:BrowserEngine;report?:string}={}):Promise<any>{
 const engine=options.engine??'bing',started=performance.now();let ctx:any,managed:any;const report:any={mode:options.online?'public-browser':'offline',probe:options.probe??false,engine,query:'中国气象局',realNetworkRequests:0,passed:false,drained:false,versions:{puppeteerPlugin:localRequire('koishi-plugin-puppeteer/package.json').version,readability:localRequire('@mozilla/readability/package.json').version}};
 const save=()=>{if(options.report){mkdirSync(dirname(resolve(options.report)),{recursive:true});writeFileSync(resolve(options.report),JSON.stringify(report,null,2));}};
 try {
  let port:BrowserPort;
  if(options.online){
   const {Context}=localRequire('koishi'),runtimeRequire=createRequire(resolve('runtime/package.json'));
   ctx=new Context();ctx.plugin(runtimeRequire('@koishijs/plugin-http').default);
   const ready=new Promise<BrowserPort>(r=>ctx.inject(['puppeteer'],(inner:any)=>{r(createKoishiBrowserPort(()=>inner.puppeteer.page()));}));
   ctx.plugin(localRequire('koishi-plugin-puppeteer').default,{headless:true});
   await ctx.start();port=await ready;const originalPort=port;report.pages=[];port={async openPage(){const page=await originalPort.openPage();return {...page,async read(request,opts){const result=await page.read(request,opts);report.pages.push({kind:request.kind,finalUrl:result.finalUrl,access:result.access,searchState:result.search?.state,mainSource:result.main?.source,bodyCharacters:result.main?.text.length??0});return result;}};}};report.browserVersion=await ctx.puppeteer.browser.version();report.realNetworkRequests=null;
  }else{
   const {parseHTML}=localRequire('linkedom');
   port={async openPage(){return {async read(request){const html=request.kind==='search'?(engine==='bing'?'<ol id="b_results"><li class="b_algo"><h2><a href="https://example.org/article">Public fixture</a></h2></li></ol>':'<div class="results"><a class="result__a" href="https://example.org/article">Public fixture</a></div>'):'<article><h1>Public synthetic article</h1><p>Full fixture body. END_OF_FULL_ARTICLE</p></article>';return extractDomEvidence(parseHTML(html).document,request.url,request.kind==='search'?engine:null);},async close(){}};}};
  }
  managed=createManagedBrowserProvider(port,{engine,navigationTimeoutMs:60000,maxConcurrentPages:1});
  const searchStart=performance.now(),links=await managed.provider.search(report.query);report.searchMs=performance.now()-searchStart;report.candidateCount=links.length;report.candidates=links;
  if(!links.length)throw Error('no public candidates');
  const candidate=links.find((l:{url:string})=>l.url.includes('baike.baidu.com/item/'))??links.find((l:{url:string})=>new URL(l.url).pathname!=='/')??links[0];
  report.selectedUrl=candidate.url;const bodyStart=performance.now(),article=await managed.provider.read(candidate.url);report.readMs=performance.now()-bodyStart;
  report.bodyCharacters=[...article.body].length;report.articleTitle=article.title;report.bodyHash=createHash('sha256').update(article.body).digest('hex');report.bodyPreview=article.body.slice(0,300);report.bodyTail=article.body.slice(-300);if(!article.body.trim())throw Error('no target body');
  report.passed=true;
 }catch(error){report.error=error instanceof Error?error.message:String(error);report.passed=false;}
 finally{try{await managed?.dispose();report.drained=true;}catch(error){report.drainError=String(error);report.passed=false;}try{if(ctx?.canvas)await ctx.canvas.ctx.scope.dispose();await ctx?.stop();}catch(error){report.stopError=String(error);report.passed=false;}report.durationMs=performance.now()-started;save();}
 return report;
}
if(process.argv[1]?.includes('validate-local-web')){const args=process.argv.slice(2),get=(k:string)=>args.includes(k)?args[args.indexOf(k)+1]:undefined;const report=get('--report');if(!report)throw Error('--report required');const engine=get('--engine')??'bing';if(!['bing','duckduckgo'].includes(engine))throw Error('invalid engine');validateLocalWeb({online:args.includes('--online'),probe:args.includes('--probe'),engine:engine as BrowserEngine,report}).then(result=>{console.log(JSON.stringify({passed:result.passed,engine,error:result.error,candidates:result.candidateCount,bodyCharacters:result.bodyCharacters,drained:result.drained}));if(!result.passed)process.exitCode=1;}).catch(e=>{console.error(e);process.exitCode=1;});}
