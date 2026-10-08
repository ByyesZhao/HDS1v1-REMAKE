import type { SchoolPlanItem, SchoolPlan } from '../src/school/types';
import { NOW,setup } from './helpers';
import {schoolExpansionInput,resolveSchoolWeek} from '../src/school/calendar';
import {applySchoolChanges} from '../src/school/changes';
export const schoolPlan:SchoolPlan={id:'semester',owner:'campus',kind:'semester',title:'在读研究生学期',startsOn:'2026-09-01',endsOn:'2027-01-20',summary:'以研究为主，可零常规课程',revision:1,status:'active'};
export function schoolItem(change:Partial<SchoolPlanItem>={}):SchoolPlanItem {
 return {id:'meeting',planId:'semester',owner:'campus',kind:'meeting',title:'大班会',description:'学期安排说明',location:'学院',requirement:'required',issuedAt:NOW,timing:{kind:'once',startsAt:'2026-10-09T14:00:00+08:00',endsAt:'2026-10-09T15:00:00+08:00'},noticePolicy:{announceOnIssue:true,announceOnChange:true,reminders:[{kind:'local_days_before',offset:1,source:'institution'},{kind:'minutes_before',offset:120,source:'institution'}]},revision:1,deliveryRevision:1,status:'open',basis:'fiction',sourceUrls:[],...change};
}

export function expand(d:ReturnType<typeof setup>,at=NOW){const input=schoolExpansionInput(d.storage,at,d.config.timezone);const result:any={stage:'school_week',instanceChanges:input.requiredOccurrences.map(o=>({occurrenceKey:o.occurrenceKey,sourceItemId:o.sourceItemId,expectedRevision:input.sourceItems.find(i=>i.id===o.sourceItemId)!.revision})),noticeCandidates:input.requiredNoticeKeys.map(n=>({key:n.id,text:n.kind+' 学校安排',entityRefs:n.entityIds.map(entityId=>({entityKind:'plan_item',entityId}))})),weekChanges:input.weekStarts.map(weekStart=>({weekStart,sourceVersions:Object.fromEntries(input.sourceItems.map(i=>[i.id,i.revision])),conflictNotes:input.conflicts}))};const resolved=resolveSchoolWeek(d.storage,result,input,at);d.storage.transaction(()=>applySchoolChanges(d.storage,resolved,at));return input;}
