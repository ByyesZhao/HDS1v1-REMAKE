import type { Message,ScheduledTask } from '../types';
import type { MemoryCandidate,SelfWebReadSource } from '../memory/types';
import type { WebMaterial } from '../web/types';
export type OwnerViewPurpose='narrative'|'personal'|'expression'|'memory'|'maintenance';
export type PromptStage='narrative'|'narrative_shared'|'personal_chat'|'personal_life'|'personal_shared'|'expression'|'memory'|'memory_consolidation'|'memory_audit'|'world'|'school_campus'|'school_group'|'school_week'|'sticker_description';
export interface ModelOwnerView {ref:string;id:string;kind:MemoryCandidate['kind'];content?:string;eventSummary?:string;feelingSummary?:string;topics:string[];importance:MemoryCandidate['importance'];happenedAt:string;happenedUntil?:string;key?:string;value?:string;aliases?:string[];effectiveAt?:string;learnedKind?:MemoryCandidate['learnedKind'];canonicalMemoryId?:string;projectionBasis?:MemoryCandidate['projectionBasis'];sourceIds?:string[];linkedLongId?:string|null;createdAt?:string;summaryQuality?:MemoryCandidate['summaryQuality'];evidenceMemoryIds?:string[];totalAwakenings?:number;windowAwakenings?:number;summaryRepairBasis?:string}
export type ModelMessage=Pick<Message,'id'|'direction'|'content'|'receivedAt'>;
export type ModelScheduledTask=Pick<ScheduledTask,'id'|'kind'|'at'|'description'|'checkReason'|'messageIds'|'sharedActivityId'>;
export interface ModelResourcePool {messages:ModelMessage[];tasks:ModelScheduledTask[];owners:ModelOwnerView[];materials:WebMaterial[]}
export interface ModelRoles {recentIds?:string[];visibleIds?:string[];reconsiderIds?:string[];dueTaskIds?:string[];pendingTaskIds?:string[];detailRefs?:string[];shortRefs?:string[];longRefs?:string[];learnedRefs?:string[];currentSourceIds?:string[];sharedPublicOutgoingIds?:string[];selfReadSources?:SelfWebReadSource[]}
export interface StageBusinessSnapshot { [field:string]:unknown; recent?:Message[];visibleMessages?:Message[];reconsiderMessages?:Message[];outgoing?:Message[];tasks?:ScheduledTask[];dueTasks?:ScheduledTask[];details?:MemoryCandidate[];retrieved?:MemoryCandidate[];snapshot?:MemoryCandidate[];selfWebReadSources?:SelfWebReadSource[];selfWebReadMaterials?:Array<{sourceId:string;material?:WebMaterial}> }
export type StageInputSnapshot={ [S in PromptStage]:{stage:S;input:StageBusinessSnapshot} }[PromptStage];
export interface StageModelInput {contextVersion:1;context:Record<string,unknown>;resources:ModelResourcePool;roles:ModelRoles}
export function isStageModelInput(input:unknown):input is StageModelInput{return !!input&&typeof input==='object'&&'contextVersion' in input&&input.contextVersion===1&&'resources' in input;}
