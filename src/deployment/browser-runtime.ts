import {installStopControl} from './stop-control';
import type {Context} from 'koishi';import type {Config} from '../index';import type {StorySettings} from '../settings';import {createPluginRuntime} from './plugin-runtime';import type {PluginRuntime} from './plugin-runtime';
import {createManagedBrowserProvider} from '../web/browser/provider';import {createKoishiBrowserPort} from '../web/browser/koishi-port';import {isTargetSession} from '../host/input';import type {ManagedBrowserProvider} from '../web/browser/types';
export interface BrowserRuntimeStatus {state:'waiting'|'starting'|'running'|'stopping'|'failed';error:string|null}
const statuses=new WeakMap<object,BrowserRuntimeStatus>();
export function getBrowserRuntimeStatus(ctx:object):BrowserRuntimeStatus{return statuses.get(ctx)??{state:'waiting',error:null};}
export function installBrowserRuntime(ctx:Context,config:Config,settings:StorySettings,create:typeof createPluginRuntime=createPluginRuntime):void{
 const status:BrowserRuntimeStatus={state:'waiting',error:null};statuses.set(ctx,status);
 let generation=0,disposed=false,fatal:unknown=null,chain=Promise.resolve(),current:{generation:number;runtime:PluginRuntime;managed:ManagedBrowserProvider}|null=null;
 const logger=ctx.logger('hdsi-browser');
 const closeCurrent=async()=>{if(!current)return;status.state='stopping';const old=current;old.runtime.stopAcceptingInput();try{await old.runtime.close();current=null;}catch(error){fatal=error;throw error;}};
 const enqueue=(work:()=>Promise<void>)=>{chain=chain.then(async()=>{if(fatal)throw fatal;await work();}).catch(error=>{status.state='failed';status.error=error instanceof Error?error.message:String(error);logger.error(error);});return chain;};
 ctx.inject(['puppeteer'],inner=>{
  const g=++generation,service=(inner as Context&{puppeteer:{page:()=>Promise<any>}}).puppeteer;
  const page=service.page.bind(service),managed=createManagedBrowserProvider(createKoishiBrowserPort(page),settings.webSearch.browser);
  let removing=false;
  enqueue(async()=>{
   await closeCurrent();if(disposed||removing||g!==generation){await managed.dispose();return;}
   status.state='starting';status.error=null;
   try{const runtime=await create(inner,config,settings,managed);current={generation:g,runtime,managed};
    if(disposed||removing||g!==generation){runtime.stopAcceptingInput();await closeCurrent();return;}
    await runtime.host.start();if(!disposed&&!removing&&g===generation)status.state='running';
   }catch(error){try{if(current?.generation===g)await closeCurrent();else await managed.dispose();}catch(closeError){fatal=closeError;}throw error;}
  });
  inner.on('dispose',()=>{
   removing=true;if(g===generation)generation++;
   if(!disposed){managed.stopAccepting(Error('browser service removed'));if(current?.generation===g)current.runtime.stopAcceptingInput();}
   return enqueue(async()=>{if(current?.generation===g)await closeCurrent();else await managed.dispose();if(!disposed&&!fatal)status.state='waiting';});
  });
 });
 ctx.command('hdsi.status','故事状态',{authority:0}).action(async({session})=>{if(!session||!isTargetSession(session,config))return;return (current?await current.runtime.host.status():'故事实例尚未启动')+'；浏览器：'+status.state+(status.error?'／'+status.error:'');});
 installStopControl(ctx,async()=>{disposed=true;generation++;current?.runtime.stopAcceptingInput();const draining=current?.runtime.close({graceful:true});await enqueue(async()=>{await draining;await closeCurrent();});if(fatal)throw fatal;});
 ctx.on('ready',()=>chain);
 // Registered after injection: normal parent shutdown closes foreground before provider disposal.
 ctx.on('dispose',async()=>{disposed=true;generation++;current?.runtime.stopAcceptingInput();await enqueue(closeCurrent);if(fatal)throw fatal;});
}
