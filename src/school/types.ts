import type { ISOTime, Scene } from '../types';
export type SchoolOwner = 'campus' | 'group';
export interface SchoolPlan { id:string; owner:SchoolOwner; kind:'semester'|'group'; title:string; startsOn:string; endsOn:string|null; summary:string; revision:number; status:'active'|'archived' }
export type SchoolTiming =
 | {kind:'once'; startsAt:ISOTime; endsAt:ISOTime|null}
 | {kind:'weekly'; startsOn:string; endsOn:string|null; slots:{slotKey:string;weekday:number;start:string;end:string}[]}
 | {kind:'tentative'; startsOn:string; endsOn:string|null; note:string}
 | {kind:'deadline'; at:ISOTime|null; date:string|null; note:string};
export interface SchoolReminder {kind:'local_days_before'|'minutes_before';offset:number;source:'institution'|'personal_reminder'}
export interface SchoolNoticePolicy {announceOnIssue:boolean;announceOnChange:boolean;reminders:SchoolReminder[]}
export interface SchoolPlanItem {
 id:string;planId:string;owner:SchoolOwner;kind:'course'|'exam'|'meeting'|'event'|'research'|'invitation'|'holiday'|'milestone'|'legacy';
 title:string;description:string;location:string;requirement:'required'|'optional';issuedAt:ISOTime;timing:SchoolTiming;noticePolicy:SchoolNoticePolicy;
 revision:number;deliveryRevision:number;status:'open'|'cancelled'|'closed';basis:'fiction'|'web_reference';sourceUrls:string[];
 responsible?:string;deliverable?:string;stageInfo?:string;
}
export interface SchoolInstance {id:string;sourceItemId:string;sourceRevision:number;deliveryRevision:number;occurrenceKey:string;weekStart:string|null;startsAt:ISOTime;endsAt:ISOTime|null;sourceSnapshot:SchoolPlanItem;status:'active'|'cancelled'|'archived';needsExpansion:boolean;legacyEventId:string|null}
export type SchoolEntitySnapshot = {entityKind:'plan_item';entityId:string;revision:number;value:SchoolPlanItem}|{entityKind:'instance';entityId:string;revision:number;value:SchoolInstance};
export interface SchoolNotice {id:string;sourceItemId:string|null;instanceId:string|null;weekStart:string|null;deliveryRevision:number;kind:'issue'|'change'|'cancel'|'reminder'|'week_digest';reminderKey:string;channel:'institution'|'personal_reminder';publishAt:ISOTime;releasedAt:ISOTime|null;payload:{text:string;snapshots:SchoolEntitySnapshot[]};status:'scheduled'|'available'|'read'|'invalidated';nextWakeAt:ISOTime|null;readAt:ISOTime|null;readTurnId:string|null}
export interface SchoolNoticeRef {noticeId:string;deliveryRevision:number}
export interface SchoolKnowledge {id:string;entityKind:SchoolEntitySnapshot['entityKind'];entityId:string;revision:number;snapshot:SchoolEntitySnapshot;acquiredAt:ISOTime;experienceId:string;turnId:string;via:'notice'|'onsite'}
export interface SchoolProgress {id:string;taskId:string;kind:'progress'|'completed'|'feedback';experienceId:string;turnId:string;happenedAt:ISOTime;summary:string}
export interface SchoolWeek {id:string;weekStart:string;sourceVersions:Record<string,number>;checkedAt:ISOTime;digestRevision:number;conflictNotes:string[]}
export interface SchoolObservation {via:'notice'|'onsite';sourceId:string;experienceIndex:number}
export interface ResearchProgressDraft {taskId:string;kind:SchoolProgress['kind'];experienceIndex:number;summary:string}
export interface SchoolObservationCommit {via:'notice'|'onsite';sourceId:string;snapshots:SchoolEntitySnapshot[];happenedAt:ISOTime;experienceId:string}
export interface SchoolProgressCommit {taskId:string;kind:SchoolProgress['kind'];summary:string;happenedAt:ISOTime;experienceId:string}
export interface PreparedSchoolCommits {observations:SchoolObservationCommit[];progress:SchoolProgressCommit[];visibleSnapshots:SchoolEntitySnapshot[]}
export interface NarrativeSchoolContext {objectiveInstances:SchoolInstance[];noticeSnapshots:SchoolNotice[];knownSnapshots:SchoolEntitySnapshot[];eventIds:string[]}
export interface PersonalSchoolContext {knownSnapshots:SchoolEntitySnapshot[]}
export type SchoolPlanDraft = Omit<SchoolPlan,'id'|'revision'>;
export type SchoolItemDraft = Omit<SchoolPlanItem,'id'|'revision'|'deliveryRevision'>;
export type SchoolPlanChange = {action:'create';clientRef:string;plan:SchoolPlanDraft}|{action:'update';id:string;expectedRevision:number;plan:Partial<SchoolPlanDraft>};
export type SchoolItemChange = {action:'create';clientRef:string;item:SchoolItemDraft}|{action:'update';id:string;expectedRevision:number;item:Partial<SchoolItemDraft>}|{action:'cancel';id:string;expectedRevision:number};
export interface RequiredOccurrence {occurrenceKey:string;sourceItemId:string;weekStart:string|null;startsAt:ISOTime;endsAt:ISOTime|null}
export interface RequiredNotice {id:string;sourceItemId:string|null;occurrenceKey:string|null;weekStart:string|null;deliveryRevision:number;kind:SchoolNotice['kind'];reminderKey:string;channel:SchoolNotice['channel'];publishAt:ISOTime;entityIds:string[]}
export interface SchoolExpansionInput {weekStarts:string[];sourceItems:SchoolPlanItem[];existingInstances:SchoolInstance[];existingNotices:SchoolNotice[];knownSnapshots:SchoolEntitySnapshot[];coveredVersions:Record<string,number>;requiredOccurrences:RequiredOccurrence[];requiredNoticeKeys:RequiredNotice[];conflicts:string[]}
export interface SchoolInstanceCandidate {occurrenceKey:string;sourceItemId:string;expectedRevision:number}
export interface SchoolNoticeCandidate {key:string;text:string;entityRefs:{entityKind:SchoolEntitySnapshot['entityKind'];entityId:string}[]}
export interface SchoolWeekCandidate {weekStart:string;sourceVersions:Record<string,number>;conflictNotes:string[]}
