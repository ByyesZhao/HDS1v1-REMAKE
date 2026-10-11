import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Storage} from '../src/storage';
import {systemClock} from '../src/time';
import type {StorySettings} from '../src/settings';

const localRequire=createRequire(resolve('package.json')),koishiPath=localRequire.resolve('koishi'),pluginPath=localRequire.resolve('koishi-plugin-puppeteer');
const originalKoishi=localRequire('koishi'),originalPlugin=localRequire(pluginPath),{Context,Service}=originalKoishi;
const settings=(enabled=true,provider='browser')=>({webSearch:{enabled,provider,maxSuccessReads:20,maxFailures:40,browser:{engine:'bing',navigationTimeoutMs:100,maxConcurrentPages:1}}} as StorySettings);
async function factory(){return (await import('../src/deployment/sticker-web-runtime.js')).createStickerWebRuntime;}

it.each(['reject','never','hanging','ready'])('import browser %s settles and closes isolated context',async mode=>{
 const storage=new Storage(':memory:');let ctx:any,disposed=0,pages=0;
 class ObservedContext extends Context{constructor(...args:any[]){super(...args);ctx=this;this.on('dispose',()=>{disposed++;});}}
 class Browser extends Service{static [Service.provide]='puppeteer';constructor(c:any){super(c,'puppeteer');}async start(){if(mode==='reject')throw Error('SYNTHETIC_BROWSER_START_FAILURE');if(mode==='hanging')await new Promise(()=>{});}async page(){pages++;throw Error('no pages during startup');}}
 localRequire.cache[koishiPath]!.exports={...originalKoishi,Context:ObservedContext};localRequire.cache[pluginPath]!.exports={default:mode==='never'?function noBrowser(){}:Browser};
 try{
  const create=await factory();const started=performance.now();
  if(mode==='ready'){const runtime=await create(storage,settings(),systemClock,{startupTimeoutMs:100});expect(runtime.web.config).toMatchObject({enabled:true,maxSuccessReads:20,maxFailures:40});await Promise.all([runtime.dispose(),runtime.dispose()]);}
  else await expect(create(storage,settings(),systemClock,{startupTimeoutMs:100})).rejects.toThrow(mode==='reject'?'SYNTHETIC_BROWSER_START_FAILURE':'browser startup timeout after 100ms');
  expect(performance.now()-started).toBeLessThan(1500);expect(disposed).toBe(1);expect(pages).toBe(0);
 }finally{await ctx?.stop();localRequire.cache[koishiPath]!.exports=originalKoishi;localRequire.cache[pluginPath]!.exports=originalPlugin;storage.close();}
});
it('unconfigured enabled import keeps explicit configuration failure',async()=>{
 const storage=new Storage(':memory:');try{const create=await factory();await expect(create(storage,settings(true,'unconfigured'),systemClock)).rejects.toThrow('web search enabled but provider not configured');}finally{storage.close();}
});
it('disabled import does not construct a Context or browser service',async()=>{
 const storage=new Storage(':memory:');let contexts=0;class ForbiddenContext extends Context{constructor(...args:any[]){super(...args);contexts++;throw Error('browser forbidden');}}
 localRequire.cache[koishiPath]!.exports={...originalKoishi,Context:ForbiddenContext};
 try{const create=await factory();const runtime=await create(storage,settings(false),systemClock);await runtime.dispose();await runtime.dispose();expect(contexts).toBe(0);expect(runtime.web.config.enabled).toBe(false);}finally{localRequire.cache[koishiPath]!.exports=originalKoishi;storage.close();}
});

