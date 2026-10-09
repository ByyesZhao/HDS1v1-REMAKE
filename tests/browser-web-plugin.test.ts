import {it,expect,vi} from 'vitest';import {createRequire} from 'node:module';import {resolve} from 'node:path';import {installBrowserRuntime,getBrowserRuntimeStatus} from '../src/deployment/browser-runtime';
const {Context,Service}=createRequire(resolve('package.json'))('koishi');
vi.mock('koishi',async()=>(await import('node:module')).createRequire(`${process.cwd()}/package.json`)('koishi'));
const tick=()=>new Promise(r=>setImmediate(r));const settings={webSearch:{enabled:true,provider:'browser',browser:{engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1}}} as any;
it.each([true,false])('required service gates and serially replaces real Context runtime; browserFirst=%s',async first=>{
 const ctx=new Context();let starts=0,alive=0,max=0,closes=0,release!:()=>void,closing=false;
 class Browser extends Service{static [Service.provide]='puppeteer';constructor(c:any){super(c,'puppeteer');}page=async()=>{throw Error('unused page');};}
 const factory=async()=>{alive++;max=Math.max(max,alive);return {host:{start:async()=>{starts++;},status:async()=> 'running'},stopAcceptingInput(){},close:async()=>{if(closing)await new Promise<void>(r=>release=r);alive--;closes++;}} as any;};
 try{
 if(first)ctx.plugin(Browser);installBrowserRuntime(ctx,{} as any,settings,factory);await ctx.start();for(let i=0;i<5;i++)await tick();
 if(!first){expect(starts).toBe(0);expect(getBrowserRuntimeStatus(ctx).state).toBe('waiting');ctx.plugin(Browser);for(let i=0;i<10;i++)await tick();}
 expect(starts).toBe(1);expect(getBrowserRuntimeStatus(ctx).state).toBe('running');
 closing=true;const old=ctx.registry.get(Browser);old.dispose();for(let i=0;i<5;i++)await tick();ctx.plugin(Browser);for(let i=0;i<5;i++)await tick();expect(starts).toBe(1);expect(alive).toBe(1);
 closing=false;release();for(let i=0;i<10;i++)await tick();expect(starts).toBe(2);expect(max).toBe(1);expect(closes).toBe(1);
 }finally{closing=false;release?.();await ctx.stop();}
 expect(alive).toBe(0);
});
