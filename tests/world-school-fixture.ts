import type { SchoolPlanItem, SchoolPlan } from '../src/school/types';
import { NOW } from './helpers';
export const schoolPlan:SchoolPlan={id:'semester',owner:'campus',kind:'semester',title:'在读研究生学期',startsOn:'2026-09-01',endsOn:'2027-01-20',summary:'以研究为主，可零常规课程',revision:1,status:'active'};
export function schoolItem(change:Partial<SchoolPlanItem>={}):SchoolPlanItem {
 return {id:'meeting',planId:'semester',owner:'campus',kind:'meeting',title:'大班会',description:'学期安排说明',location:'学院',requirement:'required',issuedAt:NOW,timing:{kind:'once',startsAt:'2026-10-09T14:00:00+08:00',endsAt:'2026-10-09T15:00:00+08:00'},noticePolicy:{announceOnIssue:true,announceOnChange:true,reminders:[{kind:'local_days_before',offset:1,source:'institution'},{kind:'minutes_before',offset:120,source:'institution'}]},revision:1,deliveryRevision:1,status:'open',basis:'fiction',sourceUrls:[],...change};
}
