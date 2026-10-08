import {it,expect,vi} from 'vitest';
import {setup,NOW} from './helpers';
import {schoolItem,expand} from './world-school-fixture';
import {weekResult} from './world-school-review14-fixture';
import {applySchoolChanges} from '../src/school/changes';
import {schoolExpansionInput,resolveSchoolWeek} from '../src/school/calendar';
import {releaseSchoolNotices,selectSchoolNotices} from '../src/school/notices';
import {ensureEnvironmentBatch,selectEnvironmentStep} from '../src/environment/scheduler';
import {environmentInput,runEnvironmentStep} from '../src/environment/runtime';
import {ModelRequestError} from '../src/model/client';
function aboutToStart(){
 const d=setup();d.clock.time='2026-10-07T08:00:00+08:00';const item=schoolItem({issuedAt:d.clock.now(),timing:{kind:'once',startsAt:'2026-10-07T09:01:00+08:00',endsAt:'2026-10-07T10:00:00+08:00'}});d.storage.save('school_plan_items',item.id,item);expand(d,d.clock.now());
 d.clock.time='2026-10-07T09:00:00+08:00';d.storage.transaction(()=>applySchoolChanges(d.storage,{stage:'school_campus',plans:[],items:[{...item,revision:2,deliveryRevision:2,location:'新教室'}]},d.clock.now()));
 const historical=d.schoolStore.instances()[0];d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});const batch=ensureEnvironmentBatch(d.storage,d.config,d.clock.now())!;
 for(const s of d.environmentStore.steps(batch.id))if(s.stage!=='school_week')d.environmentStore.saveStep({...s,status:'committed'});
 return {d,historical,step:selectEnvironmentStep(d.storage,d.clock.now())!};
}
function withInstanceRefs(input:ReturnType<typeof schoolExpansionInput>){const raw=weekResult(input);for(const n of raw.noticeCandidates){const key=input.requiredOccurrences[0].occurrenceKey;n.entityRefs.push({entityKind:'instance',entityId:key});}return raw;}
it('cross_start_during_request_commits_without_overwriting_history_and_rebases_notice_refs',async()=>{
 const {d,historical,step}=aboutToStart();await runEnvironmentStep(d,step.id,async input=>{const raw=withInstanceRefs(input.context as any);d.clock.advance(120000);return raw;});
 expect(d.environmentStore.step(step.id)?.status).toBe('committed');expect(d.storage.read('school_instances',historical.id)).toEqual(historical);
 const corrected=d.schoolStore.instances().find(i=>i.id!==historical.id)!;expect(corrected.sourceSnapshot.location).toBe('新教室');expect(corrected.sourceRevision).toBe(2);
 const change=d.schoolStore.notices().find(n=>n.kind==='change')!;expect(change.payload.snapshots.find(s=>s.entityKind==='instance')?.entityId).toBe(corrected.id);
 releaseSchoolNotices(d.storage,d.clock.now());expect(selectSchoolNotices(d.storage,d.clock.now()).some(n=>n.noticeId===change.id)).toBe(true);d.storage.close();
});
it('ready_restart_cross_start_preserves_history_without_regeneration',async()=>{
 const {d,historical,step}=aboutToStart(),input=environmentInput(d,step),frozen=resolveSchoolWeek(d.storage,withInstanceRefs(input.context as any),input.context as any,d.clock.now());
 d.environmentStore.saveStep({...step,status:'ready',attempt:1,inputSnapshot:input,frozenResult:frozen});d.clock.advance(120000);const generate=vi.fn();await runEnvironmentStep(d,step.id,generate);
 expect(generate).not.toHaveBeenCalled();expect(d.storage.read('school_instances',historical.id)).toEqual(historical);expect(d.environmentStore.step(step.id)?.status).toBe('committed');expect(d.schoolStore.instances().find(i=>i.id!==historical.id)?.sourceRevision).toBe(2);d.storage.close();
});
it('pending_retry_cross_start_reuses_frozen_input_and_commits_corrected_version',async()=>{
 const {d,historical,step}=aboutToStart();await runEnvironmentStep(d,step.id,async()=>{throw new ModelRequestError('temporary unavailable');});const frozen=d.environmentStore.step(step.id)!.inputSnapshot;d.clock.advance(d.config.environmentRetryMs);
 await runEnvironmentStep(d,step.id,async input=>{expect(input).toEqual(frozen);return withInstanceRefs(input.context as any);});expect(d.environmentStore.step(step.id)).toMatchObject({status:'committed',attempt:2});expect(d.storage.read('school_instances',historical.id)).toEqual(historical);d.storage.close();
});
it('normalized_future_successor_reminder_keeps_canonical_identity_on_next_expansion',()=>{
 const {d,historical}=aboutToStart(),item=d.schoolStore.items()[0];d.storage.save('school_plan_items',item.id,{...item,timing:{kind:'once',startsAt:'2026-10-07T09:30:00+08:00',endsAt:'2026-10-07T10:00:00+08:00'},noticePolicy:{...item.noticePolicy,reminders:[{kind:'minutes_before',offset:10,source:'institution'}]}});
 const input=schoolExpansionInput(d.storage,d.clock.now(),d.config.timezone),raw=withInstanceRefs(input);d.clock.advance(120000);d.storage.transaction(()=>applySchoolChanges(d.storage,resolveSchoolWeek(d.storage,raw,input,d.clock.now()),d.clock.now()));const future=d.schoolStore.instances().find(i=>i.id!==historical.id)!,reminder=d.schoolStore.notices().find(n=>n.kind==='reminder'&&n.deliveryRevision===2)!;
 expect(reminder.instanceId).toBe(future.id);expect(reminder.payload.snapshots.find(s=>s.entityKind==='instance')?.entityId).toBe(future.id);const repeated=schoolExpansionInput(d.storage,d.clock.now(),d.config.timezone);expect(repeated.requiredNoticeKeys.filter(n=>n.kind==='reminder')).toEqual([]);expect(repeated.requiredOccurrences).toEqual([]);d.storage.close();
});
it.each(['scheduled','available','read'] as const)('new_week_digest_retires_only_unread_old_%s_and_replay_keeps_read_history',status=>{
 const d=setup(),weekly=(id:string,weekday:number)=>schoolItem({id,kind:'course',timing:{kind:'weekly',startsOn:'2026-10-01',endsOn:null,slots:[{slotKey:'am',weekday,start:'09:00',end:'10:00'}]}});
 d.storage.save('school_plan_items','a',weekly('a',4));expand(d);const old=d.schoolStore.notices().find(n=>n.kind==='week_digest')!;d.storage.save('school_notices',old.id,{...old,status,releasedAt:status==='scheduled'?null:NOW,readAt:status==='read'?NOW:null,readTurnId:status==='read'?'previous':null});
 d.storage.save('school_plan_items','b',weekly('b',5));const input=schoolExpansionInput(d.storage,NOW,d.config.timezone),changes=resolveSchoolWeek(d.storage,weekResult(input),input,NOW);d.storage.transaction(()=>applySchoolChanges(d.storage,changes,NOW));
 expect(d.storage.read('school_notices',old.id)?.status).toBe(status==='read'?'read':'invalidated');expect(d.storage.read('school_notices',old.id)?.payload).toEqual(old.payload);
 releaseSchoolNotices(d.storage,NOW);expect(d.schoolStore.notices().filter(n=>n.kind==='week_digest'&&n.status==='available')).toHaveLength(1);
 const current=d.schoolStore.notices().find(n=>n.kind==='week_digest'&&n.status==='available')!;d.storage.save('school_notices',current.id,{...current,status:'read',readAt:NOW,readTurnId:'new'});d.storage.transaction(()=>applySchoolChanges(d.storage,changes,NOW));expect(d.storage.read('school_notices',current.id)?.status).toBe('read');d.storage.close();
});
