# HDSI V0.2：接口、存储与代码组织

> 历史累积文档：2026-10-09起当前架构说明由[V0.5总架构](../../../v0.5/architecture/REMAKE_V0.5.md)及其子系统文档替代。本文保留各次修改、旧规则和当时证据，不再作为当前系统入口；请勿将旧正文与最新规则混用。

提示词／上下文V0.1现状：普通聊天默认最近4个完整普通段，普通双方实际消息后空闲15分钟关闭，当前计入；共同活动整体不占4段、不刷新普通锚点。活动工作阶段使用本场完整授权原文；结束后由逐轮短期记忆统一检索召回，跨结束未读输入仍直接可见。关闭普通段仍可在4段窗口内，无30条二次裁剪。模型资料按身份合池和阶段职责投影；无新来源免记忆整理，明确超限报错暂停且不自动裁剪。历史测试数字只描述原交付。本期入口：[实施细化](../../topics/prompt-context/PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_20261008.md)、[实施日志](../../topics/prompt-context/PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)。


状态：2026-10-07 已按实现核对。V0.2基线及记忆V0.3代码已完成；最新检查见记忆实施记录；真实 QQ 与完整故事路径待联调。本文记录当前接口与行为，不把模型提示要求写成已经实现的语义保证。

返回 [总架构](REMAKE_V0.2.md)；配套 [实施细化与开发记录](REMAKE_V0.2_IMPLEMENTATION.md)、[实施记录](../../topics/initial-implementation/IMPLEMENTATION_LOG.md)。回合冻结、发送和提交边界见[恢复专题](REMAKE_V0.2_RECOVERY.md)。


共同活动V0.3于2026-10-08按新细化实施；当前离线证据见[共同活动实施记录](../../topics/shared-activity/SHARED_ACTIVITY_V0.3_IMPLEMENTATION_LOG_20261007.md)。真实模型多轮语义、正式库升级和QQ收发仍待独立验收。

## 1. 数据传输原则

程序内部传输 TypeScript 对象，模型返回 JSON。模型合同由 `src/model/contracts.ts` 的 Zod Schema 及额外控制校验组成，提示词在 `src/model/prompts.ts`。时间、模式、动作枚举和引用 ID 等参与程序判断；叙事、思想、活动描述与回复保留自由字符串。普通Zod对象去除未声明字段；共同叙事采用strict，明确拒绝模型nextStepAt等额外字段。未声明字段不能视作业务已使用。

时间使用带时区的 ISO 8601，允许 `Z` 或显式偏移，例如 `2026-10-07T12:00:00+08:00`。程序比较转换为时间戳，不按字符串排序；日程生成与状态显示使用配置时区，当前为 `Asia/Shanghai`。跨日睡眠保存完整起止日期；程序产生的时间可以是 UTC 表示，不要求每个存储字符串都写成 `+08:00`。

睡眠区间、场景模式和活动手机条件共同决定消息接收，不让不同模型重复输出独立的 `can_receive_message`。模型职责、意图保持、事实依据等语义要求主要依靠提示词；代码中有明确校验或门禁的规则在下文单列，不声称程序能够核验自由叙事真假。

## 2. 共享类型

实际维护入口是src/types.ts、src/memory/types.ts及src/web/types.ts，下面为记忆及搜索阶段后的代码快照。Storage的旧Memory读取形状只用于迁移，V0.3正式检索与应用使用MemoryCandidate／MemoryResultV3。

