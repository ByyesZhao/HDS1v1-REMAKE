import type { SelfWebReadSource } from '../memory/types';
export type { SelfWebReadSource };
export interface ModelRunRef {runId:string;ownerType:'turn'|'maintenance'|'asset'|'environment';ownerId:string;stageKey:string;taskName:string;ordinal:number}
export interface WebSearchRequest {query:string;requestedPages?:number}
export interface WebMaterial {id:string;url:string;title:string;body:string;readAt:string;bodyCharacters:number;selectionMode:'full_body'|'relevant_passages';sourceKind:'external_reference'}
export interface WebSearchCounters {successReads:number;failures:number}
export interface WebOperationOptions {operationId:string;signal?:AbortSignal}
export interface WebSearchResponse {materials:WebMaterial[];counters:WebSearchCounters;stopReason:'quota'|'satisfied'|'no_candidates'|null;failures?:Array<{reason:string;url?:string}>;requestedPages?:number;obtainedPages?:number;message?:'结果不足'}
export type WebOperationRequest={kind:'search';request:WebSearchRequest}|{kind:'read';url:string};
export interface WebOperationRecord {operationId:string;runId:string;request:WebOperationRequest;candidateUrls:string[]|null;nextCandidateIndex:number;status:'pending'|'running'|'done';materialIds:string[];failures:Array<{reason:string;url?:string}>;confirmedSteps:number[];response:WebSearchResponse|null}
export interface WebModelCheckpoint {lookupRequest?:import('../memory/types').LookupRequest;lookupPending?:boolean;input:unknown;repairCount:number;lookupUsed:boolean;pendingOperationId:string|null;toolResults:WebSearchResponse[];privateLookupResult?:unknown;repair?:{original:unknown;errors:string}}
export interface WebSessionMetrics {cacheHits:number;providerSearchCalls:number;providerReadCalls:number}
export interface WebSessionSnapshot {ref:ModelRunRef;counters:WebSearchCounters;materials:WebMaterial[];providedMaterialIds:string[];operations:WebOperationRecord[];nextOperationOrdinal:number;repairCount:number;lookupUsed:boolean;checkpoint:WebModelCheckpoint|null;metrics:WebSessionMetrics}
export type WebConfirmedStep={operationId:string;stepIndex:number;nextCandidateIndex:number}&({material:WebMaterial;reason?:never;url?:never}|{reason:string;url?:string;material?:never});
export interface WebSearchConfig {enabled:boolean;maxSuccessReads:number;maxFailures:number}
export const defaultWebSearchConfig:WebSearchConfig={enabled:false,maxSuccessReads:20,maxFailures:40};
export interface WebSearchSession {
  id:string;ref:ModelRunRef;available:boolean;limits:WebSearchCounters;
  searchAndRead(request:WebSearchRequest,options:WebOperationOptions):Promise<WebSearchResponse>;
  readPage(url:string,options:WebOperationOptions):Promise<WebSearchResponse>;
  snapshot():WebSessionSnapshot;beginOperation(request:WebOperationRequest):WebOperationRecord;
  saveCheckpoint(checkpoint:WebModelCheckpoint):void;markProvided(materialIds:string[]):void;
}

export type WebOwnerRef=Pick<ModelRunRef,'ownerType'|'ownerId'>;
export interface WebStatusSummary {
 enabled:boolean;limits:WebSearchCounters;
 totals:{sessions:number;owners:number;successReads:number;failures:number;cacheHits:number;providerSearchCalls:number;providerReadCalls:number};
 currentOwners:Array<WebOwnerRef&{stageCount:number;stages:Array<{runId:string;stageKey:string;taskName:string;counters:WebSearchCounters;metrics:WebSessionMetrics}>;omittedStages:number}>;
 omittedOwners:number;
}
