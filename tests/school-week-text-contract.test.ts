import {it,expect} from 'vitest';
import {setup,NOW} from './helpers';
import {schoolItem} from './world-school-fixture';
import {schoolExpansionInput,resolveSchoolWeekText,schoolWeekTextInput} from '../src/school/calendar';
import {schoolWeekTextTask} from '../src/school/contracts';
import type {SchoolExpansionInput} from '../src/school/types';
function fixture(){const d=setup();d.storage.save('school_plan_items','class',schoolItem({id:'class',kind:'course',title:'系统课程',location:'教一301',timing:{kind:'weekly',startsOn:'2026-10-01',endsOn:'2026-11-01',slots:[{slotKey:'thu',weekday:4,start:'14:00',end:'15:00'},{slotKey:'fri',weekday:5,start:'09:00',end:'10:00'}]}}));return {d,input:schoolExpansionInput(d.storage,NOW,d.config.timezone)};}
const result=(input:SchoolExpansionInput)=>({stage:'school_week' as const,noticeTexts:input.requiredNoticeKeys.map(n=>({key:n.id,text:'隔离通知正文'})),weekNotes:[]});
it('required_occurrences_generated_without_model_copy; fixed_notice_entities_text_per_key; reminder_instance_id_matches_occurrence; empty_week_notes_cannot_erase_program_conflicts',()=>{
 const {d,input}=fixture();try{input.conflicts=['程序冲突不可抹去'];const text=schoolWeekTextTask(input).parse(result(input)),resolved=resolveSchoolWeekText(d.storage,text,input,NOW);expect(resolved.stage).toBe('school_week');if(resolved.stage!=='school_week')throw Error('stage');expect(resolved.instances).toHaveLength(input.requiredOccurrences.length);expect(resolved.weeks.every(w=>w.conflictNotes.includes('程序冲突不可抹去'))).toBe(true);
 for(const notice of resolved.notices.filter(n=>n.kind==='reminder')){const required=input.requiredNoticeKeys.find(n=>n.id===notice.id)!;const instance=resolved.instances.find(i=>i.occurrenceKey===required.occurrenceKey)!;expect(notice.instanceId).toBe(instance.id);expect(notice.payload.snapshots.some(s=>s.entityKind==='instance'&&s.entityId===instance.id)).toBe(true);}
 }finally{d.storage.close();}
});
it('notice_descriptor_targets_exact_occurrence_time_location; existing_occurrence_reminder_has_descriptor',()=>{
 const {d,input}=fixture();try{const descriptors=schoolWeekTextInput(input,'Asia/Shanghai').notices;const reminders=descriptors.filter(n=>n.kind==='reminder');expect(new Set(reminders.map(n=>n.occurrence?.startsAt)).size).toBe(2);expect(reminders.every(n=>n.occurrence?.location==='教一301'&&n.publishAt!==n.occurrence?.startsAt)).toBe(true);
 const changes=resolveSchoolWeekText(d.storage,result(input),input,NOW);if(changes.stage!=='school_week')throw Error('stage');input.existingInstances=changes.instances;input.requiredOccurrences=[];expect(schoolWeekTextInput(input,'Asia/Shanghai').notices.filter(n=>n.kind==='reminder').every(n=>n.occurrence?.instanceId)).toBe(true);
 }finally{d.storage.close();}
});
it('duplicate_or_missing_notice_key_rejected',()=>{const {d,input}=fixture();try{const task=schoolWeekTextTask(input),r=result(input);expect(()=>task.parse({...r,noticeTexts:[]})).toThrow(/missing/);expect(()=>task.parse({...r,noticeTexts:[...r.noticeTexts,r.noticeTexts[0]]})).toThrow(/duplicate/);}finally{d.storage.close();}});

import {applySchoolChanges} from '../src/school/changes';
it('after_projection_updates_notice_binding_and_snapshot_together_for_v1',()=>{
 const d=setup();try{const before='2026-10-07T08:00:00+08:00',item=schoolItem({issuedAt:before,timing:{kind:'once',startsAt:'2026-10-07T09:01:00+08:00',endsAt:'2026-10-07T10:00:00+08:00'},noticePolicy:{announceOnIssue:true,announceOnChange:true,reminders:[{kind:'minutes_before',offset:10,source:'institution'}]}});d.storage.save('school_plan_items',item.id,item);let input=schoolExpansionInput(d.storage,before,d.config.timezone);const initial=resolveSchoolWeekText(d.storage,result(input),input,before);d.storage.transaction(()=>applySchoolChanges(d.storage,initial,before));const historical=d.schoolStore.instances()[0];
 const freezeAt='2026-10-07T09:00:00+08:00';d.storage.save('school_plan_items',item.id,{...item,revision:2,deliveryRevision:2,location:'新教室',timing:{kind:'once',startsAt:'2026-10-07T09:30:00+08:00',endsAt:'2026-10-07T10:00:00+08:00'}});input=schoolExpansionInput(d.storage,freezeAt,d.config.timezone);const applied=resolveSchoolWeekText(d.storage,result(input),input,'2026-10-07T09:02:00+08:00');if(applied.stage!=='school_week')throw Error('stage');const successor=applied.instances.find(i=>i.id!==historical.id)!;const notice=applied.notices.find(n=>n.kind==='reminder')!;expect(successor.occurrenceKey).toContain('after');expect(notice.instanceId).toBe(successor.id);expect(notice.payload.snapshots.some(s=>s.entityKind==='instance'&&s.entityId===successor.id&&s.value.occurrenceKey===successor.occurrenceKey)).toBe(true);expect(d.storage.read('school_instances',historical.id)).toEqual(historical);
 }finally{d.storage.close();}
});
