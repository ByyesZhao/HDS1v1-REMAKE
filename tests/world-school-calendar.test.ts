import {it,expect} from 'vitest';
import {setup,NOW} from './helpers';
import {schoolItem,schoolPlan,expand} from './world-school-fixture';
import {schoolExpansionInput,resolveSchoolWeek} from '../src/school/calendar';
import {applySchoolChanges} from '../src/school/changes';
it('friday_next_week_monday_confirm_same_slot_same_week_id_no_duplicate',()=>{
 const d=setup();d.storage.save('school_plans',schoolPlan.id,schoolPlan);d.storage.save('school_plan_items','meeting',schoolItem({kind:'course',timing:{kind:'weekly',startsOn:'2026-09-01',endsOn:'2027-01-20',slots:[{slotKey:'mon-am',weekday:1,start:'09:00',end:'10:00'}]}}));
 expect(schoolExpansionInput(d.storage,NOW,d.config.timezone).weekStarts).toEqual(['2026-10-05']);expand(d,'2026-10-09T06:00:00+08:00');const next=d.schoolStore.instances().find(i=>i.weekStart==='2026-10-12')!;expect(next).toBeDefined();expand(d,'2026-10-12T06:00:00+08:00');expect(d.schoolStore.instances().filter(i=>i.occurrenceKey===next.occurrenceKey)).toHaveLength(1);const before=d.schoolStore.notices().length;expand(d,'2026-10-12T06:00:00+08:00');expect(d.schoolStore.notices()).toHaveLength(before);d.storage.close();
});
it('move_preserves_occurrence_and_internal_note_no_reminder_storm',()=>{
 const d=setup(),item=schoolItem();d.storage.save('school_plan_items',item.id,item);expand(d);const old=d.schoolStore.instances()[0];
 d.storage.transaction(()=>applySchoolChanges(d.storage,{stage:'school_campus',plans:[],items:[{...item,revision:2,deliveryRevision:2,timing:{kind:'once',startsAt:'2026-10-09T16:00:00+08:00',endsAt:null}}]},NOW));
 expect(d.schoolStore.notices().filter(n=>n.status!=='invalidated')).toHaveLength(0);expand(d);const updated=d.schoolStore.instances()[0];expect(updated.id).toBe(old.id);expect(updated.startsAt).toContain('16:00');const count=d.schoolStore.notices().length;
 d.storage.save('school_plan_items',item.id,{...updated.sourceSnapshot,revision:3,stageInfo:'内部检查'});expand(d);expect(d.schoolStore.notices()).toHaveLength(count);d.storage.close();
});
it('far_future_issue_today_and_tentative_no_two_hour_guess',()=>{
 const d=setup();d.storage.save('school_plan_items','meeting',schoolItem({kind:'research',timing:{kind:'deadline',at:'2027-01-10T17:00:00+08:00',date:null,note:'科研要求'}}));const input=expand(d);expect(input.requiredNoticeKeys.some(n=>n.kind==='issue')).toBe(true);expect(d.schoolStore.notices().find(n=>n.kind==='issue')!.publishAt).toBe(NOW);
 d.storage.save('school_plan_items','tentative',schoolItem({id:'tentative',timing:{kind:'tentative',startsOn:'2026-11-01',endsOn:null,note:'待定'}}));const pending=schoolExpansionInput(d.storage,NOW,d.config.timezone);expect(pending.requiredOccurrences.filter(o=>o.sourceItemId==='tentative')).toEqual([]);expect(pending.requiredNoticeKeys.filter(n=>n.sourceItemId==='tentative').map(n=>n.kind)).toEqual(['issue']);d.storage.close();
});
it('local_day_offset_and_conflicts_are_not_forced_choices',()=>{
 const d=setup(),item=schoolItem();d.storage.save('school_plan_items',item.id,item);d.storage.save('school_plan_items','other',schoolItem({id:'other'}));const input=schoolExpansionInput(d.storage,NOW,d.config.timezone);expect(Date.parse(input.requiredNoticeKeys.find(n=>n.kind==='reminder'&&n.reminderKey.includes('local_days_before'))!.publishAt)).toBe(Date.parse('2026-10-08T14:00:00+08:00'));expect(input.conflicts.length).toBeGreaterThan(0);expect(d.storage.all('tasks')).toEqual([]);d.storage.close();
});
it('read_only_old_version_requires_correction_and_candidate_commit_covers_not_week_marker',()=>{
 const d=setup(),item=schoolItem();d.storage.save('school_plan_items',item.id,item);expand(d);const issue=d.schoolStore.notices().find(n=>n.kind==='issue')!;d.storage.save('school_notices',issue.id,{...issue,status:'read',releasedAt:NOW,readAt:NOW,readTurnId:'old'});
 d.storage.transaction(()=>applySchoolChanges(d.storage,{stage:'school_campus',plans:[],items:[{...item,revision:2,deliveryRevision:2,location:'新教室'}]},NOW));const input=schoolExpansionInput(d.storage,NOW,d.config.timezone);expect(input.requiredNoticeKeys.some(n=>n.kind==='change')).toBe(true);
 expect(()=>resolveSchoolWeek(d.storage,{stage:'school_week',instanceChanges:[],noticeCandidates:[],weekChanges:[]},input,NOW)).toThrow(/required/);expand(d);expect(schoolExpansionInput(d.storage,NOW,d.config.timezone).requiredNoticeKeys.some(n=>n.kind==='change')).toBe(false);expect(d.storage.read('school_notices',issue.id)!.payload.snapshots[0].value).toMatchObject({location:item.location});d.storage.close();
});
it('cancel_requires_cancellation_disabled_policy_not_forced',()=>{
 const d=setup(),item=schoolItem();d.storage.save('school_plan_items',item.id,item);expand(d);d.storage.transaction(()=>applySchoolChanges(d.storage,{stage:'school_campus',plans:[],items:[{...item,revision:2,deliveryRevision:2,status:'cancelled'}]},NOW));expect(schoolExpansionInput(d.storage,NOW,d.config.timezone).requiredNoticeKeys.some(n=>n.kind==='cancel')).toBe(true);
 d.storage.save('school_plan_items',item.id,{...item,status:'cancelled',revision:2,deliveryRevision:2,noticePolicy:{...item.noticePolicy,announceOnChange:false}});expect(schoolExpansionInput(d.storage,NOW,d.config.timezone).requiredNoticeKeys.some(n=>n.kind==='cancel')).toBe(false);d.storage.close();
});
it('overdue_setup_single_meaningful_notice_and_future_draft_not_in_digest',()=>{
 const d=setup(),item=schoolItem({issuedAt:'2026-10-01T06:00:00+08:00',timing:{kind:'once',startsAt:'2026-10-07T10:30:00+08:00',endsAt:null}});d.storage.save('school_plan_items',item.id,item);
 expect(schoolExpansionInput(d.storage,NOW,d.config.timezone).requiredNoticeKeys.map(n=>n.kind)).toEqual(['issue']);
 d.storage.save('school_plan_items','future',schoolItem({id:'future',issuedAt:'2026-10-08T06:00:00+08:00',timing:{kind:'weekly',startsOn:'2026-10-01',endsOn:null,slots:[{slotKey:'thu',weekday:4,start:'09:00',end:'10:00'}]}}));
 expect(schoolExpansionInput(d.storage,NOW,d.config.timezone).requiredNoticeKeys.some(n=>n.kind==='week_digest')).toBe(false);d.storage.close();
});
it('onsite_known_and_previously_released_invalidated_notice_keep_correction_obligation',()=>{
 const d=setup(),item=schoolItem({issuedAt:'2026-12-01T06:00:00+08:00'});d.storage.save('school_plan_items',item.id,item);expand(d);const notice=d.schoolStore.notices().find(n=>n.kind==='issue')!;
 d.storage.save('school_notices',notice.id,{...notice,status:'invalidated',releasedAt:NOW});d.storage.save('school_plan_items',item.id,{...item,revision:2,deliveryRevision:2,description:'更正'});
 expect(schoolExpansionInput(d.storage,NOW,d.config.timezone).requiredNoticeKeys.find(n=>n.kind==='change')?.publishAt).toBe(NOW);
 d.storage.remove('school_notices',notice.id);d.storage.save('school_knowledge','known',{id:'known',entityKind:'plan_item',entityId:item.id,revision:1,snapshot:{entityKind:'plan_item',entityId:item.id,revision:1,value:item},acquiredAt:NOW,experienceId:'e',turnId:'t',via:'onsite'});
 expect(schoolExpansionInput(d.storage,NOW,d.config.timezone).requiredNoticeKeys.some(n=>n.kind==='change')).toBe(true);d.storage.close();
});
import {ModelClient} from '../src/model/client';
import {schoolWeekTask} from '../src/school/contracts';

it('reschedule_format_repair_uses_current_source_revision_not_old_instance',async()=>{
 const d=setup();d.storage.save('school_plan_items','meeting',schoolItem());expand(d);
 d.storage.save('school_plan_items','meeting',schoolItem({revision:2,deliveryRevision:2,location:'新教室'}));
 const input=schoolExpansionInput(d.storage,NOW,d.config.timezone);let calls=0;
 const client=new ModelClient({complete:async request=>{
  calls++;const corrected=request.repair?.errors.includes('expectedRevision must be 2');
  return {stage:'school_week',instanceChanges:input.requiredOccurrences.map(o=>({occurrenceKey:o.occurrenceKey,sourceItemId:o.sourceItemId,expectedRevision:corrected?2:1})),noticeCandidates:input.requiredNoticeKeys.map(n=>({key:n.id,text:'新通知',entityRefs:n.entityIds.map(entityId=>({entityKind:'plan_item',entityId}))})),weekChanges:[]};
 }});
 const result=await client.runModel(schoolWeekTask(input),input);
 expect(calls).toBe(2);expect((result as any).instanceChanges[0].expectedRevision).toBe(2);d.storage.close();
});