it.each([false,true])('cleanup failure still stops Context and retains startup error (%s)',async failStart=>{
 const storage=new Storage(':memory:');let stops=0,canvasCloses=0,ctx:any;
 const startupError=Error('ORIGINAL_START_FAILURE');
 class ObservedContext extends Context{constructor(...args:any[]){super(...args);ctx=this;this.on('dispose',()=>{stops++;});}}
 class Canvas extends Service{static [Service.provide]='canvas';constructor(c:any){super(c,'canvas');}async stop(){canvasCloses++;throw Error('SYNTHETIC_CANVAS_CLOSE_FAILURE');}}
 class Browser extends Service{static [Service.provide]='puppeteer';constructor(c:any){super(c,'puppeteer');c.plugin(Canvas);}async start(){if(failStart)throw startupError;}}
 localRequire.cache[koishiPath]!.exports={...originalKoishi,Context:ObservedContext};localRequire.cache[pluginPath]!.exports={default:Browser};
 try{
  const create=await factory();
  if(failStart){const error=await create(storage,settings(),systemClock,{startupTimeoutMs:100}).catch(error=>error);expect(error.message).toContain('ORIGINAL_START_FAILURE');expect(error.message).toContain('SYNTHETIC_CANVAS_CLOSE_FAILURE');expect(error.cause).toBe(startupError);}
  else{const runtime=await create(storage,settings(),systemClock,{startupTimeoutMs:100});await expect(runtime.dispose()).rejects.toThrow('SYNTHETIC_CANVAS_CLOSE_FAILURE');await expect(runtime.dispose()).rejects.toThrow('SYNTHETIC_CANVAS_CLOSE_FAILURE');}
  expect(stops).toBe(1);expect(canvasCloses).toBe(1);
 }finally{await ctx?.stop();localRequire.cache[koishiPath]!.exports=originalKoishi;localRequire.cache[pluginPath]!.exports=originalPlugin;storage.close();}
});

it.each(['hanging','reject'])('startup budget and errors cover ready Puppeteer with %s injected canvas start',async mode=>{
 const storage=new Storage(':memory:');let ctx:any,canvasStarting!:()=>void;
 const canvasStarted=new Promise<void>(resolve=>{canvasStarting=resolve;});
 class Canvas extends Service{static [Service.provide]='canvas';static inject=['puppeteer'];constructor(c:any){super(c,'canvas');}async start(){canvasStarting();if(mode==='reject'){await new Promise(resolve=>setImmediate(resolve));throw Error('SUBORDINATE_START_FAILURE');}await new Promise(()=>{});}}
 class Browser extends Service{static [Service.provide]='puppeteer';constructor(c:any){super(c,'puppeteer');c.plugin(Canvas);}}
 class ObservedContext extends Context{constructor(...args:any[]){super(...args);ctx=this;}}
 localRequire.cache[koishiPath]!.exports={...originalKoishi,Context:ObservedContext};localRequire.cache[pluginPath]!.exports={default:Browser};
 try{const create=await factory();const pending=create(storage,settings(),systemClock,{startupTimeoutMs:40});await canvasStarted;await expect(pending).rejects.toThrow(mode==='reject'?'SUBORDINATE_START_FAILURE':'browser startup timeout after 40ms');}
 finally{await ctx?.stop();localRequire.cache[koishiPath]!.exports=originalKoishi;localRequire.cache[pluginPath]!.exports=originalPlugin;storage.close();}
},1000);

it.each(['puppeteer','canvas'])('disposal awaits real asynchronous %s stop and propagates failure',async service=>{
 const storage=new Storage(':memory:');let ctx:any,releaseStop!:()=>void,stopEntered!:()=>void,stops=0;
 const stopGate=new Promise<void>(resolve=>{releaseStop=resolve;}),entered=new Promise<void>(resolve=>{stopEntered=resolve;});
 const stop=async()=>{stops++;stopEntered();await stopGate;storage.prepare('SELECT 1').get();throw Error('REAL_SERVICE_CLOSE_FAILURE');};
 class Canvas extends Service{static [Service.provide]='canvas';static inject=['puppeteer'];constructor(c:any){super(c,'canvas');}async stop(){await stop();}}
 class Browser extends Service{static [Service.provide]='puppeteer';constructor(c:any){super(c,'puppeteer');if(service==='canvas')c.plugin(Canvas);}async stop(){if(service==='puppeteer')await stop();}}
 class ObservedContext extends Context{constructor(...args:any[]){super(...args);ctx=this;}}
 localRequire.cache[koishiPath]!.exports={...originalKoishi,Context:ObservedContext};localRequire.cache[pluginPath]!.exports={default:Browser};
 try{const create=await factory();const runtime=await create(storage,settings(),systemClock,{startupTimeoutMs:100});let settled=false;const pending=runtime.dispose().finally(()=>{settled=true;});void pending.catch(()=>{});await entered;await Promise.resolve();expect(settled).toBe(false);releaseStop();await expect(pending).rejects.toThrow('REAL_SERVICE_CLOSE_FAILURE');await expect(runtime.dispose()).rejects.toThrow('REAL_SERVICE_CLOSE_FAILURE');expect(stops).toBe(1);}
 finally{releaseStop();await ctx?.stop();localRequire.cache[koishiPath]!.exports=originalKoishi;localRequire.cache[pluginPath]!.exports=originalPlugin;storage.close();}
});

