import type { Message, DetailHistory } from '../types';

export interface MemoryOwnerRef { ownerType: 'short'|'long'|'detail'|'learned'; ownerId: string }
export interface OwnerVersion extends MemoryOwnerRef { revision: number; stateVersion: number }
export interface MemoryCandidate extends OwnerVersion {
  id: string; kind: MemoryOwnerRef['ownerType']; content: string; sourceIds: string[]; createdAt: string;
  topics: string[]; status: 'active'|'merged'|'durable'|'discarded'; mergedInto: string|null;
  importance: 'normal'|'high'; eventSummary: string; feelingSummary: string;
  happenedAt: string; happenedUntil?:string; lastEventUpdateAt: string; shortExpiresAt: string|null; linkedLongId: string|null;
  retainedFrom: string|null; expiresAt: string|null; summaryQuality: 'preview'|'refined';
  totalAwakenings: number; windowAwakenings: number; legacyMentions: number;
  evaluatedEvidenceVersion: number|null; consolidatedRevision: number|null;
  key?: string; value?: string; aliases?: string[]; effectiveAt?: string;
  canonicalMemoryId?: string; alwaysInclude?: boolean; learnedKind?: 'durable_experience'|'stable_understanding';
  projectionBasis?:{content:string;sourceIds:string[];revision:number};
  evidenceVersions?: OwnerVersion[];
  capacityExitedAt?: string|null; capacityExitReason?: 'short_capacity'|'long_capacity'|null;
  archiveEnteredAt?: string|null; evidenceMemoryIds?: string[];
  summaryRepairBasis?:string;
  normalizedVector?: Float32Array;
}
export function memoryOwnerData(owner:MemoryCandidate):MemoryCandidate {
  const {normalizedVector,action,clientRef,existingLongId,hasNewEventProgress,...data}=owner as MemoryCandidate&{action?:unknown;clientRef?:unknown;existingLongId?:unknown;hasNewEventProgress?:unknown};
  return {capacityExitedAt:null,capacityExitReason:null,archiveEnteredAt:null,evidenceMemoryIds:[],...data};
}
export interface MemoryCapacityConfig {shortActiveLimit:number|null;longActiveLimit:number|null;longArchiveLimit:number|null;archiveRetentionDays:number|null}
export const defaultMemoryCapacity:MemoryCapacityConfig={shortActiveLimit:100,longActiveLimit:1000,longArchiveLimit:500,archiveRetentionDays:90};
export interface MemoryCapacityCounts {shortActive:number;longOccupied:number;longPreview:number;longVisible:number;longArchive:number;protectedLong:number;shortOverflow:number;longOverflow:number;archiveOverflow:number}
export interface CapacityResult {changedOwners:OwnerVersion[];temporaryProtectedIds:string[];counts:MemoryCapacityCounts}
export interface MemoryIdleState {lastInputAt:string|null;lastOutputAt:string|null;lastStoryCompletedAt:string|null;lastActivityChangedAt:string|null}
export interface IdleEligibility {allowed:boolean;readyAt:string|null;reason:'ready'|'waiting'|'shared_activity'|'activity'|'unfinished'|'batch'|'paused'}
export interface MemoryDirtyOwner extends OwnerVersion {queuedAt:string;reasons:Array<'event'|'awaken'|'detail'|'capacity'|'expiry'|'learned'>;status:'pending'|'reserved'|'done';lastProcessedVersion:{revision:number;stateVersion:number}|null}
export interface MemoryAuditReport {id:string;at:string;readSet:OwnerVersion[];kind:'detail_conflict'|'learned_revision'|'learned_withdrawal';sourceIds:string[];reason:string}
export interface ContextLimits {
  historyBudget: number|null; alwaysIncludeCharactersLimit: number|null; candidateItemsPerRoute: number|null;
  detailItemsLimit: number|null; shortItemsLimit: number|null; longItemsLimit: number|null; recentDialogueSegments:number;dialogueIdleMinutes:number;
}
export const defaultContextLimits: ContextLimits = {historyBudget:null,alwaysIncludeCharactersLimit:null,candidateItemsPerRoute:null,detailItemsLimit:null,shortItemsLimit:null,longItemsLimit:null,recentDialogueSegments:4,dialogueIdleMinutes:15};
export interface RetrievalStats {semanticSkipped?:number;semanticSkipReasons?:Record<string,number>; queries:number; cacheHits:number; remoteRequests:number; timeouts:number; failures:number; lexicalFallbacks:number; startedAt:string }
export interface RetrievalPermissions { allowArchive:boolean; allowDetailHistory:boolean; visibleSourceIds:string[] }
export interface RetrievalRequest {dialogueWindowVersion?:1|2; query:string; at:string; phase:string; scope:'current'|'archive'; includeDetailHistory:boolean; permissions:RetrievalPermissions; budget:number|null }
export type LookupRequest = string | {query:string; scope:'current'|'archive'; includeDetailHistory:boolean};
export interface RetrievedContext { recent:Message[]; detailHistory:DetailHistory[]; details:MemoryCandidate[]; shortTerm:MemoryCandidate[]; longTerm:MemoryCandidate[]; learned:MemoryCandidate[] }
export interface AwakeningInput { id:string; turnId:string; at:string; sourceIds:string[]; reason:string; allowedIds:string[]; allowedSourceIds:string[] }
export interface SelfWebReadSource { id:string; turnId:string; runId:string; operationId:string; materialId:string; url:string; readAt:string; sourceKind:'self_web_read'; phase:'personal_life' }
export interface RetentionGrant {id:string; canonicalMemoryId:string; kind:'initial'|'migration'|'renew'|'reactivate'; anchorAt:string; expiresAt:string; triggerDates:string[]}
export interface Awakening {canonicalMemoryId:string; localDate:string; firstEffectiveAt:string; turnId:string; sourceIds:string[]}
export interface IndexJob {startedAt?:string|null;id:string; owner:OwnerVersion; text:string; configSignature:string; createdAt:string; status:'pending'|'computing'|'ready'|'done';retryAt:string|null;completedAt:string|null;completionReason:'applied'|'stale'|null; result?:number[];lastError?:string|null}
export interface IndexResult {jobId:string;owner:OwnerVersion;configSignature:string;normalizedVector:Float32Array}
export interface MaintenanceUnit {unitKey:string;action:'refine'|'merge'|'merge_short'|'discard'|'promote'|'retain'|'review_detail'|'review_learned';readSet:OwnerVersion[];ids:string[];canonicalId?:string;canonicalShortId?:string;targetId?:string;decision?:'retain'|'report_conflict'|'suggest_revision'|'suggest_withdrawal';content?:string;eventSummary?:string;feelingSummary?:string;sourceIds:string[];learnedKind?:'durable_experience'|'stable_understanding';alwaysInclude?:boolean;reason?:string}
export interface MaintenanceJob {startedAt?:string|null;id:string;cutoff:string;createdAt:string;status:'pending'|'computing'|'ready'|'done';snapshot:MemoryCandidate[];selectedIds?:string[];readSet:OwnerVersion[];result:MaintenanceUnit[]|null;appliedUnitKeys:string[];staleUnitKeys:string[];retryAt:string|null;lastError:string|null;kind?:'consolidation'|'audit';prunedOwnerKeys?:string[]}
export interface ModelRunOptions {executionAttempt?:{retryCycle:number;attemptId:string};signal?:AbortSignal;lookup?:((request:LookupRequest)=>Promise<unknown>)|null;runRef?:import('../web/types').ModelRunRef;web?:import('../web/types').WebSearchSession|null}
export interface ShortCreate {action:'create';clientRef:string;content:string;eventSummary:string;feelingSummary:string;topics:string[];sourceIds:string[];importance:'normal'|'high';existingLongId?:string;hasNewEventProgress?:boolean;happenedAt?:string;happenedUntil?:string}
export interface ShortUpdate {action:'update';id:string;content:string;eventSummary:string;feelingSummary:string;topics:string[];sourceIds:string[];hasNewEventProgress:boolean;happenedAt?:string;happenedUntil?:string}
export interface MemoryResultV3 {schemaVersion:3;shortTermChanges:Array<ShortCreate|ShortUpdate>;longTermChanges:Array<{action:'awaken';id:string;reason:string;sourceIds:string[]}>;detailChanges:Array<{action:'create'|'update';key:string;value:string;aliases:string[];reason:string;sourceIds:string[]}>}

export interface ProjectionRepairReport {changedOwnerIds:string[];reindexedOwnerIds:string[];missingCanonicalIds:string[]}

export interface RetrievalBuildOptions {includeRecent?:boolean}
export interface MemoryContext {details:MemoryCandidate[];retrieved:MemoryCandidate[]}
