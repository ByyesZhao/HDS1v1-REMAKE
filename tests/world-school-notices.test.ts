import {it,expect} from 'vitest';
import {setup,NOW} from './helpers';
import {schoolItem} from './world-school-fixture';
import {expand} from './world-school-fixture';
import {releaseSchoolNotices,selectSchoolNotices,schoolNoticeDeadline} from '../src/school/notices';
import {schoolExpansionInput} from '../src/school/calendar';
import {applySchoolChanges} from '../src/school/changes';
import {Scheduler} from '../src/host/scheduler';
it('due_notice_released_before_selection_and_publication_not_knowledge_or_autonomy',async()=>{
 const d=setup();d.storage.save('school_plan_items','meeting',schoolItem());expand(d);const state=d.storage.character();const request=await new Scheduler(d.storage,d.config).collectReady(NOW);expect(request?.triggerKinds).toEqual(['school_notification']);expect(request?.schoolNoticeRefs?.length).toBe(1);expect(d.schoolStore.knowledge()).toEqual([]);expect(d.storage.character()).toEqual(state);expect(d.schoolStore.notices().find(n=>n.kind==='issue')?.releasedAt).toBe(NOW);d.storage.close();
});
it('publication_waits_for_publish_at_notice_deadline_reaches_timer',async()=>{
 const d=setup(),later='2026-10-07T12:00:00+08:00';d.storage.save('school_plan_items','meeting',schoolItem({issuedAt:later}));expand(d);releaseSchoolNotices(d.storage,NOW);expect(d.schoolStore.notices().every(n=>n.status==='scheduled')).toBe(true);expect(await new Scheduler(d.storage,d.config).nextDeadline(NOW)).toBe(later);releaseSchoolNotices(d.storage,later);expect(selectSchoolNotices(d.storage,later)).toHaveLength(1);d.storage.close();
});
it('public_far_future_change_not_delayed_undisclosed_future_change_waits_for_issue',()=>{
 const d=setup(),item=schoolItem({kind:'research',timing:{kind:'deadline',at:'2027-01-10T17:00:00+08:00',date:null,note:'远期'}});d.storage.save('school_plan_items',item.id,item);expand(d);releaseSchoolNotices(d.storage,NOW);const published=d.schoolStore.notices().find(n=>n.kind==='issue')!;
 d.storage.transaction(()=>applySchoolChanges(d.storage,{stage:'school_group',plans:[],items:[{...item,revision:2,deliveryRevision:2,description:'当前更正'}]},NOW));expect(d.storage.read('school_notices',published.id)?.releasedAt).toBe(NOW);const input=schoolExpansionInput(d.storage,NOW,d.config.timezone);expect(input.requiredNoticeKeys.find(n=>n.kind==='change')?.publishAt).toBe(NOW);
 const future={...item,id:'draft',issuedAt:'2026-10-07T15:00:00+08:00'};d.storage.save('school_plan_items',future.id,future);expand(d);d.storage.transaction(()=>applySchoolChanges(d.storage,{stage:'school_group',plans:[],items:[{...future,revision:2,deliveryRevision:2,description:'草案更新'}]},NOW));const draft=schoolExpansionInput(d.storage,NOW,d.config.timezone).requiredNoticeKeys.filter(n=>n.sourceItemId==='draft');expect(draft.some(n=>n.kind==='change')).toBe(false);expect(draft.find(n=>n.kind==='issue')?.publishAt).toBe(future.issuedAt);d.storage.close();
});
it('sleep_unknown_end_and_shared_wait_no_hot_loop_paused_does_not_publish',async()=>{
 const d=setup();d.storage.save('school_plan_items','meeting',schoolItem());expand(d);d.storage.set('runtime',{...d.storage.runtime(),paused:true});const scheduler=new Scheduler(d.storage,d.config);expect(await scheduler.collectReady(NOW)).toBeNull();expect(d.schoolStore.notices().every(n=>n.status==='scheduled')).toBe(true);
 d.storage.set('runtime',{...d.storage.runtime(),paused:false});d.storage.set('character',{...d.storage.character(),scene:{...d.storage.character().scene,activity:{description:'洗澡',startsAt:NOW,expectedEndAt:null,phoneAccess:false}}});expect(await scheduler.collectReady(NOW)).toBeNull();expect(Date.parse(schoolNoticeDeadline(d.storage,NOW)!)).toBeGreaterThan(Date.parse(NOW));d.storage.close();
});
it('personal_reminder_requires_known_version',()=>{
 const d=setup();const item=schoolItem({noticePolicy:{announceOnIssue:false,announceOnChange:true,reminders:[{kind:'minutes_before',offset:120,source:'personal_reminder'}]}});d.storage.save('school_plan_items',item.id,item);expand(d);releaseSchoolNotices(d.storage,'2026-10-09T12:00:00+08:00');expect(selectSchoolNotices(d.storage,'2026-10-09T12:00:00+08:00')).toEqual([]);expect(schoolNoticeDeadline(d.storage,'2026-10-09T12:00:00+08:00')).toBeNull();d.storage.close();
});
