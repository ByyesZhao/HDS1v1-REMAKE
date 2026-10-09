import {it,expect} from 'vitest';
import {setup,NOW} from '../../../../tests/helpers';
import {schoolItem} from '../../../../tests/world-school-fixture';
import {schoolExpansionInput,resolveSchoolWeekText} from '../../../../src/school/calendar';
import {applySchoolChanges} from '../../../../src/school/changes';
import {releaseSchoolNotices,selectSchoolNotices,schoolNoticeDeadline,schoolNotificationEligible} from '../../../../src/school/notices';
import {prepareSchoolCommits,applySchoolCommits} from '../../../../src/school/progress';
import {personalSchoolContext} from '../../../../src/school/context';
import {narrative} from '../../../../tests/helpers';
import {ensureEnvironmentBatch,selectEnvironmentStep} from '../../../../src/environment/scheduler';
import {runEnvironmentStep} from '../../../../src/environment/runtime';

it('audit: reading the V1 issue does not unlock the known item personal reminder',async()=>{
 const d=setup();
 const item=schoolItem({noticePolicy:{announceOnIssue:true,announceOnChange:true,reminders:[{kind:'minutes_before',offset:120,source:'personal_reminder'}]}});
 d.storage.save('school_plan_items',item.id,item);
 d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});
 const batch=ensureEnvironmentBatch(d.storage,d.config,NOW)!;
 for(const step of d.environmentStore.steps(batch.id))if(step.stage!=='school_week')d.environmentStore.saveStep({...step,status:'committed'});
 const step=selectEnvironmentStep(d.storage,NOW)!;
 await runEnvironmentStep(d,step.id,async frozen=>{
  expect(frozen.modelContractVersion).toBe(1);
  const input=frozen.context as ReturnType<typeof schoolExpansionInput>;
  return {stage:'school_week',noticeTexts:input.requiredNoticeKeys.map(n=>({key:n.id,text:'班会在10月9日14点，提前两小时提醒。'})),weekNotes:[]};
 });
 releaseSchoolNotices(d.storage,NOW);
 const issue=d.schoolStore.notices().find(n=>n.kind==='issue')!;
 expect(issue.payload.snapshots.map(s=>s.entityKind)).toEqual(['plan_item']);
 const ref={noticeId:issue.id,deliveryRevision:issue.deliveryRevision};
 const e={id:'read-issue',happenedAt:NOW,description:'阅读了班会通知并得知准确时间',relatedEventIds:[]};
 const commits=prepareSchoolCommits(d.storage,{id:'first',at:NOW,schoolNoticeRefs:[ref]} as any,{...narrative,experiences:[e],schoolObservations:[{via:'notice',sourceId:issue.id,experienceIndex:0}]},[e]);
 applySchoolCommits(d.storage,{schoolNoticeRefs:[ref],schoolObservations:commits.observations,schoolProgress:[],experiences:[e]} as any,'first');
 expect(d.storage.read('school_notices',issue.id)?.status).toBe('read');
 expect(d.schoolStore.knowledge()).toHaveLength(1);
 const reminder=d.schoolStore.notices().find(n=>n.kind==='reminder')!;
 expect(reminder.payload.snapshots.map(s=>s.entityKind)).toEqual(['plan_item','instance']);
 const at='2026-10-09T12:00:00+08:00';
 releaseSchoolNotices(d.storage,at);
 expect(d.schoolStore.notices().find(n=>n.id===reminder.id)?.status).toBe('scheduled');
 expect(selectSchoolNotices(d.storage,at)).toEqual([]);
 expect(schoolNotificationEligible(d.storage,at)).toBe(false);
 expect(schoolNoticeDeadline(d.storage,at)).toBeNull();
 d.storage.close();
});

it('audit: observing an ongoing old instance rolls back a just-read course correction',()=>{
 const d=setup(),early='2026-10-07T08:00:00+08:00',correctionAt='2026-10-07T09:15:00+08:00',readAt='2026-10-07T09:20:00+08:00',onsiteAt='2026-10-07T09:30:00+08:00';
 const item=schoolItem({issuedAt:early,kind:'course',timing:{kind:'weekly',startsOn:'2026-10-01',endsOn:null,slots:[{slotKey:'wed',weekday:3,start:'09:00',end:'11:00'}]}});
 const expandAt=(at:string)=>{const input=schoolExpansionInput(d.storage,at,d.config.timezone);applySchoolChanges(d.storage,resolveSchoolWeekText(d.storage,{stage:'school_week',noticeTexts:input.requiredNoticeKeys.map(n=>({key:n.id,text:'课程安排'})),weekNotes:[]},input,at),at);};
 d.storage.save('school_plan_items',item.id,item);expandAt(early);
 const ongoing=d.schoolStore.instances()[0];
 applySchoolChanges(d.storage,{stage:'school_campus',plans:[],items:[{...item,revision:2,deliveryRevision:2,location:'下次起用新教室'}]},correctionAt);expandAt(correctionAt);releaseSchoolNotices(d.storage,readAt);
 const notice=d.schoolStore.notices().find(n=>n.kind==='change')!;
 d.storage.set('character',{...d.storage.character(),narratedUntil:correctionAt});
 const readExperience={id:'read-e',happenedAt:readAt,description:'读到课程更正，今后用新教室',relatedEventIds:[]};
 const readResult=prepareSchoolCommits(d.storage,{id:'read',at:readAt,schoolNoticeRefs:[{noticeId:notice.id,deliveryRevision:2}]} as any,{...narrative,experiences:[readExperience],schoolObservations:[{via:'notice',sourceId:notice.id,experienceIndex:0}]},[readExperience]);
 applySchoolCommits(d.storage,{schoolObservations:readResult.observations,schoolProgress:[],experiences:[readExperience]} as any,'read');
 expect(personalSchoolContext(d.storage,[],'').knownSnapshots.find(s=>s.entityKind==='plan_item')?.revision).toBe(2);
 d.storage.set('character',{...d.storage.character(),narratedUntil:readAt});
 const onsiteExperience={id:'onsite-e',happenedAt:onsiteAt,description:'在原教室参与今天已经开始的课次',relatedEventIds:[ongoing.id]};
 const onsiteResult=prepareSchoolCommits(d.storage,{id:'onsite',at:onsiteAt,schoolNoticeRefs:[]} as any,{...narrative,experiences:[onsiteExperience],schoolObservations:[{via:'onsite',sourceId:ongoing.id,experienceIndex:0}]},[onsiteExperience]);
 applySchoolCommits(d.storage,{schoolObservations:onsiteResult.observations,schoolProgress:[],experiences:[onsiteExperience]} as any,'onsite');
 expect(personalSchoolContext(d.storage,[],'').knownSnapshots.find(s=>s.entityKind==='plan_item')).toMatchObject({revision:1,value:{location:'学院'}});
 d.storage.close();
});

