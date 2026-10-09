import type { EnvironmentChange, ISOTime } from '../types';
import type { SchoolPlanChange, SchoolItemChange, SchoolInstanceCandidate, SchoolNoticeCandidate, SchoolWeekCandidate, SchoolPlan, SchoolPlanItem, SchoolInstance, SchoolNotice, SchoolWeek } from '../school/types';
export const environmentStages = ['world','school_campus','school_group','school_week'] as const;
export type EnvironmentStage = typeof environmentStages[number];
export type EnvironmentBatchStatus = 'active'|'committed'|'superseded';
export type EnvironmentStepStatus = 'pending'|'running'|'ready'|'committed'|'superseded';
export interface EnvironmentBatch {id:string;localDate:string;timezone:string;scheduledAt:ISOTime;createdAt:ISOTime;reason:'daily'|'bootstrap'|'upgrade';status:EnvironmentBatchStatus;closedAt:ISOTime|null}
export interface EnvironmentStepInput {stage:EnvironmentStage;batchId:string;at:ISOTime;context:unknown;modelContractVersion?:0|1}
export interface SchoolWeekTextResult {stage:'school_week';noticeTexts:Array<{key:string;text:string}>;weekNotes:Array<{weekStart:string;conflictNotes:string[]}>}
export type LegacySchoolWeekResult={stage:'school_week';instanceChanges:SchoolInstanceCandidate[];noticeCandidates:SchoolNoticeCandidate[];weekChanges:SchoolWeekCandidate[]};
export type EnvironmentModelResult = {stage:'world';changes:EnvironmentChange[]}|{stage:'school_campus'|'school_group';planChanges:SchoolPlanChange[];itemChanges:SchoolItemChange[]}|LegacySchoolWeekResult|SchoolWeekTextResult;
export type EnvironmentChangeSet = {stage:'world';changes:EnvironmentChange[]}|{stage:'school_campus'|'school_group';plans:SchoolPlan[];items:SchoolPlanItem[]}|{stage:'school_week';instances:SchoolInstance[];notices:SchoolNotice[];weeks:SchoolWeek[]};
export interface EnvironmentStep {preparationSnapshot?:import('./snapshot').EnvironmentPreparationSnapshot|null;preparationVersion?:0|1;preparationGeneration?:number;staleReason?:string|null;id:string;batchId:string;stage:EnvironmentStage;status:EnvironmentStepStatus;attempt:number;startedAt:ISOTime|null;completedAt:ISOTime|null;retryAt:ISOTime|null;lastError:string|null;inputSnapshot:EnvironmentStepInput|null;frozenResult:EnvironmentChangeSet|null}
export interface EnvironmentGenerationOptions {signal?:AbortSignal;modelOptions?:import('../memory/types').ModelRunOptions;schoolView?:import('../school/read-view').SchoolReadView}
export type EnvironmentGenerator = (input:EnvironmentStepInput,options?:EnvironmentGenerationOptions)=>Promise<EnvironmentModelResult>;

export type EnvironmentStepMetadata=Pick<EnvironmentStep,'id'|'batchId'|'stage'|'status'|'retryAt'>;