```ts
export type ISOTime = string;
export type Mode = 'chat' | 'shared_online' | 'shared_offline';
export type Energy = '精力充沛' | '正常' | '疲惫' | '精疲力尽';
export interface Clock { now(): ISOTime }
export interface Random { next(): number }
export interface Activity { description: string; startsAt: ISOTime; expectedEndAt: ISOTime | null; phoneAccess: boolean }
export interface Emotion { label: string; degree: string; reason: string }
export interface SharedOutline { goal: string; openThreads: string[]; endingCondition: string }
export interface SharedScene {
  activityId: string; title: string; progress: string; lastPublicNode: string;
  completedSteps: number; maxSteps: number; idleSeconds: number;
  outline: SharedOutline | null; nextStepAt: ISOTime | null;
}
export interface SharedClock {
  activityId: string; mode: Exclude<Mode, 'chat'>; status: 'active' | 'ended'; startedAt: ISOTime;
  lastInputAt: ISOTime | null; lastOutputAt: ISOTime | null; lastSilentCompletedAt: ISOTime | null;
}
export interface ControlRequest {
  id: string; activityId: string | null; receivedAt: ISOTime; platformMessageIds: string[];
  status: 'pending' | 'consumed' | 'cancelled'; consumedTurnId: string | null;
}
export interface SharedTurnMeta {
  activityId: string; stepNumber: number; maxSteps: number; idleSeconds: number;
  advanceReason: 'initial' | 'manual' | 'automatic' | 'appointment';
  phase: 'opening' | 'ongoing' | 'wrap_up' | 'final'; controlRequestIds: string[];
  sceneTaskId: string; allowSimulatedUserActions: boolean;
}
export interface InputAcceptance { kind: 'message' | 'advance'; systemReply: string | null }
export interface Scene {
  mode: Mode; description: string; activity: Activity | null;
  shared: SharedScene | null;
}
export interface CharacterState {
  narratedUntil: ISOTime; scene: Scene; emotions: Emotion[];
  energy: { level: Energy; reason: string };
  sleep: null | { sleepAt: ISOTime; wakeAt: ISOTime };
  nextAutonomousAt: ISOTime | null; plan: string;
}
export interface IncomingMessage { id: string; receivedAt: ISOTime; content: string; platformMessageIds?: string[] }
export interface Message {
  id: string; platformMessageIds: string[]; direction: 'incoming' | 'outgoing';
  receivedAt: ISOTime; content: string; batchId: string | null; seenTurnId: string | null;
  turnId: string | null; outboxSeq: number | null;
  sharedActivityId?: string | null;
}
export interface Runtime {
  openBatch: { id: string; readyAt: ISOTime } | null; pendingBatchIds: string[]; paused: boolean;
  contactMisses: number; stickerMisses: number; nextWorldAt: ISOTime | null; nextSchoolAt: ISOTime | null;
  lastError: string | null;
  nextMaintenanceAt: string | null;
  sharedActivityVersion: 1 | null; sharedClock: SharedClock | null;
  environmentPlanningVersion:1|null; nextEnvironmentAt:ISOTime|null;
}
export interface Experience { id: string; happenedAt: ISOTime; description: string; relatedEventIds: string[] }
export interface NarrativeResult {
  schoolObservations?:import('./school/types').SchoolObservation[];researchProgress?:import('./school/types').ResearchProgressDraft[];
  experiences: Array<Omit<Experience, 'id'>>;
  currentScene: { description: string; activity: Activity | null };
  energy: CharacterState['energy'];
}
export interface SharedNarrativeResult extends NarrativeResult { publicNarration: string | null; progress: string; outline: SharedOutline; simulatedUserActions: string[] }
export type SpeechPart = { kind: 'text' | 'action'; content: string };
export interface UtteranceIntent { intention: string; draft: string; actions?: string[] }
export type ReplyDecision = ({ decision: 'now' } & UtteranceIntent) | { decision: 'later'; reconsiderAt: ISOTime; intention: string } | { decision: 'none' };
export type ContactDecision = ({ willing: true } & UtteranceIntent) | { willing: false };
export interface SleepPreference { reason: string; sleepAt: ISOTime | null; wakeAt: ISOTime | null }
export type SharedChange = { action: 'start'; mode: Exclude<Mode, 'chat'>; title: string } | { action: 'end' };
export interface PersonalOptions { nextPlan?: string | null; sleepPreference?: SleepPreference; sharedChange?: SharedChange; stickerIntent?: string }
export interface ChatPersonalResult extends PersonalOptions { emotions: Emotion[]; reply: ReplyDecision; taskChanges: TaskChange[] }
export interface LifePersonalResult extends PersonalOptions { emotions: Emotion[]; innerThought: string; contact: ContactDecision; taskChanges?: TaskChange[] }
export type PersonalResult = ChatPersonalResult | LifePersonalResult;
export interface ExpressionResult { parts: SpeechPart[] }
export type TaskKind = 'appointment' | 'check_messages' | 'scene_step';
export interface TaskDetails { kind: TaskKind; at: ISOTime; description: string; checkReason?: 'unread' | 'deferred_reply'; messageIds?: string[] }
export interface ScheduledTask extends TaskDetails { id: string; status: 'pending' | 'completed' | 'cancelled'; sharedActivityId?: string }
export type TaskChange = { action: 'create'; task: TaskDetails; id?: string } | { action: 'update'; id: string; task: Partial<TaskDetails> } | { action: 'cancel'; id: string };
export interface MemorySummary { content: string; topics: string[]; sourceIds: string[] }
export type MemoryResult = import('./memory/types').MemoryResultV3;
export interface Memory extends MemorySummary { id: string; kind: 'short' | 'long'; importance: 'normal' | 'high'; mentions: number; createdAt: ISOTime; reinforcedAt: ISOTime; turnId: string }
export interface Detail { key: string; value: string; aliases: string[]; effectiveAt: ISOTime }
export interface DetailHistory { id: string; key: string; previousValue: string | null; newValue: string; effectiveAt: ISOTime; reason: string; sourceIds: string[]; turnId: string }
export interface EnvironmentEvent { id: string; kind: 'world' | 'school'; startsAt: ISOTime; endsAt: ISOTime | null; description: string; basis: 'fiction' | 'web_reference'; sourceUrls: string[]; status: 'active' | 'cancelled' }
export type EnvironmentChange = { action: 'create'; event: Omit<EnvironmentEvent, 'id' | 'status'>; id?: string } | { action: 'update'; id: string; event: Partial<Omit<EnvironmentEvent, 'id' | 'status'>> } | { action: 'cancel'; id: string };
export interface EnvironmentResult { changes: EnvironmentChange[] }
export interface Sticker { id: string; path: string; description: string; aliases?: string[]; embeddingInput?: string; embedding: number[]; embeddingModel: string; embeddingBaseUrl?: string; legacyFingerprint?: string }
export type TriggerKind = 'input' | 'autonomous' | 'sleep' | 'activity' | 'appointment' | 'check_messages' | 'scene_step' | 'environment'|'school_notification';
export interface TurnRequest { schoolNoticeRefs?:import('./school/types').SchoolNoticeRef[];environmentStepId?:string; inputMessageIds: string[]; taskIds: string[]; triggerKinds: TriggerKind[]; batchIds?: string[]; environmentKind?: 'world' | 'school'; sharedMeta?: SharedTurnMeta | null }
export interface TurnRecord {
  id: string; inputMessageIds: string[]; triggerTaskIds: string[]; triggerKinds: TriggerKind[];
  at: ISOTime; completedAt: ISOTime | null; frozenResult: TurnCandidate | null; outputComplete: boolean; done: boolean;
  batchIds: string[]; entryMode: Mode; environmentKind?: 'world' | 'school';
  sharedMeta?: SharedTurnMeta | null; autonomousIntervalMinutes?: number | null;
  legacyDisposition?:'superseded';closedAt?:ISOTime;replacementBatchId?:string;
  schoolNoticeRefs?:import('./school/types').SchoolNoticeRef[];
}
export interface TurnCandidate {
  schoolObservations?:import('./school/types').SchoolObservationCommit[];schoolProgress?:import('./school/types').SchoolProgressCommit[];
  visibleMessageIds: string[]; reconsiderMessageIds: string[];
  narrative: NarrativeResult | SharedNarrativeResult | null; personal: PersonalResult | null; expression: ExpressionResult | null;
  experiences: Experience[]; nextState: CharacterState; taskChanges: TaskChange[]; completedTaskIds: string[];
  probability: { contactMisses: number; stickerMisses: number }; autonomousIntervalMinutes: number | null;
  environmentChanges: EnvironmentChange[]; nextEnvironmentAt?: ISOTime;
  schoolNoticeRefs?:import('./school/types').SchoolNoticeRef[];
}
export interface OutboxItem { turnId: string; seq: number; kind: 'narration' | 'text' | 'action' | 'sticker'; payload: string; status: 'pending' | 'sending' | 'retry' | 'confirmed'; confirmedAt: ISOTime | null; platformMessageIds: string[]; notBefore: ISOTime | null }
export interface PostJob { turnId: string; result: MemoryResult | null; memoryIds?:Record<string,string>; selfWebReadSources?:import('./memory/types').SelfWebReadSource[] }
export interface Sender { sendItem(item: OutboxItem): Promise<{ platformMessageIds: string[] }>; sendError(message: string): Promise<void> }
export interface HistoryContext { recent: Message[]; shortTerm: Memory[]; longTerm: Memory[]; details: Detail[]; detailHistory: DetailHistory[] }
export interface ModelTask<T> { name: string; schema: unknown; prompt: string; parse(value: unknown): T }
export interface ModelRunner { runModel<T>(task: ModelTask<T>, input: unknown, options?: import('./memory/types').ModelRunOptions): Promise<T> }
import type { Message, DetailHistory } from '../types';

export interface MemoryOwnerRef { ownerType: 'short'|'long'|'detail'|'learned'; ownerId: string }
export interface OwnerVersion extends MemoryOwnerRef { revision: number; stateVersion: number }
export interface MemoryCandidate extends OwnerVersion {
  id: string; kind: MemoryOwnerRef['ownerType']; content: string; sourceIds: string[]; createdAt: string;
  topics: string[]; status: 'active'|'merged'|'durable'|'discarded'; mergedInto: string|null;
  importance: 'normal'|'high'; eventSummary: string; feelingSummary: string;
  happenedAt: string; lastEventUpdateAt: string; shortExpiresAt: string|null; linkedLongId: string|null;
  retainedFrom: string|null; expiresAt: string|null; summaryQuality: 'preview'|'refined';
  totalAwakenings: number; windowAwakenings: number; legacyMentions: number;
  evaluatedEvidenceVersion: number|null; consolidatedRevision: number|null;
  key?: string; value?: string; aliases?: string[]; effectiveAt?: string;
  canonicalMemoryId?: string; alwaysInclude?: boolean; learnedKind?: 'durable_experience'|'stable_understanding';
  projectionBasis?:{content:string;sourceIds:string[];revision:number};
  normalizedVector?: Float32Array;
}
export interface ContextLimits {
  historyBudget: number|null; alwaysIncludeCharactersLimit: number|null; candidateItemsPerRoute: number|null;
  detailItemsLimit: number|null; shortItemsLimit: number|null; longItemsLimit: number|null; recentDialogueSegments: number; dialogueIdleMinutes: number;
}
export const defaultContextLimits: ContextLimits = {historyBudget:null,alwaysIncludeCharactersLimit:null,candidateItemsPerRoute:null,detailItemsLimit:null,shortItemsLimit:null,longItemsLimit:null,recentDialogueSegments:4,dialogueIdleMinutes:15};
export interface RetrievalStats { queries:number; cacheHits:number; remoteRequests:number; timeouts:number; failures:number; lexicalFallbacks:number; startedAt:string }
export interface RetrievalPermissions { allowArchive:boolean; allowDetailHistory:boolean; visibleSourceIds:string[] }
export interface RetrievalRequest { query:string; at:string; phase:string; scope:'current'|'archive'; includeDetailHistory:boolean; permissions:RetrievalPermissions; budget:number|null }
export type LookupRequest = string | {query:string; scope:'current'|'archive'; includeDetailHistory:boolean};
export interface RetrievedContext { recent:Message[]; detailHistory:DetailHistory[]; details:MemoryCandidate[]; shortTerm:MemoryCandidate[]; longTerm:MemoryCandidate[]; learned:MemoryCandidate[] }
export interface AwakeningInput { id:string; turnId:string; at:string; sourceIds:string[]; reason:string; allowedIds:string[]; allowedSourceIds:string[] }
export interface SelfWebReadSource { id:string; turnId:string; runId:string; operationId:string; materialId:string; url:string; readAt:string; sourceKind:'self_web_read'; phase:'personal_life' }
export interface RetentionGrant {id:string; canonicalMemoryId:string; kind:'initial'|'migration'|'renew'|'reactivate'; anchorAt:string; expiresAt:string; triggerDates:string[]}
export interface Awakening {canonicalMemoryId:string; localDate:string; firstEffectiveAt:string; turnId:string; sourceIds:string[]}
export interface IndexJob {id:string; owner:OwnerVersion; text:string; configSignature:string; createdAt:string; status:'pending'|'computing'|'ready'|'done';retryAt:string|null;completedAt:string|null;completionReason:'applied'|'stale'|null; result?:number[];lastError?:string|null}
export interface IndexResult {jobId:string;owner:OwnerVersion;configSignature:string;normalizedVector:Float32Array}
export interface MaintenanceUnit {unitKey:string;action:'refine'|'merge'|'discard'|'promote'|'retain';readSet:OwnerVersion[];ids:string[];canonicalId?:string;content?:string;eventSummary?:string;feelingSummary?:string;sourceIds:string[];learnedKind?:'durable_experience'|'stable_understanding';alwaysInclude?:boolean;reason?:string}
export interface MaintenanceJob {id:string;cutoff:string;createdAt:string;status:'pending'|'computing'|'ready'|'done';snapshot:MemoryCandidate[];selectedIds?:string[];readSet:OwnerVersion[];result:MaintenanceUnit[]|null;appliedUnitKeys:string[];staleUnitKeys:string[];retryAt:string|null;lastError:string|null}
export interface ModelRunOptions {signal?:AbortSignal;lookup?:((request:LookupRequest)=>Promise<unknown>)|null;runRef?:import('../web/types').ModelRunRef;web?:import('../web/types').WebSearchSession|null}
export interface ShortCreate {action:'create';clientRef:string;content:string;eventSummary:string;feelingSummary:string;topics:string[];sourceIds:string[];importance:'normal'|'high';existingLongId?:string;happenedAt?:string}
export interface ShortUpdate {action:'update';id:string;content:string;eventSummary:string;feelingSummary:string;topics:string[];sourceIds:string[];hasNewEventProgress:boolean}
export interface MemoryResultV3 {schemaVersion:3;shortTermChanges:Array<ShortCreate|ShortUpdate>;longTermChanges:Array<{action:'awaken';id:string;reason:string;sourceIds:string[]}>;detailChanges:Array<{action:'create'|'update';key:string;value:string;aliases:string[];reason:string;sourceIds:string[]}>}
import type { SelfWebReadSource } from '../memory/types';
export type { SelfWebReadSource };
export interface ModelRunRef {runId:string;ownerType:'turn'|'maintenance'|'asset';ownerId:string;stageKey:string;taskName:string;ordinal:number}
export interface WebSearchRequest {query:string;requestedPages?:number}
export interface WebMaterial {id:string;url:string;title:string;body:string;readAt:string;bodyCharacters:number;selectionMode:'full_body'|'relevant_passages';sourceKind:'external_reference'}
export interface WebSearchCounters {successReads:number;failures:number}
export interface WebOperationOptions {operationId:string;signal?:AbortSignal}
export interface WebSearchResponse {materials:WebMaterial[];counters:WebSearchCounters;stopReason:'quota'|'satisfied'|'no_candidates'|null;failures?:Array<{reason:string;url?:string}>}
export type WebOperationRequest={kind:'search';request:WebSearchRequest}|{kind:'read';url:string};
export interface WebOperationRecord {operationId:string;runId:string;request:WebOperationRequest;candidateUrls:string[]|null;nextCandidateIndex:number;status:'pending'|'running'|'done';materialIds:string[];failures:Array<{reason:string;url?:string}>;confirmedSteps:number[];response:WebSearchResponse|null}
export interface WebModelCheckpoint {input:unknown;repairCount:number;lookupUsed:boolean;pendingOperationId:string|null;toolResults:WebSearchResponse[];privateLookupResult?:unknown;repair?:{original:unknown;errors:string}}
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

```

