import {it,expect,vi} from 'vitest';
import {request} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installBrowserRuntime,getBrowserRuntimeStatus} from '../src/deployment/browser-runtime';
import {startStopControl} from '../src/deployment/stop-control';

vi.mock('koishi',async()=>(await import('node:module')).createRequire(`${process.cwd()}/package.json`)('koishi'));
const tick=()=>new Promise<void>(r=>setImmediate(r));
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};};
// Real assembly, provider, page adapter and HTTP controller. Only external page/host
// work is synthetic. The close-position marker is not a formal database check.
async function fixture(options:{fail?:boolean;blockStart?:boolean;blockClose?:boolean}={}){
 const dir=await mkdtemp(join(tmpdir(),'hdsi-browser-r1-'));
 const startGate=gate(),closeGate=gate(),events=new Map<string,Array<()=>any>>();
 const errors:unknown[]=[],logs:string[]=[],exit=vi.fn(),closeOptions:unknown[]=[];
 let pageClosed=false,pageCloseCalls=0,actualCloses=0,storageCloseReached=false,started=false,drainSettled=false;
 const page={on(){},setRequestInterception:async()=>{},goto:async()=>({status:()=>500}),
  url:()=> 'https://synthetic.test/',title:async()=>'',isClosed:()=>pageClosed,browser:()=>({connected:true}),
  close:async()=>{pageCloseCalls++;if(options.fail)throw Error('synthetic page close failure');pageClosed=true;}};
 const ctx:any={baseDir:dir,puppeteer:{page:async()=>page},logger:()=>({error:(e:unknown)=>errors.push(e),info(){}}),
  command:()=>({action(){}}),on:(name:string,fn:()=>any)=>events.set(name,[...(events.get(name)??[]),fn]),
  inject:(_deps:unknown,fn:(c:any)=>void)=>fn(ctx)};
 installBrowserRuntime(ctx,{} as any,{webSearch:{browser:{engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1}}} as any,
  async(_ctx,_config,_settings,managed)=>{
   try{await managed!.provider.search('offline fixture');}catch{/* Leaves one live page in the real slot manager. */}
   let closing:Promise<void>|null=null;
   return {host:{start:async()=>{started=true;if(options.blockStart)await startGate.promise;},status:async()=>''},
    stopAcceptingInput(){},close:(o:unknown)=>{closeOptions.push(o);return closing??=(async()=>{
     actualCloses++;if(options.blockClose)await closeGate.promise;await managed!.dispose();storageCloseReached=true;
    })().finally(()=>{drainSettled=true;});}} as any;
  });
 const ready=events.get('ready')!.at(-1)!();
 await vi.waitFor(()=>expect(started).toBe(true));
 const file=join(dir,'control.json'),control=await startStopControl(file,events.get('exit')![0],{exit,log:m=>logs.push(m)});
 const descriptor=JSON.parse(await readFile(file,'utf8'));
 const headers={authorization:`Bearer ${descriptor.token}`},url=`http://127.0.0.1:${descriptor.port}/stop`;
 return {ctx,errors,logs,exit,closeOptions,startGate,closeGate,ready,descriptor,headers,
  stop:()=>fetch(url,{method:'POST',headers}),
  get drainSettled(){return drainSettled;},get pageCloseCalls(){return pageCloseCalls;},get actualCloses(){return actualCloses;},get storageCloseReached(){return storageCloseReached;},
  cleanup:async()=>{startGate.release();closeGate.release();await ready;await control.close();await rm(dir,{recursive:true,force:true});}};
}
function expectFailed(f:Awaited<ReturnType<typeof fixture>>){
 expect(getBrowserRuntimeStatus(f.ctx)).toMatchObject({state:'failed',error:'synthetic page close failure'});
 expect(f.pageCloseCalls).toBe(1);expect(f.actualCloses).toBe(1);expect(f.storageCloseReached).toBe(false);
 expect(f.exit).not.toHaveBeenCalled();expect(f.logs.some(s=>s.includes('HDSI停止完成'))).toBe(false);
 expect(f.errors.some(e=>String(e).includes('synthetic page close failure'))).toBe(true);
}
it('live page close failure reaches HTTP caller without success exit',async()=>{
 const f=await fixture({fail:true});try{const r=await f.stop();await tick();
  expect(getBrowserRuntimeStatus(f.ctx).error).toBe('synthetic page close failure');
  expect(r.status).toBe(500);expect(await r.json()).toMatchObject({stopped:false});expectFailed(f);
 }finally{await f.cleanup();}
});
it('drain rejection is observed immediately while lifecycle start remains queued',async()=>{
 const f=await fixture({fail:true,blockStart:true}),unhandled:unknown[]=[];
 const listener=(e:unknown)=>unhandled.push(e);process.on('unhandledRejection',listener);
 let response:Response|undefined;
 try{const pending=f.stop().then(r=>response=r);await vi.waitFor(()=>{expect(f.actualCloses).toBe(1);expect(f.drainSettled).toBe(true);});
  await tick();await tick();expect(unhandled).toEqual([]);expect(response).toBeUndefined();
  f.startGate.release();await pending;expect(response!.status).toBe(500);expect(await response!.json()).toMatchObject({stopped:false});expectFailed(f);
 }finally{process.off('unhandledRejection',listener);await f.cleanup();}
});
it('concurrent and later failed stop requests share actual close work and all fail',async()=>{
 const f=await fixture({fail:true,blockClose:true});try{
  const a=f.stop(),b=f.stop();await vi.waitFor(()=>expect(f.logs.some(s=>s.includes('继续等待'))).toBe(true));f.closeGate.release();
  for(const r of await Promise.all([a,b])){expect(r.status).toBe(500);expect(await r.json()).toMatchObject({stopped:false});}
  const later=await f.stop();expect(later.status).toBe(500);expect(await later.json()).toMatchObject({stopped:false});expectFailed(f);
 }finally{await f.cleanup();}
});
it('healthy page close waits then succeeds with one actual close and graceful first option',async()=>{
 const f=await fixture({blockClose:true});let response:Response|undefined;
 try{const pending=f.stop().then(r=>response=r);await vi.waitFor(()=>expect(f.actualCloses).toBe(1));await tick();
  expect(response).toBeUndefined();expect(f.exit).not.toHaveBeenCalled();expect(f.storageCloseReached).toBe(false);
  f.closeGate.release();await pending;expect(response!.status).toBe(200);expect(await response!.json()).toEqual({stopped:true});
  await vi.waitFor(()=>expect(f.exit).toHaveBeenCalledTimes(1));expect(f.actualCloses).toBe(1);expect(f.storageCloseReached).toBe(true);
  expect(f.closeOptions[0]).toEqual({graceful:true});expect(f.logs.some(s=>s.includes('HDSI停止完成'))).toBe(true);
 }finally{await f.cleanup();}
});
it('disconnected stop client cannot turn page close failure into success exit',async()=>{
 const f=await fixture({fail:true,blockClose:true});try{
  const req=request({hostname:'127.0.0.1',port:f.descriptor.port,path:'/stop',method:'POST',headers:f.headers});req.on('error',()=>{});req.end();
  await vi.waitFor(()=>expect(f.actualCloses).toBe(1));req.destroy();await tick();f.closeGate.release();
  await vi.waitFor(()=>expect(getBrowserRuntimeStatus(f.ctx).state).toBe('failed'));await tick();expectFailed(f);
 }finally{await f.cleanup();}
});
