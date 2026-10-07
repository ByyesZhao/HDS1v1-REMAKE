import { createHash } from 'node:crypto';
import type { Clock } from '../types';
import { WebSearchStore } from './store';
import { UnconfiguredWebProvider,WebSearchProvider } from './provider';
import { normalizeMaterial,normalizeWebUrl } from './content';
import type { ModelRunRef,WebSearchConfig,WebSearchSession,WebMaterial,WebOperationOptions,WebSearchResponse,WebOperationRequest } from './types';
import { defaultWebSearchConfig } from './types';
export class WebSearchService {
  private cache=new Map<string,Map<string,WebMaterial>>();
  private locks=new Map<string,Promise<unknown>>();
  private provider:WebSearchProvider;
  readonly config:WebSearchConfig;
  constructor(public readonly store:WebSearchStore,provider:WebSearchProvider|undefined,private clock:Clock,config:Partial<WebSearchConfig>={}){
    this.config={...defaultWebSearchConfig,...config};this.provider=provider??new UnconfiguredWebProvider();if(this.config.enabled&&this.provider.available===false)throw new Error('web search enabled but provider not configured');
  }
  openSession(ref:ModelRunRef):WebSearchSession {
    const available=this.config.enabled&&this.provider.available!==false;
    return {id:ref.runId,ref,available,limits:{successReads:this.config.maxSuccessReads,failures:this.config.maxFailures},snapshot:()=>this.store.snapshot(ref.runId),beginOperation:r=>this.store.beginOperation(ref.runId,r),saveCheckpoint:c=>this.store.saveCheckpoint(ref.runId,c),markProvided:ids=>this.store.markProvided(ref.runId,ids),
      searchAndRead:(request,options)=>this.serial(ref.runId,()=>this.execute(ref,{kind:'search',request},options)),readPage:(url,options)=>this.serial(ref.runId,()=>this.execute(ref,{kind:'read',url:normalizeWebUrl(url)},options))};
  }
  private serial<T>(id:string,fn:()=>Promise<T>):Promise<T>{const result=(this.locks.get(id)??Promise.resolve()).catch(()=>undefined).then(fn);this.locks.set(id,result);return result.finally(()=>{if(this.locks.get(id)===result)this.locks.delete(id);});}
  private quota(runId:string):boolean {const c=this.store.snapshot(runId).counters;return c.successReads>=this.config.maxSuccessReads||c.failures>=this.config.maxFailures;}
  private response(runId:string,operationId:string,stopReason:WebSearchResponse['stopReason']):WebSearchResponse {
    const s=this.store.snapshot(runId),op=this.store.operation(runId,operationId),materials=s.materials.filter(m=>op.materialIds.includes(m.id));
    const requestedPages=op.request.kind==='search'?op.request.request.requestedPages??1:1;
    return {materials,counters:s.counters,stopReason,failures:op.failures,requestedPages,obtainedPages:materials.length,...(materials.length<requestedPages?{message:'结果不足' as const}:{})};
  }
  private async execute(ref:ModelRunRef,_request:WebOperationRequest,options:WebOperationOptions):Promise<WebSearchResponse>{
    const runId=ref.runId;let op=this.store.operation(runId,options.operationId);if(op.status==='done')return {...op.response!,counters:this.store.snapshot(runId).counters};
    const finish=(reason:WebSearchResponse['stopReason'])=>{const result=this.response(runId,op.operationId,reason);this.store.finishOperation(runId,op.operationId,result);return result;};
    if(!this.config.enabled||this.provider.available===false)return {...finish(null),failures:[{reason:'unavailable'}]};
    options.signal?.throwIfAborted();if(this.quota(runId))return finish('quota');
    this.store.saveOperation({...op,status:'running'});
    if(op.candidateUrls===null){
      let candidates:Array<{url:string;title:string}>;
      try{this.store.incrementMetric(runId,'providerSearchCalls');candidates=await this.provider.search((op.request as Extract<WebOperationRequest,{kind:'search'}>).request.query,options.signal);options.signal?.throwIfAborted();if(!Array.isArray(candidates))throw new Error('invalid search result list');}
      catch(error){if(options.signal?.aborted)throw error;this.store.commitStep(runId,{operationId:op.operationId,stepIndex:-1,nextCandidateIndex:0,reason:'search_error'});return finish(this.quota(runId)?'quota':null);}
      const urls=[...new Set(candidates.map(c=>typeof c?.url==='string'?c.url:''))];
      if(!urls.length){this.store.commitStep(runId,{operationId:op.operationId,stepIndex:-1,nextCandidateIndex:0,reason:'no_candidates'});return finish('no_candidates');}
      op={...this.store.operation(runId,op.operationId),candidateUrls:urls};this.store.saveOperation(op);
    }
    op=this.store.operation(runId,op.operationId);
    const requested=op.request.kind==='search'?op.request.request.requestedPages??1:1;
    const target=Math.min(requested,this.config.maxSuccessReads-this.store.snapshot(runId).counters.successReads+op.materialIds.length);
    const owner=`${ref.ownerType}:${ref.ownerId}`;let publicCache=this.cache.get(owner);if(!publicCache){publicCache=new Map();this.cache.set(owner,publicCache);}
    while(op.nextCandidateIndex<op.candidateUrls!.length&&op.materialIds.length<target&&!this.quota(runId)){
      options.signal?.throwIfAborted();const stepIndex=op.nextCandidateIndex,rawUrl=op.candidateUrls![stepIndex];let url:string;
      try{url=normalizeWebUrl(rawUrl);}catch{this.store.commitStep(runId,{operationId:op.operationId,stepIndex,nextCandidateIndex:stepIndex+1,reason:'read_error',url:rawUrl});op=this.store.operation(runId,op.operationId);continue;}
      const own=this.store.snapshot(runId).materials.find(m=>m.url===url);
      if(own){if(op.request.kind==='read'){this.store.commitStep(runId,{operationId:op.operationId,stepIndex,nextCandidateIndex:stepIndex+1,material:own});}else this.store.saveOperation({...op,nextCandidateIndex:stepIndex+1});op=this.store.operation(runId,op.operationId);continue;}
      const cacheKey=`${this.provider.signature}:${url}`,cached=publicCache.get(cacheKey);let material:WebMaterial;
      try{
        if(cached){this.store.incrementMetric(runId,'cacheHits');material={...cached,readAt:this.clock.now()};}
        else{this.store.incrementMetric(runId,'providerReadCalls');const page=await this.provider.read(url,options.signal);options.signal?.throwIfAborted();material=normalizeMaterial({id:createHash('sha256').update(cacheKey).digest('hex'),url,title:page.title,body:page.body,readAt:this.clock.now(),selectionMode:'full_body'});}
      }catch(error){if(options.signal?.aborted)throw error;this.store.commitStep(runId,{operationId:op.operationId,stepIndex,nextCandidateIndex:stepIndex+1,reason:error instanceof Error&&error.message==='empty body'?'empty_body':'read_error',url});op=this.store.operation(runId,op.operationId);continue;}
      this.store.commitStep(runId,{operationId:op.operationId,stepIndex,nextCandidateIndex:stepIndex+1,material});publicCache.set(cacheKey,material);op=this.store.operation(runId,op.operationId);
    }
    if(op.request.kind==='search'&&!op.materialIds.length&&!op.failures.length&&!this.quota(runId))this.store.commitStep(runId,{operationId:op.operationId,stepIndex:-2,nextCandidateIndex:op.nextCandidateIndex,reason:'no_candidates'});
    return finish(this.quota(runId)?'quota':op.materialIds.length>=target?'satisfied':'no_candidates');
  }
  providedUrls(runId:string):string[]{const s=this.store.snapshot(runId);return s.materials.filter(m=>s.providedMaterialIds.includes(m.id)).map(m=>m.url);}
  selfReadSources(turnId:string,runId?:string){return this.store.selfReadSources(turnId,runId);}
  releaseOwner(ownerType:ModelRunRef['ownerType'],ownerId:string):void {this.cache.delete(`${ownerType}:${ownerId}`);}
  status(){return this.store.operationalStatus();}
}