```ts
import type { Message, DetailHistory } from '../types';

export interface MemoryOwnerRef { ownerType: 'short'|'long'|'detail'|'learned'; ownerId: string }
export interface OwnerVersion extends MemoryOwnerRef { revision: number; stateVersion: number }
export interface MemoryCandidate extends OwnerVersion {
  id: string; kind: MemoryOwnerRef['ownerType']; content: string; sourceIds: string[]; createdAt: string;
  topics: string[]; status: 'active'|'merged'|'durable'|'discarded'; mergedInto: string|null;
  importance: 'normal'|'high'; eventSummary: string; feelingSummary: string;
  happenedAt: string; lastEventUpdateAt: string; shortExpiresAt: string|null; linkedLongId: string|null;
  retainedFrom: string|null; expiresAt: string|null; summaryQuality: 'preview'|'refined';
  totalAwakenings: number; windowAwakenings: number; legacyMentions: number;
  evaluatedEvidenceVersion: number|null; consolidatedRevision: number|null;
  key?: string; value?: string; aliases?: string[]; effectiveAt?: string;
  canonicalMemoryId?: string; alwaysInclude?: boolean; learnedKind?: 'durable_experience'|'stable_understanding';
  normalizedVector?: Float32Array;
}
export interface ContextLimits {
  historyBudget: number|null; alwaysIncludeCharactersLimit: number|null; candidateItemsPerRoute: number|null;
  detailItemsLimit: number|null; shortItemsLimit: number|null; longItemsLimit: number|null; recentDialogueSegments: number; dialogueIdleMinutes: number;
}
export const defaultContextLimits: ContextLimits = {historyBudget:null,alwaysIncludeCharactersLimit:null,candidateItemsPerRoute:null,detailItemsLimit:null,shortItemsLimit:null,longItemsLimit:null,recentDialogueSegments:4,dialogueIdleMinutes:15};
export interface RetrievalStats { queries:number; cacheHits:number; remoteRequests:number; timeouts:number; failures:number; lexicalFallbacks:number; startedAt:string }
export interface RetrievalPermissions { allowArchive:boolean; allowDetailHistory:boolean; visibleSourceIds:string[] }
export interface RetrievalRequest { query:string; at:string; phase:string; scope:'current'|'archive'; includeDetailHistory:boolean; permissions:RetrievalPermissions; budget:number|null }
export type LookupRequest = string | {query:string; scope:'current'|'archive'; includeDetailHistory:boolean};
export interface RetrievedContext { recent:Message[]; detailHistory:DetailHistory[]; details:MemoryCandidate[]; shortTerm:MemoryCandidate[]; longTerm:MemoryCandidate[]; learned:MemoryCandidate[] }
export interface AwakeningInput { id:string; turnId:string; at:string; sourceIds:string[]; reason:string; allowedIds:string[]; allowedSourceIds:string[] }
export interface SelfWebReadSource { id:string; turnId:string; runId:string; operationId:string; materialId:string; url:string; readAt:string; sourceKind:'self_web_read'; phase:'personal_life' }
export interface RetentionGrant {id:string; canonicalMemoryId:string; kind:'initial'|'migration'|'renew'|'reactivate'; anchorAt:string; expiresAt:string; triggerDates:string[]}
export interface Awakening {canonicalMemoryId:string; localDate:string; firstEffectiveAt:string; turnId:string; sourceIds:string[]}
export interface IndexJob {id:string; owner:OwnerVersion; text:string; configSignature:string; createdAt:string; status:'pending'|'computing'|'ready'|'done';retryAt:string|null;completedAt:string|null;completionReason:'applied'|'stale'|null; result?:number[];lastError?:string|null}
export interface IndexResult {jobId:string;owner:OwnerVersion;configSignature:string;normalizedVector:Float32Array}
export interface MaintenanceUnit {unitKey:string;action:'refine'|'merge'|'discard'|'promote'|'retain';readSet:OwnerVersion[];ids:string[];canonicalId?:string;content?:string;eventSummary?:string;feelingSummary?:string;sourceIds:string[];learnedKind?:'durable_experience'|'stable_understanding';alwaysInclude?:boolean;reason?:string}
export interface MaintenanceJob {id:string;cutoff:string;createdAt:string;status:'pending'|'computing'|'ready'|'done';snapshot:MemoryCandidate[];selectedIds?:string[];readSet:OwnerVersion[];result:MaintenanceUnit[]|null;appliedUnitKeys:string[];staleUnitKeys:string[];retryAt:string|null;lastError:string|null}
export interface ModelRunOptions {signal?:AbortSignal;lookup?:((request:LookupRequest)=>Promise<unknown>)|null}
export interface ShortCreate {action:'create';clientRef:string;content:string;eventSummary:string;feelingSummary:string;topics:string[];sourceIds:string[];importance:'normal'|'high';existingLongId?:string;happenedAt?:string}
export interface ShortUpdate {action:'update';id:string;content:string;eventSummary:string;feelingSummary:string;topics:string[];sourceIds:string[];hasNewEventProgress:boolean}
export interface MemoryResultV3 {schemaVersion:3;shortTermChanges:Array<ShortCreate|ShortUpdate>;longTermChanges:Array<{action:'awaken';id:string;reason:string;sourceIds:string[]}>;detailChanges:Array<{action:'create'|'update';key:string;value:string;aliases:string[];reason:string;sourceIds:string[]}>}

```

