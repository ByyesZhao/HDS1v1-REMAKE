import {it,expect} from 'vitest';
import {setup,NOW} from './helpers';
import {schoolPlan,schoolItem,expand} from './world-school-fixture';
import {weekResult} from './world-school-review14-fixture';
import {schoolExpansionInput,resolveSchoolWeek,stableId} from '../src/school/calendar';
import {applySchoolChanges,resolveSchoolUpstream} from '../src/school/changes';
import {schoolCampusTask,schoolWeekTask} from '../src/school/contracts';
import {releaseSchoolNotices,selectSchoolNotices,schoolNoticeDeadline} from '../src/school/notices';
import {HdsiApp,generateTurn} from '../src/app';
import {SerialHost} from '../src/host/runtime';
import {Scheduler} from '../src/host/scheduler';
import {ensureEnvironmentBatch,selectEnvironmentStep} from '../src/environment/scheduler';
import {runEnvironmentStep,environmentInput} from '../src/environment/runtime';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {freezeTurn,finishPostprocessing} from '../src/recovery';
it('week_metadata_is_complete_even_when_model_omits_coverage_and_no_change_refreshes_checked_at',()=>{
 const d=setup();d.storage.save('school_plan_items','meeting',schoolItem());const input=schoolExpansionInput(d.storage,NOW,d.config.timezone),raw=weekResult(input);raw.weekChanges=[];
 const result=resolveSchoolWeek(d.storage,raw,input,NOW);d.storage.transaction(()=>applySchoolChanges(d.storage,result,NOW));expect(d.schoolStore.weeks()).toHaveLength(input.weekStarts.length);expect(d.schoolStore.weeks()[0]).toMatchObject({sourceVersions:{meeting:1},checkedAt:NOW});
 const later='2026-10-07T10:05:00+08:00',checked=schoolExpansionInput(d.storage,later,d.config.timezone),empty=weekResult(checked);empty.weekChanges=[];d.storage.transaction(()=>applySchoolChanges(d.storage,resolveSchoolWeek(d.storage,empty,checked,later),later));expect(d.schoolStore.weeks()[0].checkedAt).toBe(later);expect(d.schoolStore.notices()).toHaveLength(input.requiredNoticeKeys.length);d.storage.close();
});
it('explicit_wrong_or_duplicate_week_metadata_rejected_and_missing_notice_checked_independently',()=>{
 const d=setup();d.storage.save('school_plan_items','meeting',schoolItem());const input=schoolExpansionInput(d.storage,NOW,d.config.timezone),raw=weekResult(input),task=schoolWeekTask(input);
 expect(()=>task.parse({...raw,noticeCandidates:[]})).toThrow(/required notice missing/);expect(()=>task.parse({...raw,weekChanges:[{...raw.weekChanges[0],sourceVersions:{meeting:99}}]})).toThrow(/coverage version/);expect(()=>task.parse({...raw,weekChanges:[raw.weekChanges[0],raw.weekChanges[0]]})).toThrow(/duplicate week/);d.storage.close();
});
it('pre_friday_retains_existing_next_week_scope_without_recreating_instances',()=>{
 const d=setup();d.storage.save('school_weeks',stableId('school-week','2026-10-12'),{id:stableId('school-week','2026-10-12'),weekStart:'2026-10-12',sourceVersions:{},checkedAt:NOW,digestRevision:0,conflictNotes:[]});d.storage.save('school_plan_items','meeting',schoolItem({timing:{kind:'weekly',startsOn:'2026-10-01',endsOn:null,slots:[{slotKey:'mon',weekday:1,start:'09:00',end:'10:00'}]}}));
 const input=schoolExpansionInput(d.storage,NOW,d.config.timezone);expect(input.weekStarts).toEqual(['2026-10-05','2026-10-12']);d.storage.transaction(()=>applySchoolChanges(d.storage,resolveSchoolWeek(d.storage,weekResult(input),input,NOW),NOW));const next=d.schoolStore.instances().find(i=>i.weekStart==='2026-10-12')!;expect(next).toBeDefined();const repeated=schoolExpansionInput(d.storage,NOW,d.config.timezone);expect(repeated.requiredOccurrences).toEqual([]);expect(repeated.requiredNoticeKeys).toEqual([]);expect(d.storage.read('school_instances',next.id)).toEqual(next);d.storage.close();
});
it.each([
 ['course','once',[1,120]],['meeting','weekly',[60]],['research','deadline',[1,120]],['meeting','tentative',[]],
] as const)('default_policy_uses_timing_%s_%s_and_explicit_policy_wins',(kind,timingKind,offsets)=>{
 const d=setup();d.storage.save('school_plans',schoolPlan.id,schoolPlan);const source=schoolItem({kind}),{id,revision,deliveryRevision,noticePolicy,...item}=source;
 const timing=timingKind==='weekly'?{kind:'weekly',startsOn:'2026-10-01',endsOn:null,slots:[{slotKey:'am',weekday:4,start:'09:00',end:'10:00'}]}:timingKind==='deadline'?{kind:'deadline',at:'2026-11-10T17:00:00+08:00',date:null,note:'模拟截止'}:timingKind==='tentative'?{kind:'tentative',startsOn:'2026-11-01',endsOn:null,note:'时刻待定'}:item.timing;
 const task=schoolCampusTask(d),raw={stage:'school_campus',planChanges:[],itemChanges:[{action:'create',clientRef:'new',item:{...item,timing}}]},parsed:any=task.parse(raw);expect(parsed.itemChanges[0].item.noticePolicy.reminders.map((r:any)=>r.offset)).toEqual([...offsets]);
 const explicit={announceOnIssue:false,announceOnChange:true,reminders:[]};expect((task.parse({...raw,itemChanges:[{...raw.itemChanges[0],item:{...item,timing,noticePolicy:explicit}}]}) as any).itemChanges[0].item.noticePolicy).toEqual(explicit);d.storage.close();
});
it('missing_environment_generator_pauses_once_host_returns_without_zero_timer_loop',async()=>{
 const d=setup();d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});const errors:unknown[]=[],host=new SerialHost(new HdsiApp(d),{timers:false,onError:e=>errors.push(e)});await host.start();
 expect(errors).toHaveLength(1);expect(d.storage.runtime()).toMatchObject({paused:true,lastError:'environment generator not assembled'});expect(await new Scheduler(d.storage,d.config).nextDeadline(NOW)).toBeNull();await host.wake();expect(errors).toHaveLength(1);await host.stop();d.storage.close();
});
it('known_personal_reminder_with_item_and_instance_snapshots_can_release_select_and_wake',()=>{
 const d=setup(),item=schoolItem({noticePolicy:{announceOnIssue:false,announceOnChange:true,reminders:[{kind:'minutes_before',offset:120,source:'personal_reminder'}]}});d.storage.save('school_plan_items',item.id,item);const input=schoolExpansionInput(d.storage,NOW,d.config.timezone),raw=weekResult(input);raw.noticeCandidates[0].entityRefs.push({entityKind:'instance',entityId:input.requiredOccurrences[0].occurrenceKey});
 d.storage.transaction(()=>applySchoolChanges(d.storage,resolveSchoolWeek(d.storage,raw,input,NOW),NOW));const notice=d.schoolStore.notices()[0];expect(notice.payload.snapshots).toHaveLength(2);const at='2026-10-09T12:00:00+08:00';releaseSchoolNotices(d.storage,at);expect(d.storage.read('school_notices',notice.id)?.status).toBe('scheduled');
 for(const s of notice.payload.snapshots)d.storage.save('school_knowledge',s.entityId,{id:s.entityId,entityKind:s.entityKind,entityId:s.entityId,revision:s.revision,snapshot:s,acquiredAt:NOW,experienceId:'fixture-e',turnId:'fixture-t',via:'notice'});releaseSchoolNotices(d.storage,at);expect(selectSchoolNotices(d.storage,at).map(n=>n.noticeId)).toContain(notice.id);expect(schoolNoticeDeadline(d.storage,at)).toBe(at);d.storage.close();
});
it('pause_does_not_publish_and_overdue_notice_unreadable_waits_readable_can_wake_once',async()=>{
 const d=setup();d.storage.save('school_plan_items','meeting',schoolItem());expand(d);const scheduler=new Scheduler(d.storage,d.config);d.storage.set('runtime',{...d.storage.runtime(),paused:true});expect(await scheduler.collectReady(NOW)).toBeNull();expect(d.schoolStore.notices().every(n=>n.status==='scheduled'&&n.releasedAt===null)).toBe(true);
 const later='2026-10-07T11:00:00+08:00',state=d.storage.character();d.storage.set('runtime',{...d.storage.runtime(),paused:false});d.storage.set('character',{...state,scene:{...state.scene,activity:{description:'洗澡',startsAt:NOW,expectedEndAt:null,phoneAccess:false}}});expect(await scheduler.collectReady(later)).toBeNull();expect(Date.parse(schoolNoticeDeadline(d.storage,later)!)).toBeGreaterThan(Date.parse(later));d.storage.set('character',state);expect((await scheduler.collectReady(later))?.triggerKinds).toEqual(['school_notification']);d.storage.close();
});
it('running_restart_reuses_input_attempt_and_tool_checkpoint_without_reset',async()=>{
 const d=setup();d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});ensureEnvironmentBatch(d.storage,d.config,NOW);const step=selectEnvironmentStep(d.storage,NOW)!,input=environmentInput(d,step),store=new WebSearchStore(d.storage),web=new WebSearchService(store,undefined,d.clock,{enabled:false}),ref=store.openStage('environment',step.id,'generation','world');
 store.saveCheckpoint(ref.runId,{input:{fixture:true},repairCount:1,lookupUsed:true,pendingOperationId:null,toolResults:[],repair:{original:'bad',errors:'format'}});d.environmentStore.saveStep({...step,status:'running',attempt:3,inputSnapshot:input});d.clock.advance(60000);
 await runEnvironmentStep({...d,web},step.id,async frozen=>{expect(frozen).toEqual(input);expect(store.snapshot(ref.runId)).toMatchObject({repairCount:1,lookupUsed:true});return {stage:'world',changes:[]};});expect(d.environmentStore.step(step.id)).toMatchObject({attempt:3,status:'committed',inputSnapshot:input});d.storage.close();
});
it('upstream_public_changes_increment_delivery_revision_internal_notes_do_not',()=>{
 const d=setup(),item=schoolItem();d.storage.save('school_plan_items',item.id,item);const resolve=(patch:any)=>resolveSchoolUpstream(d.storage,{stage:'school_campus',planChanges:[],itemChanges:[{action:'update',id:item.id,expectedRevision:1,item:patch}]},NOW);
 expect((resolve({stageInfo:'内部检查'}) as any).items[0]).toMatchObject({revision:2,deliveryRevision:1});expect((resolve({location:'新教室'}) as any).items[0]).toMatchObject({revision:2,deliveryRevision:2});expect((resolve({location:item.location}) as any).items).toEqual([]);d.storage.close();
});
it('retired_legacy_recovery_does_not_repopulate_world_or_school_deadlines',async()=>{
 const d=setup(),request={inputMessageIds:[],taskIds:[],triggerKinds:['autonomous' as const]},generated=await generateTurn(d,request,'legacy');const turn:any={id:'legacy',at:NOW,inputMessageIds:[],triggerTaskIds:[],triggerKinds:['environment'],batchIds:[],entryMode:'chat',environmentKind:'world',completedAt:null,frozenResult:null,outputComplete:false,done:false};
 const frozen=freezeTurn(d,turn,generated.candidate,[]);await finishPostprocessing(d,frozen);expect(d.storage.runtime().nextWorldAt).toBeNull();expect(d.storage.runtime().nextSchoolAt).toBeNull();d.storage.close();
});
