import type { Message } from '../types';
export interface DialogueEpisode { id:string;openedAt:string;lastInteractionAt:string;status:'open'|'closed';closedAt:string|null;closeReason:'idle'|'migration'|null }
export interface DialogueActivityLink { id:string;episodeId:string;status:'active'|'ended'|'legacy_span';startedAt:string|null;endedAt:string|null;evidenceFrom:string|null;evidenceTo:string|null }
export interface DialogueTurnBinding { episodeId:string|null;holdReply:boolean }
export interface DialogueRecent { episodeIds:string[];messages:Message[] }
export interface DialogueConsistencyReport { version:1|2|null;orphanMessageIds:string[];invalidAssociationIds:string[];currentConflict:boolean;unfinishedTurnIds:string[];activityErrors:string[];blockingIssues:string[];historicalWarnings:string[] }
export type ChatEpisode=DialogueEpisode;
export type ChatTurnBinding=DialogueTurnBinding;
export type ChatRecent=DialogueRecent;
export interface ChatIndexMetadata {id:'chat-index';idleMinutes:number}
export interface ActivityContextSelection {activityId:string;at:string;messageIds:string[]}
export interface WindowConsistencyReport {version:1|2|null;ordinaryAssociationErrors:string[];activityErrors:string[];legacyInflightErrors:string[];blockingIssues:string[];historicalWarnings:string[];protectedMessageIds:string[]}

export type ChatEligibility='ordinary_narrative'|'with_visible_inputs';
export interface ChatWindowSnapshot {messages:readonly Message[];episodes:readonly ChatEpisode[]}

export interface ActiveWindowScope {touchedMessageIds:readonly string[];requiredMessageIds:readonly string[];sourceIds:readonly string[];touchedEpisodeIds:readonly string[]}