## 3. 一次模型任务的上下文与配置

按任务装配上下文，不建立包含全部历史的全局 prompt。当前实际输入如下，完整装配见 `src/app.ts`、`src/directors/world.ts` 和 `src/memory/organize.ts`。

| 任务 | 实际主要字段 |
| --- | --- |
| 世界／学校 | 冻结EnvironmentStepInput(stage/batchId/at/context)；world为公共事件，campus/group为完整身份背景及所属计划，group另含带experienceId进展；week为SchoolExpansionInput必需集合与预约时段。无完整私聊列表或旧身份正则 |
| 主叙事 | `from / at / background / state / waking / events / dueTasks / recent / history`；共同场景额外传visibleMessages/sharedMeta/remainingSteps；工厂末尾另传previousOutline |
| 个人导演 | `at / background / state / experiences / visibleMessages / reconsiderMessages / dueTasks / tasks / events / history / contactEligible` |
| 表达 | `intent / mode / state / visibleMessages / history / chatExamples` |
| 记忆整理 | `at / background / experiences / visibleMessages / reconsiderMessages / outgoing / arrangementsAndIntent / details / retrieved`；retrieved 为相关短期／长期／按需常驻记忆 |

环境输入没有独立的地点或前次简报字段；既有信息由设定与 active 事件提供。叙事和个人导演收到的 `events` 包括未来安排，并非只含已到期事件；`dueTasks` 才是本轮选定的到期任务。`HistoryContext` 包含近期原文、短期／长期记忆、当前细节及按需历史，具体检索见[记忆方案](REMAKE_V0.2_MEMORY.md)。记忆整理单独构造 `{ details, retrieved }`，只对实际使用字段计算可选historyBudget，默认null；不把未使用的近期原文纳入整理预算。

