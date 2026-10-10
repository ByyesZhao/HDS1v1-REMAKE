import {it,expect,vi,afterEach} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,sep} from 'node:path';import {createRequire} from 'node:module';import {resolve} from 'node:path';import {installBrowserRuntime,getBrowserRuntimeStatus} from '../src/deployment/browser-runtime';
const {Context:CoreContext,Service}=createRequire(resolve('package.json'))('koishi');
const fixtureDirs:string[]=[];class Context extends CoreContext{constructor(){super();this.baseDir=mkdtempSync(join(tmpdir(),'hdsi-browser-stop-'));fixtureDirs.push(this.baseDir);}}
afterEach(()=>{for(const dir of fixtureDirs.splice(0)){if(!resolve(dir).startsWith(resolve(tmpdir())+sep))throw Error('fixture outside temp root');rmSync(dir,{recursive:true,force:true});}});

vi.mock('koishi',async()=>(await import('node:module')).createRequire(`${process.cwd()}/package.json`)('koishi'));
const tick=()=>new Promise(r=>setImmediate(r));const settings={webSearch:{enabled:true,provider:'browser',browser:{engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1}}} as any;
it.each([true,false])('required service gates and serially replaces real Context runtime; browserFirst=%s',async first=>{
 const ctx=new Context();let starts=0,alive=0,max=0,closes=0,release!:()=>void,closing=false;
 class Browser extends Service{static [Service.provide]='puppeteer';constructor(c:any){super(c,'puppeteer');}page=async()=>{throw Error('unused page');};}
 const factory=async()=>{alive++;max=Math.max(max,alive);return {host:{start:async()=>{starts++;},status:async()=> 'running'},stopAcceptingInput(){},close:async()=>{if(closing)await new Promise<void>(r=>release=r);alive--;closes++;}} as any;};
 try{
 if(first)ctx.plugin(Browser);installBrowserRuntime(ctx,{} as any,settings,factory);await ctx.start();for(let i=0;i<5;i++)await tick();
 if(!first){expect(starts).toBe(0);expect(getBrowserRuntimeStatus(ctx).state).toBe('waiting');ctx.plugin(Browser);for(let i=0;i<10;i++)await tick();}
 await vi.waitFor(()=>expect(starts).toBe(1));expect(getBrowserRuntimeStatus(ctx).state).toBe('running');
 closing=true;const old=ctx.registry.get(Browser);old.dispose();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));ctx.plugin(Browser);for(let i=0;i<5;i++)await tick();expect(starts).toBe(1);expect(alive).toBe(1);
 closing=false;release();await vi.waitFor(()=>expect(starts).toBe(2));expect(max).toBe(1);expect(closes).toBe(1);
 }finally{closing=false;release?.();await ctx.stop();}
 expect(alive).toBe(0);
});

it('exit hook drains browser runtime before close and awaits current work',async()=>{
 const ctx=new Context();let release!:()=>void,options:any,closed=false;const gate=new Promise<void>(r=>release=r);
 class Browser extends Service{static [Service.provide]='puppeteer';constructor(c:any){super(c,'puppeteer');}page=async()=>{throw Error('unused');};}
 const factory=async()=>({host:{start:async()=>{},status:async()=> 'running'},stopAcceptingInput(){},close:async(o:any)=>{options??=o;await gate;closed=true;}} as any);
 try{ctx.plugin(Browser);installBrowserRuntime(ctx,{} as any,settings,factory);await ctx.start();for(let i=0;i<5;i++)await tick();let done=false;const exiting=ctx.parallel('exit','SIGINT').then(()=>done=true);await vi.waitFor(()=>expect(options).toEqual({graceful:true}));expect(done).toBe(false);release();await exiting;expect(closed).toBe(true);}finally{release?.();await ctx.stop();}
});