it('timed out launch closes resources acquired when its start eventually settles',async()=>{
 const storage=new Storage(':memory:');let ctx:any,finishStart!:()=>void,lateClosed!:()=>void,open=false;
 const startGate=new Promise<void>(resolve=>{finishStart=resolve;}),closed=new Promise<void>(resolve=>{lateClosed=resolve;});
 class Browser extends Service{static [Service.provide]='puppeteer';constructor(c:any){super(c,'puppeteer');}async start(){await startGate;open=true;}async stop(){if(open){open=false;lateClosed();}}}
 class ObservedContext extends Context{constructor(...args:any[]){super(...args);ctx=this;}}
 localRequire.cache[koishiPath]!.exports={...originalKoishi,Context:ObservedContext};localRequire.cache[pluginPath]!.exports={default:Browser};
 try{const create=await factory();await expect(create(storage,settings(),systemClock,{startupTimeoutMs:40})).rejects.toThrow('browser startup timeout after 40ms');storage.close();finishStart();await closed;expect(open).toBe(false);}
 finally{finishStart();await ctx?.stop();localRequire.cache[koishiPath]!.exports=originalKoishi;localRequire.cache[pluginPath]!.exports=originalPlugin;}
},1000);

it('installed Puppeteer plugin closes actual canvas owner before browser despite traceable ctx rebinding',async()=>{
 const storage=new Storage(':memory:');let ctx:any,connected=true,pages=0;
 const events:string[]=[];
 const pluginRequire=createRequire(pluginPath),core=pluginRequire('puppeteer-core'),finderPath=pluginRequire.resolve('puppeteer-finder');pluginRequire(finderPath);
 const originalLaunch=core.default.launch,originalFinder=localRequire.cache[finderPath]!.exports,originalPluginModule=localRequire.cache[pluginPath];
 class ObservedContext extends Context{constructor(...args:any[]){super(...args);ctx=this;}}
 core.default.launch=async()=>({newPage:async()=>{pages++;return {goto:async()=>{},close:async()=>{events.push('canvas.close.started');await new Promise(resolve=>setImmediate(resolve));if(!connected)throw Error('SYNTHETIC_PROTOCOL_CONNECTION_CLOSED');events.push('canvas.closed');}};},close:async()=>{events.push('browser.closed');connected=false;}});
 localRequire.cache[finderPath]!.exports=()=>'/synthetic/chrome';delete localRequire.cache[pluginPath];localRequire(pluginPath);localRequire.cache[koishiPath]!.exports={...originalKoishi,Context:ObservedContext};
 try{
  const create=await factory();const runtime=await create(storage,settings(),systemClock,{startupTimeoutMs:100});
  expect(ctx.canvas.ctx.scope===ctx.scope).toBe(true);expect(pages).toBe(1);
  await Promise.all([runtime.dispose(),runtime.dispose()]);storage.close();events.push('storage.closed');
  expect(events).toEqual(['canvas.close.started','canvas.closed','browser.closed','storage.closed']);
 }finally{await ctx?.stop();core.default.launch=originalLaunch;localRequire.cache[finderPath]!.exports=originalFinder;localRequire.cache[pluginPath]=originalPluginModule;localRequire.cache[koishiPath]!.exports=originalKoishi;}
});