普通私聊的主叙事不读取本轮新消息正文；检索查询也不含该正文。主叙事先更新过去经历和当前处境，旁白再决定可见消息。共同场景读取本次选择的真实输入，不等待普通合批、不套手机或旧睡眠计划门禁；结束共同活动也不撤销本轮已见输入。普通睡眠中的新故事轮不运行个人导演；调度器会将已明确不可接收的单纯输入暂存，规则见[生活方案](REMAKE_V0.2_LIFE.md)。

### 连续输入接口

Koishi 入口只接收绑定机器人与用户之间的私聊，解析并拼接 text 元素，忽略无有效文字的消息。当前不保存完整平台消息结构或图片／语音等非文字内容；`hdsi.status / pause / resume` 管理命令绕过故事输入。

`InputBuffer.acceptInput(): Promise<InputAcceptance>`先精确分类【推进】，控制记录独立返回systemReply；共同原文立即关联活动、batchId=null并刷新clock。普通路径在同一事务先结算过期批次，再保存消息和 `runtime.openBatch = { id, readyAt }`，截止为末条 `receivedAt + 15 秒`。消息通过 `messages.batchId` 归属批次，到期批次 ID 进入 `pendingBatchIds`；不存在含消息副本的 `InputBatch` 对象或独立批次表。

旧轮发送／后处理期间仍立即接收新消息。它们不加入旧轮已选定的闭合批次，但可以继续加入当前开放的新批次。回合通过 `inputMessageIds / batchIds` 引用原记录；已入轮、已看和批次等待是不同状态，未看消息不会因批次已处理而删除。重启使用保存的截止时间，不重新等待完整 15 秒。

### 逐任务模型连接

`settings.ts` 从 `config.local.json` 加载十二个独立故事／后台任务：`narrative / narrative_shared / personal_chat / personal_life / personal_shared / expression / memory / memory_consolidation / world / school_campus / school_group / school_week`；素材描述另用第十三项 `stickerDescriptionModel`。配置键 `stickerDescriptionModel` 对应运行任务名 `sticker_description`。各连接支持 `model / baseUrl / apiKeyEnv / outputMode / reasoningEffort`。

- 模型允许 `deepseek-flash / deepseek-v4-flash / deepseek-v4-pro`，每项可独立改为 Pro。
- `reasoningEffort` 允许 `none / low / high / max`，省略时默认为 `high`，HTTP 字段为 `reasoning_effort`。
- 当前部署十一项均为 `deepseek-flash`；`memory`、`memory_consolidation` 与 `sticker_description` 为 `high`，其余八项为 `low`。这是部署选择，不是限制独立配置的代码规则。
- `outputMode` 默认为 `json_object`；也支持 `json_schema`（`strict:false`）或 `prompt`。这些选项仍须由供应商支持，最终由本地合同校验输出。
- Embedding 使用独立的 `baseUrl / apiKeyEnv / model / dimensions`，dimensions 缺省为 1024，不使用 DeepSeek 的任务推理强度。

`backgroundFile` 相对配置文件所在目录解析，读取后作为 `settings.background`；正式初始化、叙事、个人导演和记忆均使用该加载结果。开发样例与正式库分开。凭据由配置同目录的 `key.txt` 加载到环境变量，已有环境值优先；连接对象在调用时解析 key，HTTP 仅将其用于 Authorization header，不把凭据加入提示词或保存回配置。配置及模型连通情况见[实施记录](../../topics/initial-implementation/IMPLEMENTATION_LOG.md)。

## 4. 环境事件

world使用 `EnvironmentResult { changes }`，以稳定事件 ID 增量 `create / update / cancel`；没有单独按日期存储的简报文件。create 的模型 event 不含 ID/status，程序生成 ID 并保存 `active`；update 合并指定旧事件的部分字段；cancel 保存 `cancelled`。通常只把 active 事件传回模型。

`environmentTask()` 校验变更 ID 属于当前导演种类、事件 kind 正确、结束不早于开始。`basis / sourceUrls` 由模型输出，程序要求所有 URL 来自本次提供材料，并要求 `web_reference` 至少包含一个 URL；不会自动替模型推断来源或核验报道真假。提示词要求无材料时使用 fiction 和空来源、有材料时保留报道／传闻的不确定措辞。

事件存在不表示角色已知道或参加；环境回合不写角色经历、不更新 `narratedUntil`。主叙事是否把未来安排误写成已发生经历，除经历时间等控制检查外，仍依赖其语义提示要求。

## 5. 主叙事输出

普通NarrativeResult不变；共同SharedNarrativeResult新增必填outline及simulatedUserActions，保留publicNarration/progress，删除模型可写nextStepAt。工厂narrativeTask及runNarrative原参数后追加sharedMeta，再追加previousOutline（wrapper在options后）；共同必传meta，普通兼容。

保留经历时间、环境引用、当前活动时间校验。权限false清单必须空；清单每个非空文本必须原文在公开旁白中。wrap_up且previousOutline非null时，每个openThreads都必须属于旧字符串集合；首节点null可建立走向。final必须openThreads=[]及非空公开旁白，个人sharedChange=end。goal/endingCondition不做字符串等值假语义审核，提示词及真实多轮验收约束漂移。

候选更新progress/outline及非空lastPublicNode；nextStepAt仅由sharedDeadline计算，并投影到唯一scene:activityId。公开正文裸字符串，发送统一【】；真实用户【动作：…】原样传入。narrativeTask依据冻结allowSimulatedUserActions选择互斥提示：静默可实现双方活动动作，有输入禁止新增用户动作、角色配合由个人决定。simulatedUserActions只列用户；角色台词、心理及后续意图仍交个人导演。静默代写公开共享模拟经历不推成真实用户固定属性。

## 6. 个人导演输出

调用前选定一份合同，不要求模型同时输出 reply 和 contact。

