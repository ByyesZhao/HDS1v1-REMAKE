import type {BrowserPort,BrowserPagePort,BrowserReadRequest,BrowserPageResult,BrowserProviderConfig} from './types';
interface Work {request:BrowserReadRequest;controller:AbortController;deadlineAt:number;resolve:(r:BrowserPageResult)=>void;reject:(e:unknown)=>void;finish:()=>void;settled:boolean;reserved:boolean}
export class BrowserPageSlots {
 private queue:Work[]=[];private active=new Set<Work>();private drains=new Set<Promise<void>>();
 private stopped=false;private failure:unknown=null;private disposal:Promise<void>|null=null;
 constructor(private port:BrowserPort,private config:BrowserProviderConfig,private now:()=>number=()=>performance.now()){}
 status(){return {reservations:this.active.size,queued:this.queue.length,accepting:!this.stopped&&!this.failure,unhealthy:!!this.failure};}
 read(request:BrowserReadRequest,signal?:AbortSignal):Promise<BrowserPageResult>{
  if(this.stopped||this.failure)return Promise.reject(this.failure??Error('browser provider stopped'));signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
   const controller=new AbortController(),deadlineAt=this.now()+this.config.navigationTimeoutMs;
   const parentAbort=()=>controller.abort(signal?.reason??Error('browser operation cancelled'));
   let timer:ReturnType<typeof setTimeout>;const work:Work={request,controller,deadlineAt,resolve,reject,settled:false,reserved:false,finish:()=>{clearTimeout(timer);signal?.removeEventListener('abort',parentAbort);}};
   const abort=()=>{if(!work.settled){work.settled=true;reject(controller.signal.reason);work.finish();}if(!work.reserved){this.queue=this.queue.filter(w=>w!==work);this.pump();}};
   controller.signal.addEventListener('abort',abort,{once:true});signal?.addEventListener('abort',parentAbort,{once:true});
   timer=setTimeout(()=>controller.abort(Error('browser page operation timed out')),Math.max(0,deadlineAt-this.now()));
   this.queue.push(work);this.pump();
  });
 }
 private pump(){if(this.stopped||this.failure)return;while(this.active.size<this.config.maxConcurrentPages&&this.queue.length){
  const work=this.queue.shift()!;if(work.controller.signal.aborted)continue;if(this.now()>=work.deadlineAt){work.controller.abort(Error('browser page operation timed out in queue'));continue;}
  work.reserved=true;this.active.add(work);
  const drain=this.perform(work);this.drains.add(drain);drain.finally(()=>this.drains.delete(drain)).catch(()=>{});
 }}
 private async perform(work:Work):Promise<void>{
  let page:BrowserPagePort|undefined,value:BrowserPageResult|undefined,error:unknown,closeFailure:unknown;
  const signal=work.controller.signal;
  try{
   page=await this.port.openPage();signal.throwIfAborted();
   const cancelled=new Promise<never>((_r,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
   value=await Promise.race([page.read(work.request,{signal,deadlineAt:work.deadlineAt}),cancelled]);signal.throwIfAborted();
  }catch(e){error=e;}
  finally{
   if(page){try{await page.close();}catch(e){if(!page.isClosed?.())closeFailure=e;}}
   if(closeFailure){this.failure=closeFailure;this.stopAccepting(closeFailure instanceof Error?closeFailure:Error(String(closeFailure)));error=closeFailure;}
   else this.active.delete(work);
   if(!work.settled){work.settled=true;work.finish();if(error)work.reject(error);else work.resolve(value!);}
   this.pump();
  }
 }
 stopAccepting(reason:Error=Error('browser provider stopped')){this.stopped=true;for(const work of [...this.queue,...this.active])work.controller.abort(reason);this.queue=[];}
 dispose():Promise<void>{if(!this.disposal){this.stopAccepting();this.disposal=(async()=>{await Promise.allSettled([...this.drains]);if(this.failure)throw this.failure;if(this.active.size)throw Error('browser resources still draining');})();}return this.disposal;}
}
