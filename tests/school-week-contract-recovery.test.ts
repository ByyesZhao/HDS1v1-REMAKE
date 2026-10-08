import {it,expect,vi} from 'vitest';
import {setup,NOW} from './helpers';
import {ensureEnvironmentBatch} from '../src/environment/scheduler';
import {runEnvironmentStep,environmentInput} from '../src/environment/runtime';
import {schoolItem} from './world-school-fixture';
import {schoolExpansionInput} from '../src/school/calendar';
import {runSchoolWeek} from '../src/directors/school';
function fixture(){const d=setup();d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});const batch=ensureEnvironmentBatch(d.storage,d.config,NOW)!;return {d,step:d.environmentStore.steps(batch.id).find(s=>s.stage==='school_week')!};}
it('new_snapshot_uses_v1; no_notice_skips_model_but_commits_coverage; conflicts_without_notice_zero_calls_preserved',async()=>{
 const {d,step}=fixture();try{for(const id of ['a','b'])d.storage.save('school_plan_items',id,schoolItem({id,noticePolicy:{announceOnIssue:false,announceOnChange:false,reminders:[]}}));const input=environmentInput(d,step);expect(input.modelContractVersion).toBe(1);expect((input.context as any).requiredNoticeKeys).toHaveLength(0);const generate=vi.fn();await runEnvironmentStep(d,step.id,generate);expect(generate).not.toHaveBeenCalled();expect(d.environmentStore.step(step.id)!.status).toBe('committed');expect(d.schoolStore.instances()).toHaveLength(2);expect(d.schoolStore.weeks()[0].conflictNotes).toHaveLength(1);
 }finally{d.storage.close();}
});
it('old_running_checkpoint_uses_v0; old_ready_direct_commit_no_model',async()=>{
 const {d,step}=fixture();try{d.storage.save('school_plan_items','meeting',schoolItem());const context=schoolExpansionInput(d.storage,NOW,d.config.timezone),input={stage:'school_week' as const,batchId:step.batchId,at:NOW,context};d.models.outputs.school_week={stage:'school_week',instanceChanges:context.requiredOccurrences.map(o=>({occurrenceKey:o.occurrenceKey,sourceItemId:o.sourceItemId,expectedRevision:1})),noticeCandidates:context.requiredNoticeKeys.map(n=>({key:n.id,text:'旧式通知',entityRefs:n.entityIds.map(entityId=>({entityKind:'plan_item',entityId}))})),weekChanges:[]};
 d.environmentStore.saveStep({...step,status:'running',attempt:2,inputSnapshot:input});await runEnvironmentStep(d,step.id,i=>runSchoolWeek(d,i));expect(d.models.calls[0].input.context.modelContractVersion).toBeUndefined();expect(d.schoolStore.instances()).toHaveLength(1);
 const ready={...d.environmentStore.step(step.id)!,status:'ready' as const};d.environmentStore.saveStep(ready);const generate=vi.fn();await runEnvironmentStep(d,step.id,generate);expect(generate).not.toHaveBeenCalled();
 }finally{d.storage.close();}
});

it('required_notice_never_skipped_and_v1_text_commits_without_mechanical_model_fields',async()=>{const {d,step}=fixture();try{d.storage.save('school_plan_items','meeting',schoolItem());const generate=vi.fn(async(input:import('../src/environment/types').EnvironmentStepInput)=>({stage:'school_week' as const,noticeTexts:(input.context as import('../src/school/types').SchoolExpansionInput).requiredNoticeKeys.map(n=>({key:n.id,text:'模拟班会通知'})),weekNotes:[]}));await runEnvironmentStep(d,step.id,generate);expect(generate).toHaveBeenCalledTimes(1);expect(d.environmentStore.step(step.id)!.inputSnapshot!.modelContractVersion).toBe(1);expect(d.schoolStore.notices().every(n=>n.kind!=='reminder'||n.instanceId!==null)).toBe(true);}finally{d.storage.close();}});