| 回合合同 | 必需字段 | 按需字段 |
| --- | --- | --- |
| personal_chat / personal_shared | `emotions / reply / taskChanges` | `nextPlan / sleepPreference / sharedChange / stickerIntent` |
| personal_life | `innerThought / emotions / contact` | `taskChanges` 及上述可选字段 |

共同场景优先；普通模式有实际可见新消息、到期预约或当前可接收的延后回复检查时使用聊天合同；其余需要个人导演的回合用私人生活合同。只收到尚不可见消息不强制使用聊天合同，单纯待看检查在更新场景后仍不可接收时可以不调用个人导演。共同任务与聊天任务共用结构但保留独立提示及模型配置。

`emotions` 始终完整替换，`[]` 清空；维持时需输出原列表。`nextPlan` 缺省或 null 沿用旧文字意图，字符串替换 plan，不直接设置当前活动或登记任务。

`reply.now` 与 `contact.willing=true` 必须有 `intention / draft`，可有 actions；none/later/不愿联系不需要草稿。表达模型仅在实际决定输出后调用：回复 now 直接进入表达，主动联系先经过资格和抽样。未命中的主动草稿不是已发对话。

提示词要求 `contactEligible=false` 时 `willing=false`，但这不是 Schema 的关联强校验。程序使用门禁 `contactEligible && contact.willing`：不符合资格的意图不抽样、不增加 contactMisses、不进入表达。主动资格要求自主触发、普通模式、没有实际可见消息和到期预约、清醒且可接收；普通回复不抽主动联系概率。

`reply.later` 的 reconsiderAt 必须晚于 at。旁白创建或更新 deferred_reply 检查，保存已看消息 ID 与 intention，届时重新判断而不机械发送旧草稿；再次延后更新检查，不改回未读。已有共同活动必须先结束才能开始另一项，普通模式不能结束不存在的共同活动；这些模式规则有代码校验。确认现在开始、不能仅凭未来邀约切换等语义由提示词约束。

`sleepPreference` 的 reason 不被算法解析。已有区间时，仅 reason 和 null 时间不会改变作息；具体 sleepAt/wakeAt 可调整对应值。尚无区间或起床安排下一晚时，按习惯及体力抽取区间；次日早间预约减去准备时间可提前 wakeAt。两个偏好时间都有值时合同检查先后关系，最终安排还要求 wakeAt 晚于 sleepAt。不能将“只说想早睡就自动改变时间”视作已实现能力。

每个实际角色叙事前台轮冻结一次自主间隔，首次freeze同时保存TurnRecord.autonomousIntervalMinutes，未尝试稿重生成也复用。段B从completedAt重排，普通睡眠清空；环境／无叙事控制轮为null。个人shared工厂及wrapper在原参数末尾（wrapper在options后）追加sharedMeta，再追加本轮publicNarration?: string | null；首节点非空开场，final要求end，提前end也要求已有非空公开正文，空正文可修补为暂缓end；所有个人合同禁止create/update/cancel scene_step。

## 7. 到期任务与变更

当前任务为 `appointment / check_messages / scene_step`。TaskChange.create 的内部可选 id 由程序补充，模型只提供完整 task；update 提供指定 ID 和部分字段；cancel 提供 ID。模型变更需引用已存在任务，同一输出不得重复修改同一旧 ID。

check_messages 必须具有 checkReason 与 messageIds；当前模型校验还要求引用本次可见／重新考虑集合中的消息 ID。个人导演 create/update 合并后的最终 check_messages.at 必须晚于本轮 at，错误走既有格式修补；此限制不影响处理既有到期任务、取消任务或程序维护检查。unread 用于首次交付，deferred_reply 用于重新考虑已看消息。旁白自动维护这些检查及场景节点，模型合同也接受全部三种 TaskKind；不能写成“只有旁白能输出检查任务”。预约正常不使用检查字段，但代码未禁止非检查任务携带可选的 checkReason/messageIds。

任务不保存独立 mode。约定预期线上／线下写在 description，实际开始由 sharedChange 确认；到期处理不表示已经参加。睡眠期间预约保留 pending，起床时一并协调。description 承载自然语言背景，checkReason 决定检查路径。

段 B 将 update 与原任务合并，省略字段沿用。显式 update/cancel 优先于本轮默认完成：update 保持 pending，cancel 保存 cancelled；无显式变更的已处理到期任务才变为 completed。例如仅改时间：

```json
{"action":"update","id":"lunch-01","task":{"at":"2026-10-07T13:00:00+08:00"}}
```

调度器读取自主时间、睡眠边界、环境时间和任务截止。不可接收活动的预计结束通过待看／延后检查安排；没有相应检查任务时，活动结束本身不创建独立故事轮。`activity` 是 TriggerKind 中保留的类型值，当前调度器没有生成它的路径。私人文字计划不产生定时任务。

## 8. 记忆整理输出

当前MemoryResult是schemaVersion=3，详细字段直接见上面MemoryResultV3。shortTermChanges=create/update；longTermChanges只awaken；details仍create/update。非空当前来源、程序ID、revision/stateVersion、预备摘要、7/90/3/30、SQL检索及维护单元见[记忆落地](REMAKE_V0.2_MEMORY.md)。

post job保存clientRef→短期ID映射和程序查阅来源；正式应用与turn.done同事务。旧reinforce／mentions合同不再解析。记忆输入retrieved包含合格短期、长期和按需常驻，整理仅预算自身使用的details/retrieved，默认null。details值相同跳过、值改变空别名沿用、现值及历史同事务。

memory_consolidation接收snapshot及selectedIds，返回closed/disjoint units；程序从readOwners补stateVersion，全部选中事件须有结果。lookup=null不能补查正式库，网页外部依据已接入独立maintenance session，不改变固定快照／readSet及本地lookup=null。

## 9. 独立表达模型与表情包

表达使用 `ExpressionResult { parts: SpeechPart[] }`，读取确定意图、草稿、动作、情绪、模式、事实及聊天范例。保持核心信息、承诺与动作选择，只微调语气和分段，属于提示约束；代码不做独立语义审核。裸动作正文、不在 text 塞动作包装也由提示要求，解析器只检查 kind/content 类型，不检测重复包装。

应用过滤空白段，将公开旁白、开始标志、角色短段、素材和结束标志转换为 OutboxItem[]；实际发送接口是 `Sender.sendItem(item)`，不是直接把 SpeechPart[] 交给平台。动作展示为 `【动作：……】`，旁白展示为 `【……】`，文字经平台标记转义。共同开始标志先发，公开节点先于角色反应，结束标志在本轮活动输出之后。

