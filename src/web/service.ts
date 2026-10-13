import type {CheckpointArchiveReason} from '../model/run-history';
import {hydrateResult} from './persistence';
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
  private finalizations=new Map<string,Promise<void>>();
  private provider:WebSearchProvider;
  readonly config:WebSearchConfig;
  constructor(public readonly store:WebSearchStore,provider:WebSearchProvider|undefined,private clock:Clock,config:Partial<WebSearchConfig>={}){
    this.config={...defaultWebSearchConfig,...config};this.provider=provider??new UnconfiguredWebProvider();if(this.config.enabled&&this.provider.available===false)throw new Error('web search enabled but provider not configured');
  }
  openSession(ref:ModelRunRef,guard?:()=>void):WebSearchSession {
    const available=this.config.enabled&&this.provider.available!==false;
    return {id:ref.runId,ref,available,limits:{successReads:this.config.maxSuccessReads,failures:this.config.maxFailures},snapshot:()=>this.store.snapshot(ref.runId),state:()=>this.store.state(ref.runId),checkpoint:()=>this.store.checkpoint(ref.runId),operation:id=>this.store.operationState(ref.runId,id),materials:ids=>this.store.materials(ref.runId,ids),beginOperation:r=>this.store.beginOperation(ref.runId,r,guard),saveCheckpoint:c=>this.store.saveCheckpoint(ref.runId,c),markProvided:ids=>this.store.markProvided(ref.runId,ids,guard),
      searchAndRead:(request,options)=>this.serial(ref.runId,()=>this.execute(ref,{kind:'search',request},options,guard)),readPage:(url,options)=>this.serial(ref.runId,()=>this.execute(ref,{kind:'read',url:normalizeWebUrl(url)},options,guard))};
  }
  private serial<T>(id:string,fn:()=>Promise<T>):Promise<T>{const result=(this.locks.get(id)??Promise.resolve()).catch(()=>undefined).then(fn);this.locks.set(id,result);return result.finally(()=>{if(this.locks.get(id)===result)this.locks.delete(id);});}
  private quota(runId:string):boolean {const c=this.store.state(runId).counters;return c.successReads>=this.config.maxSuccessReads||c.failures>=this.config.maxFailures;}
  private materials(runId:string,ids:readonly string[],known?:ReadonlyMap<string,WebMaterial>):WebMaterial[] {
    const missing=ids.filter(id=>!known?.has(id)),loaded=new Map((missing.length?this.store.materials(runId,missing):[]).map(m=>[m.id,m]));
    return ids.map(id=>{const material=known?.get(id)??loaded.get(id);if(!material)throw Error(`web run ${runId}: missing web material ${id}`);return material;});
  }
  private response(runId:string,operationId:string,stopReason:WebSearchResponse['stopReason'],known?:ReadonlyMap<string,WebMaterial>):WebSearchResponse {
    const s=this.store.state(runId),op=this.store.operationState(runId,operationId),materials=this.materials(runId,op.materialIds,known);
    const requestedPages=op.request.kind==='search'?op.request.request.requestedPages??1:1;
    return {materials,counters:s.counters,stopReason,failures:op.failures,requestedPages,obtainedPages:materials.length,...(materials.length<requestedPages?{message:'结果不足' as const}:{})};
  }
  private async execute(ref:ModelRunRef,_request:WebOperationRequest,options:WebOperationOptions,guard?:()=>void):Promise<WebSearchResponse>{
    options.signal?.throwIfAborted();guard?.();
    const runId=ref.runId;if(options.materialPool&&options.materialPool.runId!==runId)throw Error(`web run ${runId}: material pool belongs to another run`);
    const known=options.materialPool?.materials;let op=this.store.operationState(runId,options.operationId);if(op.status==='done'){try{return {...hydrateResult(op.response!,new Map(this.materials(runId,op.response!.materialIds,known).map(m=>[m.id,m]))),counters:this.store.state(runId).counters};}catch(error){throw Error(`web run ${runId}: ${error instanceof Error?error.message:String(error)}`);}}
    const finish=(reason:WebSearchResponse['stopReason'])=>{const result=this.response(runId,op.operationId,reason,known);this.store.finishOperation(runId,op.operationId,result);return result;};
    if(!this.config.enabled||this.provider.available===false)return {...finish(null),failures:[{reason:'unavailable'}]};
    options.signal?.throwIfAborted();guard?.();if(this.quota(runId))return finish('quota');
    this.store.saveOperation({...op,status:'running'});
    if(op.candidateUrls===null){
      let candidates:Array<{url:string;title:string}>;
      try{this.store.incrementMetric(runId,'providerSearchCalls');candidates=await this.provider.search((op.request as Extract<WebOperationRequest,{kind:'search'}>).request.query,options.signal);options.signal?.throwIfAborted();guard?.();if(!Array.isArray(candidates))throw new Error('invalid search result list');}
      catch(error){if(options.signal?.aborted)throw error;this.store.commitStep(runId,{operationId:op.operationId,stepIndex:-1,nextCandidateIndex:0,reason:'search_error'});return finish(this.quota(runId)?'quota':null);}
      const urls=[...new Set(candidates.map(c=>typeof c?.url==='string'?c.url:''))];
      if(!urls.length){this.store.commitStep(runId,{operationId:op.operationId,stepIndex:-1,nextCandidateIndex:0,reason:'no_candidates'});return finish('no_candidates');}
      op={...this.store.operationState(runId,op.operationId),candidateUrls:urls};this.store.saveOperation(op);
    }
    op=this.store.operationState(runId,op.operationId);
    const requested=op.request.kind==='search'?op.request.request.requestedPages??1:1;
    const target=Math.min(requested,this.config.maxSuccessReads-this.store.state(runId).counters.successReads+op.materialIds.length);
    const owner=`${ref.ownerType}:${ref.ownerId}`;let publicCache=this.cache.get(owner);if(!publicCache){publicCache=new Map();this.cache.set(owner,publicCache);}
    while(op.nextCandidateIndex<op.candidateUrls!.length&&op.materialIds.length<target&&!this.quota(runId)){
      options.signal?.throwIfAborted();guard?.();const stepIndex=op.nextCandidateIndex,rawUrl=op.candidateUrls![stepIndex];let url:string;
      try{url=normalizeWebUrl(rawUrl);}catch{this.store.commitStep(runId,{operationId:op.operationId,stepIndex,nextCandidateIndex:stepIndex+1,reason:'read_error',url:rawUrl});op=this.store.operationState(runId,op.operationId);continue;}
      const own=this.store.materialMetadata(runId,url)[0];
      if(own){if(op.request.kind==='read'){const material=this.materials(runId,[own.id],known)[0];this.store.commitStep(runId,{operationId:op.operationId,stepIndex,nextCandidateIndex:stepIndex+1,material});}else this.store.saveOperation({...op,nextCandidateIndex:stepIndex+1});op=this.store.operationState(runId,op.operationId);continue;}
      const cacheKey=`${this.provider.signature}:${url}`,cached=publicCache.get(cacheKey);let material:WebMaterial;
      try{
        if(cached){this.store.incrementMetric(runId,'cacheHits');material={...cached,readAt:this.clock.now()};}
        else{this.store.incrementMetric(runId,'providerReadCalls');const page=await this.provider.read(url,options.signal);options.signal?.throwIfAborted();guard?.();material=normalizeMaterial({id:createHash('sha256').update(cacheKey).digest('hex'),url,title:page.title,body:page.body,readAt:this.clock.now(),selectionMode:'full_body'});}
      }catch(error){if(options.signal?.aborted)throw error;this.store.commitStep(runId,{operationId:op.operationId,stepIndex,nextCandidateIndex:stepIndex+1,reason:error instanceof Error&&error.message==='empty body'?'empty_body':'read_error',url});op=this.store.operationState(runId,op.operationId);continue;}
      this.store.commitStep(runId,{operationId:op.operationId,stepIndex,nextCandidateIndex:stepIndex+1,material});publicCache.set(cacheKey,material);op=this.store.operationState(runId,op.operationId);
    }
    if(op.request.kind==='search'&&!op.materialIds.length&&!op.failures.length&&!this.quota(runId))this.store.commitStep(runId,{operationId:op.operationId,stepIndex:-2,nextCandidateIndex:op.nextCandidateIndex,reason:'no_candidates'});
    return finish(this.quota(runId)?'quota':op.materialIds.length>=target?'satisfied':'no_candidates');
  }
  providedUrls(runId:string):string[]{return this.store.materialMetadata(runId).filter(m=>m.provided).map(m=>m.url);}
  selfReadSources(turnId:string,runId?:string){return this.store.selfReadSources(turnId,runId);}
  releaseOwner(ownerType:ModelRunRef['ownerType'],ownerId:string):void {this.cache.delete(`${ownerType}:${ownerId}`);}
  // The caller must settle the owner's entire execution before entering here.
  // Web locks alone do not cover model checkpoint writes or cancellation finally blocks.
  finalizeOwner(ownerType:ModelRunRef['ownerType'],ownerId:string,reason:CheckpointArchiveReason='completed'):Promise<void> {
    const key=`${ownerType}:${ownerId}`,existing=this.finalizations.get(key);if(existing)return existing;
    const pending=this.store.ownerRunIds(ownerType,ownerId).flatMap(id=>{const lock=this.locks.get(id);return lock?[lock]:[];});
    const finalization=Promise.allSettled(pending).then(()=>{this.releaseOwner(ownerType,ownerId);this.compactOwnerCheckpoint(ownerType,ownerId,reason);}).finally(()=>{this.finalizations.delete(key);});
    this.finalizations.set(key,finalization);return finalization;
  }
  compactOwnerCheckpoint(ownerType:ModelRunRef['ownerType'],ownerId:string,reason:CheckpointArchiveReason='completed'):void {this.store.compactOwnerCheckpoint(ownerType,ownerId,reason);}
  statusSummary(currentOwners:readonly import('./types').WebOwnerRef[]){return {...this.store.statusSummary(currentOwners),enabled:this.config.enabled,limits:{successReads:this.config.maxSuccessReads,failures:this.config.maxFailures}};}
  status(){return this.store.operationalStatus();}
}
