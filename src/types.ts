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
  dialogueEpisodeId?: string;
}
export interface Runtime {
  dialogueContextVersion?:1|null;activeDialogueEpisodeId?:string|null;
  openBatch: { id: string; readyAt: ISOTime } | null; pendingBatchIds: string[]; paused: boolean;
  contactMisses: number; stickerMisses: number; nextWorldAt: ISOTime | null; nextSchoolAt: ISOTime | null;
  lastError: string | null;
  nextMaintenanceAt: string | null;
  sharedActivityVersion: 1 | null; sharedClock: SharedClock | null;
  environmentPlanningVersion:1|null; nextEnvironmentAt:ISOTime|null;
  memoryCapacityVersion?:1|null; memoryIdle?:import('./memory/types').MemoryIdleState|null;
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
  dialogueBinding?:import('./dialogue/types').DialogueTurnBinding;
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
