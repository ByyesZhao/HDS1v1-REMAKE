import type {SchoolExpansionInput} from '../src/school/types';
import type {EnvironmentModelResult} from '../src/environment/types';
export function weekResult(input:SchoolExpansionInput):import('../src/environment/types').LegacySchoolWeekResult{
 return {stage:'school_week',instanceChanges:input.requiredOccurrences.map(o=>({occurrenceKey:o.occurrenceKey,sourceItemId:o.sourceItemId,expectedRevision:input.sourceItems.find(i=>i.id===o.sourceItemId)!.revision})),noticeCandidates:input.requiredNoticeKeys.map(n=>({key:n.id,text:'学校模拟通知 '+n.kind,entityRefs:n.entityIds.map(entityId=>({entityKind:'plan_item' as const,entityId}))})),weekChanges:input.weekStarts.map(weekStart=>({weekStart,sourceVersions:Object.fromEntries(input.sourceItems.map(i=>[i.id,i.revision])),conflictNotes:input.conflicts}))};
}
