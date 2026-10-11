import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import type {Storage} from '../storage';
import type {StorySettings} from '../settings';
import type {Clock} from '../types';
import type {WebSearchService} from '../web/service';
import type {ManagedBrowserProvider,BrowserPort} from '../web/browser/types';
import {createManagedBrowserProvider} from '../web/browser/provider';
import {createKoishiBrowserPort} from '../web/browser/koishi-port';
import {assembleWeb} from './web-runtime';

const projectRequire=createRequire(resolve(__dirname,'../../package.json'));
const runtimeRequire=createRequire(resolve(__dirname,'../../runtime/package.json'));
const message=(error:unknown)=>error instanceof Error?error.message:String(error);

/** Owns only the CLI's browser resources. It never loads the story deployment. */
export async function createStickerWebRuntime(storage:Storage,settings:StorySettings,clock:Clock,options:{startupTimeoutMs?:number}={}):Promise<{web:WebSearchService;dispose():Promise<void>}>{
 if(!settings.webSearch.enabled||settings.webSearch.provider!=='browser')return {web:assembleWeb(storage,settings,clock),dispose:async()=>{}};
 let ctx:any,managed:ManagedBrowserProvider|undefined,disposal:Promise<void>|undefined;
 let stopStartupWait=()=>{};
 // Cordis reset dispatches dispose hooks but does not await their return values.
 // Own those promises at registration, including scopes installed by Puppeteer.
 let closing=false,cleanupFinished=false,registering=false;
 const drains=new Set<Promise<void>>(),cleanupFailures:unknown[]=[];
 const scopeCleanups=new Map<object,Array<{run(late?:boolean):Promise<void>}>>();
 const canvasScopes=new Set<{dispose():unknown}>();
 const track=(callback:()=>unknown)=>{
  const pending=Promise.resolve().then(callback).then(()=>{},error=>{
   cleanupFailures.push(error);
   if(cleanupFinished)console.error('sticker late browser cleanup failed: '+message(error));
  });
  drains.add(pending);void pending.then(()=>drains.delete(pending));return pending;
 };
 const drain=async()=>{while(drains.size)await Promise.all([...drains]);};
 const dispose=()=>disposal??=(async()=>{
  closing=true;stopStartupWait();const failures:unknown[]=[];
  try{await managed?.dispose();}catch(error){failures.push(error);}
  // Traceable service.ctx is rebound to its caller. Use the scope captured when
  // canvas registered its lifecycle hooks, before closing the parent browser.
  for(const scope of canvasScopes){try{await scope.dispose();}catch(error){failures.push(error);}}
  await drain();
  try{await ctx?.stop();}catch(error){failures.push(error);}
  await drain();cleanupFinished=true;failures.push(...cleanupFailures);
  if(failures.length)throw new AggregateError(failures,'sticker browser cleanup failed: '+failures.map(message).join('; '));
 })();
 try{
  const {Context}=projectRequire('koishi');ctx=new Context();
  ctx.on('internal/listener',function(this:any,name:string,listener:()=>unknown,eventOptions:unknown){
   if(registering||(name!=='dispose'&&name!=='ready'))return;
   const scope=this.scope;let wrapped:()=>unknown;
   if(this.runtime.name==='canvas')canvasScopes.add(scope);
   if(name==='dispose'){
    let normal:Promise<void>|undefined,late:Promise<void>|undefined;
    const cleanup={run:(afterStart=false)=>afterStart&&normal
     ?(late??=track(async()=>{await normal;await listener();}))
     :(normal??=track(listener))};
    const entries=scopeCleanups.get(scope)??[];entries.push(cleanup);scopeCleanups.set(scope,entries);
    wrapped=()=>cleanup.run();
   }else wrapped=async()=>{
    try{await listener();}
    catch(error){
     if(!closing)throw error;
     // Service publishes itself after start; a timed-out scope is already gone.
     if((error as {code?:string})?.code!=='INACTIVE_EFFECT')console.error('sticker late browser startup failed: '+message(error));
    }finally{
     // A launch cannot be forcibly cancelled through Koishi's Service interface.
     // Keep its completion owned and close resources acquired after cancellation.
     if(closing)await Promise.all((scopeCleanups.get(scope)??[]).map(cleanup=>cleanup.run(true)));
    }
   };
   registering=true;
   try{return this.on(name,wrapped,eventOptions);}finally{registering=false;}
  },{prepend:true,global:true});
  ctx.plugin(runtimeRequire('@koishijs/plugin-http').default);
  const timeoutMs=options.startupTimeoutMs??60000;
  let resolveReady!:(port:BrowserPort)=>void;
  const ready=new Promise<BrowserPort>(resolve=>{resolveReady=resolve;});
  const failedStartup=new Promise<never>((_resolve,reject)=>{
   const offError=ctx.on('internal/error',(error:unknown)=>reject(error));
   const timer=setTimeout(()=>reject(Error(`browser startup timeout after ${timeoutMs}ms`)),timeoutMs);
   stopStartupWait=()=>{clearTimeout(timer);offError();};
  });
  ctx.inject(['puppeteer'],(inner:any)=>resolveReady(createKoishiBrowserPort(()=>inner.puppeteer.page())));
  // Koishi service startup can report internal/error while Context.start resolves.
  const startup=Promise.resolve().then(()=>{ctx.plugin(projectRequire('koishi-plugin-puppeteer').default,{headless:true});return ctx.start();});
  const [,port]=await Promise.race([Promise.all([startup,ready]),failedStartup]);
  stopStartupWait();
  managed=createManagedBrowserProvider(port,settings.webSearch.browser);
  return {web:assembleWeb(storage,settings,clock,managed.provider),dispose};
 }catch(error){
  try{await dispose();}catch(cleanupError){throw new AggregateError([error,cleanupError],message(error)+'; '+message(cleanupError),{cause:error});}
  throw error;
 }
}
