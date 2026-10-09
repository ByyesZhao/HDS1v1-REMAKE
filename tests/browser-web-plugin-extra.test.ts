import {it,expect,vi} from 'vitest';import {createRequire} from 'node:module';import {resolve} from 'node:path';import {installBrowserRuntime,getBrowserRuntimeStatus} from '../src/deployment/browser-runtime';
vi.mock('koishi',async()=>(await import('node:module')).createRequire(process.cwd()+'/package.json')('koishi'));
const {Context,Service}=createRequire(resolve('package.json'))('koishi');const tick=()=>new Promise(r=>setImmediate(r));const settings={webSearch:{enabled:true,provider:'browser',browser:{engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1}}} as any;
it('failed HDSI startup is reported and acquired instance closes exactly once',async()=>{
 const ctx=new Context();let closes=0;class Browser extends Service{static [Service.provide]='puppeteer';constructor(c:any){super(c,'puppeteer');}page=async()=>{throw Error('unused');};}
 try{ctx.plugin(Browser);installBrowserRuntime(ctx,{} as any,settings,async()=>({host:{start:async()=>{throw Error('synthetic host startup failure');}},stopAcceptingInput(){},close:async()=>{closes++;}} as any));await ctx.start();for(let i=0;i<6;i++)await tick();expect(getBrowserRuntimeStatus(ctx)).toEqual({state:'failed',error:'synthetic host startup failure'});expect(closes).toBe(1);}finally{await ctx.stop();}expect(closes).toBe(1);
});

it('rejecting browser service preserves original Koishi error and never opens a story runtime',async()=>{
 const ctx=new Context();let creates=0;const original=Error('synthetic browser startup failure');const errors:unknown[]=[];
 ctx.on('internal/error',(error:unknown)=>{errors.push(error);});
 class Browser extends Service{static [Service.provide]='puppeteer';constructor(c:any){super(c,'puppeteer');}start=async()=>{throw original;};page=async()=>{throw Error('must not open page');};}
 try{installBrowserRuntime(ctx,{} as any,settings,async()=>{creates++;throw Error('must not open storage');});ctx.plugin(Browser);await ctx.start();for(let i=0;i<8;i++)await tick();
 expect(creates).toBe(0);expect(getBrowserRuntimeStatus(ctx).state).toBe('waiting');expect(errors).toContain(original);
 }finally{await ctx.stop();}
});
