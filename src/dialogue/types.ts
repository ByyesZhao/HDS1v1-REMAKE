import type { Message } from '../types';
export interface DialogueEpisode { id:string;openedAt:string;lastInteractionAt:string;status:'open'|'closed';closedAt:string|null;closeReason:'idle'|'migration'|null }
export interface DialogueActivityLink { id:string;episodeId:string;status:'active'|'ended'|'legacy_span';startedAt:string|null;endedAt:string|null;evidenceFrom:string|null;evidenceTo:string|null }
export interface DialogueTurnBinding { episodeId:string|null;holdReply:boolean }
export interface DialogueRecent { episodeIds:string[];messages:Message[] }
export interface DialogueConsistencyReport { version:1|null;orphanMessageIds:string[];invalidAssociationIds:string[];currentConflict:boolean;unfinishedTurnIds:string[];activityErrors:string[];blockingIssues:string[];historicalWarnings:string[] }
