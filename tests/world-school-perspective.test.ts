import {it,expect} from 'vitest';
import {setup,NOW,narrative} from './helpers';
import {schoolItem,expand} from './world-school-fixture';
import {personalSchoolContext,narrativeSchoolContext} from '../src/school/context';
import {prepareSchoolCommits,applySchoolCommits} from '../src/school/progress';
import {releaseSchoolNotices} from '../src/school/notices';
it('personal_keeps_old_known_revision_related_id_not_read_proof_and_explicit_future_known_query',()=>{
 const d=setup(),item=schoolItem();d.storage.save('school_plan_items',item.id,item);expand(d);
 expect(personalSchoolContext(d.storage,[],'meeting')).toEqual({knownSnapshots:[]});
 d.storage.save('school_knowledge','k',{id:'k',entityKind:'plan_item',entityId:item.id,revision:1,snapshot:{entityKind:'plan_item',entityId:item.id,revision:1,value:item},acquiredAt:NOW,experienceId:'e',turnId:'old',via:'notice'});
 d.storage.save('school_plan_items',item.id,{...item,revision:2,deliveryRevision:2,location:'最新教室'});
 const known=personalSchoolContext(d.storage,[],'meeting').knownSnapshots;expect(known[0].value).toMatchObject({location:'学院',revision:1});expect(personalSchoolContext(d.storage,[],'大班会 2026-10-09').knownSnapshots).toHaveLength(1);d.storage.close();
});
it('late_notice_not_read_in_past_week_digest_only_declared_entities_known',()=>{
 const d=setup();d.storage.save('school_plan_items','meeting',schoolItem());expand(d);releaseSchoolNotices(d.storage,NOW);const n=d.schoolStore.notices().find(n=>n.kind==='issue')!;
 const turn:any={id:'t',at:NOW,schoolNoticeRefs:[{noticeId:n.id,deliveryRevision:n.deliveryRevision}]};
 const e={id:'e',happenedAt:NOW,description:'看了学院通知',relatedEventIds:[]},r={...narrative,experiences:[e],schoolObservations:[{via:'notice' as const,sourceId:n.id,experienceIndex:0}]};
 const prepared=prepareSchoolCommits(d.storage,turn,r,[e]);expect(prepared.visibleSnapshots).toHaveLength(1);expect(d.schoolStore.knowledge()).toEqual([]);
 d.storage.set('character',{...d.storage.character(),narratedUntil:'2026-10-07T09:00:00+08:00'});expect(()=>prepareSchoolCommits(d.storage,turn,{...r,experiences:[{...e,happenedAt:'2026-10-07T09:59:00+08:00'}]},[{...e,happenedAt:'2026-10-07T09:59:00+08:00'}])).toThrow(/published/);
 d.storage.close();
});
it('progress_requires_actual_experience_and_research_known_task',()=>{
 const d=setup(),task=schoolItem({id:'research',kind:'research'});d.storage.save('school_plan_items',task.id,task);const turn:any={id:'t',at:NOW,schoolNoticeRefs:[]},e={id:'e',happenedAt:NOW,description:'完成一次模拟实验并分析结果',relatedEventIds:[]},draft={...narrative,experiences:[e],researchProgress:[{taskId:task.id,kind:'progress' as const,experienceIndex:0,summary:'已模拟分析'}]};
 expect(()=>prepareSchoolCommits(d.storage,turn,draft,[e])).toThrow(/known/);
 d.storage.save('school_knowledge','k',{id:'k',entityKind:'plan_item',entityId:task.id,revision:1,snapshot:{entityKind:'plan_item',entityId:task.id,revision:1,value:task},acquiredAt:NOW,experienceId:'old-e',turnId:'old',via:'notice'});
 expect(()=>prepareSchoolCommits(d.storage,turn,{...draft,researchProgress:[{...draft.researchProgress[0],experienceIndex:1}]},[e])).toThrow(/experience/);
 const prepared=prepareSchoolCommits(d.storage,turn,draft,[e]);d.storage.transaction(()=>applySchoolCommits(d.storage,{schoolObservations:prepared.observations,schoolProgress:prepared.progress,experiences:[e]} as any,'t'));
 d.storage.transaction(()=>applySchoolCommits(d.storage,{schoolObservations:prepared.observations,schoolProgress:prepared.progress,experiences:[e]} as any,'t'));expect(d.schoolStore.progress()).toHaveLength(1);expect(d.schoolStore.progress()[0].experienceId).toBe('e');expect(d.storage.read('school_plan_items',task.id)?.status).toBe('open');d.storage.close();
});
it('end_of_turn_awake_does_not_allow_reading_while_previously_sleeping',()=>{
 const d=setup(),earlier='2026-10-07T09:00:00+08:00';d.storage.save('school_plan_items','meeting',schoolItem({issuedAt:earlier}));expand(d,earlier);releaseSchoolNotices(d.storage,earlier);const n=d.schoolStore.notices().find(n=>n.kind==='issue')!;
 d.storage.set('character',{...d.storage.character(),narratedUntil:earlier,sleep:{sleepAt:'2026-10-07T09:30:00+08:00',wakeAt:NOW}});
 const e={id:'e',happenedAt:'2026-10-07T09:50:00+08:00',description:'声称睡着时读到通知',relatedEventIds:[]};
 expect(()=>prepareSchoolCommits(d.storage,{id:'t',at:NOW,schoolNoticeRefs:[{noticeId:n.id,deliveryRevision:1}]} as any,{...narrative,experiences:[e],schoolObservations:[{via:'notice',sourceId:n.id,experienceIndex:0}]},[e])).toThrow(/readable/);d.storage.close();
});