首个 text/action 无额外等待；后续 text/action 按下一段裸正文可见字素数计算 3～10 秒，旁白和素材不增加自身等待。首角色段前已有旁白仍直接发。计数、区间与公式见[生活方案](REMAKE_V0.2_LIFE.md#32-回复分段与发送节奏)。程序不机械截断表达段落。

每个输出项独立确认；整稿及清单在首次发送前冻结。一旦有发送尝试，恢复保持表达稿，不再次调用表达；全轮尚未尝试且输出未完成时允许重做，详见恢复专题。记忆按实际确认记录读取整组输出，不对每个短段单独整理。

启用素材后，每条非线下角色 text 短段抽样一次，命中才以该文字及可选 stickerIntent 检索，取最高余弦项，不设阈值。stickerIntent 不决定抽样资格；严肃文字也不排除。素材紧接对应文字，一轮可多项；动作、旁白、用户输入、素材和恢复重发不抽样，线下开始／结束轮的角色文字均排除。计数在候选中计算并在段 B 提交。

Sticker 保存路径、描述、向量、模型，可保留 aliases、embeddingInput、embeddingBaseUrl、legacyFingerprint。启用前检查非空、模型、维度及双方已记录的 endpoint；改变向量配置后需显式 rebuild。重建使用 embeddingInput，否则使用 description，保留 ID/aliases 并清除旧 fingerprint。`HttpEmbeddingProvider` 请求配置的 dimensions。

`output/stickers.ts` 负责向量、兼容检查、重建和检索；`scripts/stickers.ts` 负责新图视觉描述与导入。旧目录导入由 `deployment/sticker-catalog.ts` 和 `scripts/import-catalog.ts` 核对身份、复制图片并事务写库，重复导入沿用 assetId。图片文件仍需保留；不自动收集用户发来的图片。首次发送前冻结的是素材 ID，不是图片字节快照。

## 10. SQLite 存储

当前使用Node内置node:sqlite单个DatabaseSync连接，Node>=22.13。state为key/data，十二张业务表（含control_requests）为id/data，JSON TEXT保存对象；另有六张记忆辅助表，形状见记忆落地。同步事务保存故事，不通过Koishi数据库适配器，也没有第二份JSON故事状态。

| 表 | 实际内容 |
| --- | --- |
| state | character、runtime、首次初始化的 background 快照；runtime 含批次、暂停、错误、概率和环境截止时间 |
| events | 世界／学校 active/cancelled 事件 |
| experiences | 已发生经历及相关事件 ID；公开旁白本身还保存在消息／outbox 中 |
| messages | 提取的用户文字、确认的旁白／文字／动作及素材占位，平台 ID、批次和已看引用 |
| turns | 选定输入、任务、触发、批次、进入模式、处理／完成时间、候选及完成状态 |
| outbox | 有序输出、发送状态、确认时间／平台 ID、notBefore |
| post_jobs | turnId 与 MemoryResult 或 null；无独立完成标记 |
| tasks | 预约、检查消息、场景节点及任务状态 |
| details | 每个 key 的当前值、别名、生效时间 |
| detail_history | 每次值变化的旧值／新值、来源、原因、回合及生效时间 |
| memories | 短期／长期摘要、主题、来源、重要度、提及次数与加强时间 |
| stickers | 素材文件路径、描述／别名、向量输入、向量及兼容元数据 |

作息、模型与其他部署配置从配置文件加载，不保存在 state 的“日常节奏配置”中。state.background 是初次初始化快照，当前模型实际使用本次加载的 settings.background；它不是重启后唯一的背景来源。初始状态、已知细节和事件只在库中尚无 character 时初始化，不迁移旧聊天记忆。

shared.ts同步接口：hasValidSharedScene、sharedRoutingActivity、sharedDeadline、refreshSharedStep、selectSharedMeta、recordSharedOutput、finishSharedTurn。写函数由调用方既有短事务包裹；不嵌套事务或调用模型。只读旧库检查与升级位于deployment/shared-upgrade.ts，CLI为shared:migrate。

### 恢复记录接口

第 2 节 TurnRecord.frozenResult 是 `TurnCandidate | null` 对象，统一由 Storage 序列化，不能把它当成另一个字符串 JSON 层。TurnCandidate 保存可见与重新考虑消息 ID、模型结果、经历、下一状态、任务变更、完成任务 ID、概率、已选自主间隔及环境变化。batchIds、entryMode 和 environmentKind 同样属于恢复记录。entryMode 当前只作入轮模式审计，未尝试稿重做按正式角色的当前 scene.mode 生成。

同一回合恢复沿用 ID。outbox 主键为 `${turnId}:${seq}`，并对 JSON 中的 `(turnId,seq)` 建唯一索引；post_jobs 主键及唯一业务关联均为 turnId。其他索引覆盖消息批次／未读、任务状态和截止、未完成回合、记忆种类和时间。

`at` 是开始生成时的实际时间，未尝试整稿重做时更新，续办已尝试稿时保持。`completedAt` 在段 B 与 done 一起保存；下一自主时间由这一完成时间加冻结间隔得出。环境候选虽有 nextEnvironmentAt，提交代码按 completedAt 重新计算下一环境截止。

PostJob.result 为 null 时，从冻结经历、可见消息和确认 outgoing 重建整理输入，并读取当前配置背景及检索资料；它不是包含全部模型上下文的独立快照。串行边界保证旧轮段 B 完成前不运行新故事轮。段 B 同事务写故事效果、done/completedAt 并清空 frozenResult，原消息、outbox、PostJob.result 和完成记录继续保留。后处理是否可执行由 `outputComplete && !done` 决定。

| 发送状态 | 含义与恢复 |
| --- | --- |
| pending | 从未尝试；全轮均为 pending 且输出未完成时可丢弃整稿重做 |
| sending | 调用前已持久化尝试；恢复入口将其转为 retry |
| retry | 曾尝试但未确认；恢复入口按序重发，调用前重新保存 sending |
| confirmed | 已获得非空平台 ID 并保存确认；恢复跳过 |

明确失败不退回 pending；任意发送尝试都会禁止丢弃整稿。上述自动续发发生在恢复入口获准运行之后：持久化 paused=true 时重启不会自行解除，需要 hdsi.resume。失败暂停和启动恢复条件详见恢复专题。

### 事务能力

Storage 启用 `journal_mode=WAL` 与 `synchronous=FULL`，使用同步 `BEGIN IMMEDIATE / COMMIT / ROLLBACK`；事务回调不接受异步 Promise。关键提交返回后才继续发送或进入下一阶段，网络、模型和等待在事务外。正式状态、经历、记忆、任务、已看、概率和回合完成使用同一连接提交。

`tests/storage.test.ts` 已覆盖普通写入后正常关闭重开、主动抛错回滚和 WAL/FULL 参数；尚未做硬件断电、磁盘缓存故障或段 B 每个写入位置的强杀注入。参数和普通事务测试不等于物理断电验收。

## 11. 当前代码组织

```text
src/
  index.ts                  Koishi 注册、目标私聊接入、平台发送与三条命令
  config.ts                 连接／应用配置类型和默认值
  settings.ts               配置解析、背景路径、凭据环境加载、逐任务连接
  time.ts                   时间戳、时区和日程计算
  app.ts                    回合生成、工作区及执行入口
  recovery.ts               冻结、发送续办、后处理及提交
  types.ts                  共享类型
  host/
    runtime.ts              串行泵、单一定时器、暂停／恢复／停止
    input.ts                输入落库和静默 15 秒合批
    scheduler.ts            到期选择、睡眠／未读暂存及下一截止
    state.ts                接收条件、作息、自主间隔及任务候选维护
    probability.ts          主动联系和表情概率曲线
  directors/
    world.ts / school.ts    公共环境和校园增量任务
    narrative.ts            普通／共同主叙事任务
    personal.ts             聊天／私人生活／共同个人任务
  memory/
    context.ts              历史装配和细节检索
    organize.ts             整理输入、记忆／细节／任务应用
  output/
    expression.ts           独立表达任务
    qq.ts                   字素计数、展示包装和发送间隔
    stickers.ts             向量、兼容检查、重建和检索
  model/
    client.ts               HTTP 调用、本地查询续调及格式修补
    contracts.ts            Zod Schema 和控制校验
    prompts.ts              语义职责和自然语言提示
  deployment/
    credentials.ts          本地 labelled key 文件到环境变量
    sticker-catalog.ts      旧素材身份核对、复制及事务导入
  storage.ts                SQLite JSON CRUD、索引和同步事务
scripts/
  stickers.ts               新素材描述／导入及显式重建
  import-catalog.ts         已有目录素材导入入口
```

导演是不同模型任务，不是四个持续独立运行的智能体。单进程串行执行一份故事，期间输入仍可立即落库。

## 12. 模型调用、本地查询与格式修补

Transport 向连接 baseUrl 下的 `/chat/completions` 发非流式请求，system 消息含任务提示与 JSON Schema，user消息含input、lookupResult、repair及本run的webMaterials／webResults／webStatus。图像描述任务把 imageDataUrl 转为 image_url 消息部分；API key 只在 Authorization header。正常任务使用 text 内容，返回 choices[0].message.content 再解析。

ModelClient 默认首次请求后最多两次格式修补。JSON 解析、Zod 或额外控制校验失败时，把原输出和错误字符串放入 `repair = { original, errors }`，再向同一任务请求完整结果。它不是字段级补丁合并，不保证自由文本逐字保留，也不为错误控制字段补默认值。repairLimit 是构造参数，当前未暴露为部署配置。

同一逻辑阶段最多一次合法lookupDetails，兼容字符串及结构化query/scope/includeDetailHistory；权限闭包及signal独立，后台lookup=null。网页工具独立循环，与本地查询共存，不消费格式修补次数；最多两次格式修补在session中持久化。没有工具时最多三次请求，加一次本地查询可为四次；启用网页后还有相应工具续调用，不能把四次当总上限。网页次数受独立20成功／40失败门禁约束，恢复不重置。

格式修补及查询续调都沿用该任务的模型和 reasoningEffort；已由 `tests/model-settings.test.ts` 覆盖独立 Flash/Pro 与强度传输、查询续调和修补。代码没有独立网络重试器；普通 complete 请求位于解析 try 外，其 HTTP／网络异常直接向上传播。查询续调及普通HTTP错误都直接上抛，不把容量／取消错误当格式修补；前台暂停，后台保存待办，不删内容重发。

回合执行中的模型、发送或后处理失败会持久化 paused=true 和 lastError，并尽力向 QQ 发送系统 `error`；发送该通知也可能失败，但不影响保存暂停阶段。系统通知不作为角色消息落入记忆，Koishi 与 QQ 连接继续运行。暂停跨重启保留；用户执行 hdsi.resume 才解除并先续办旧轮。纯进程退出且此前 paused=false 时，启动会恢复未完成回合。完整条件见[恢复专题](REMAKE_V0.2_RECOVERY.md)。


## 搜索离线核心落地（2026-10-07）

进程内唯一WebSearchService及四辅助表web_sessions/web_operations/web_materials/self_web_read_sources已接入。全部十三类任务独立run身份，阶段输入、补查、修补和工具请求检查点私有；公开正文缓存按owner释放，数据库材料保留恢复。同阶段重放计0，跨阶段首次取得各计1。正文响应成功后、最终parse前登记实际提供；personal_life的稳定来源及首次operationId进入post job。环境合同在最终parse读取providedUrls。后台共用既有120秒准备槽／signal，不阻塞前台，stop取消后不保存晚结果。

真实provider未配置，webSearch.enabled=false；当前未联网，待选服务后注入provider。网页无人工字符预算或12000截断，真实容量错误不删内容重试。来源语义、表达不新增事实和查阅不变亲历仍由任务提示约束，程序不冒称能判断散文真假。

证据：[搜索实施记录](../../topics/web-search/WEB_SEARCH_IMPLEMENTATION_LOG_20261007.md)、[审核交付入口](../../topics/initial-implementation/IMPLEMENTATION_HANDOFF_20261007.md)。



## 第七轮审核修正同步（2026-10-07）

当前记忆owner不保存／回传action、clientRef、existingLongId、hasNewEventProgress；happenedAt与可选happenedUntil保留已知事件时间范围，lastEventUpdateAt独立。archive及lookup不提前暴露预备长期。维护应用异常整笔回滚后保留ready结果、五分钟再应用，其他待办和聊天可继续。搜索不注入webSources或用其兜底，结果不足保存并向原阶段模型反馈“结果不足”，角色可自然询问用户；20／40及缓存B不变。最终42文件200项回归、类型／构建／离线加载／启动检查通过，独立复核未发现实质问题。详细依据与记录见docs/REVIEW7_FIX_IMPLEMENTATION_20261007.md及四份V0.3权威规范。

学校V0.4类型以src/school/types.ts、src/environment/types.ts和[细化](../../topics/world-school/WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_20261008.md)为准。学校不使用旧EnvironmentEvent合同创建新事项；旧school事件导入实例保持legacyEventId。EnvironmentChangeSet冻结ID，SchoolNoticeRef冻结通知版本，SchoolObservationCommit/SchoolProgressCommit随TurnCandidate进入原段B；旧environmentKind仅用于历史升级／审计，新请求用environmentStepId且不建普通turn。
