import {it,expect} from 'vitest';
import {setup,NOW} from './helpers';
import {schoolPlan,schoolItem} from './world-school-fixture';
import {HdsiApp} from '../src/app';import {SerialHost} from '../src/host/runtime';
import {generateEnvironmentStep} from '../src/directors/school';
import {ModelRequestError,ModelClient} from '../src/model/client';
import type {SchoolExpansionInput} from '../src/school/types';
function weekResult(input:SchoolExpansionInput){return {stage:'school_week',instanceChanges:input.requiredOccurrences.map(o=>({occurrenceKey:o.occurrenceKey,sourceItemId:o.sourceItemId,expectedRevision:input.sourceItems.find(i=>i.id===o.sourceItemId)!.revision})),noticeCandidates:input.requiredNoticeKeys.map(n=>({key:n.id,text:'学校模拟通知：'+n.kind,entityRefs:n.entityIds.map(entityId=>({entityKind:'plan_item',entityId}))})),weekChanges:input.weekStarts.map(weekStart=>({weekStart,sourceVersions:Object.fromEntries(input.sourceItems.map(i=>[i.id,i.revision])),conflictNotes:input.conflicts}))};}
function fixture(){const d=setup();d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});
 d.models.outputs.world={changes:[]};d.models.outputs.school_campus=(input:any)=>input.plans.length?{stage:'school_campus',planChanges:[],itemChanges:[]}:{stage:'school_campus',planChanges:[{action:'create',clientRef:'semester',plan:(({id,revision,...p})=>p)(schoolPlan)}],itemChanges:[]};
 d.models.outputs.school_group=(input:any)=>input.plans.length?{stage:'school_group',planChanges:[],itemChanges:[]}:{stage:'school_group',planChanges:[{action:'create',clientRef:'group',plan:{owner:'group',kind:'group',title:'模拟科研',startsOn:'2026-09-01',endsOn:null,summary:'导师模拟要求',status:'active'}}],itemChanges:[]};
 d.models.outputs.school_week=(input:any)=>input.modelContractVersion===1?{stage:'school_week',noticeTexts:input.notices.map((n:any)=>({key:n.key,text:'学校模拟通知：'+n.kind})),weekNotes:[]}:weekResult(input.context);d.generateEnvironment=input=>generateEnvironmentStep(d,input);const host=new SerialHost(new HdsiApp(d),{timers:false});return {d,host};
}
it('fresh_db_bootstrap_chain_reuses_plans_and_versions_next_date',async()=>{
 const {d,host}=fixture();await host.start();expect(d.models.calls.map(c=>c.name)).toEqual(['world','school_campus','school_group']);expect(d.schoolStore.plans()).toHaveLength(2);const plans=d.schoolStore.plans();d.clock.time='2026-10-08T06:00:00+08:00';await host.wake();expect(d.schoolStore.plans()).toEqual(plans);expect(d.environmentStore.batches().map(b=>b.status)).toEqual(['committed','committed']);await host.stop();d.storage.close();
});
it('chat_after_failed_morning_step_and_retry_dependency',async()=>{
 const {d,host}=fixture();d.models.outputs.world=()=>{throw new ModelRequestError('offline HTTP failure');};await host.start();expect(d.storage.runtime().paused).toBe(false);
 await host.acceptInput({id:'input',receivedAt:NOW,content:'你好'});d.clock.advance(15000);await host.wake();expect(d.storage.read('messages','input')?.seenTurnId).not.toBeNull();expect(d.models.calls.some(c=>c.name==='school_campus')).toBe(false);expect(d.storage.unfinishedTurn()).toBeNull();await host.stop();d.storage.close();
});
it('cross_day_partial_batch_new_week_retains_committed_world',async()=>{
 const {d,host}=fixture();d.clock.time='2026-10-09T06:00:00+08:00';d.models.outputs.world={changes:[{action:'create',event:{kind:'world',startsAt:d.clock.time,endsAt:null,description:'已提交天气',basis:'fiction',sourceUrls:[]}}]};d.models.outputs.school_campus=()=>{throw new ModelRequestError('campus failed');};await host.start();const old=d.environmentStore.batches()[0];expect(d.environmentStore.steps(old.id)[0].status).toBe('committed');
 d.clock.time='2026-10-12T06:00:00+08:00';d.models.outputs.world={changes:[]};d.models.outputs.school_campus={stage:'school_campus',planChanges:[{action:'create',clientRef:'semester',plan:(({id,revision,...p})=>p)(schoolPlan)}],itemChanges:[]};await host.wake();expect(d.environmentStore.batch(old.id)?.status).toBe('superseded');expect(d.environmentStore.steps(old.id)[0].status).toBe('committed');expect(d.storage.all('events')[0].description).toBe('已提交天气');expect(d.schoolStore.weeks().some(w=>w.weekStart==='2026-10-12')).toBe(true);await host.stop();d.storage.close();
});
it('bootstrap_contract_requires_plan_but_not_courses',async()=>{
 const {d,host}=fixture();const client=new ModelClient({complete:async()=>({stage:'school_campus',planChanges:[],itemChanges:[]})}),original=d.models.runModel.bind(d.models);d.models.runModel=async(task,input,options)=>task.name==='school_campus'?client.runModel(task,input,options):original(task,input,options);
 await host.start();expect(d.schoolStore.plans()).toHaveLength(0);expect(d.environmentStore.steps().find(s=>s.stage==='school_campus')?.lastError).toContain('initial');expect(d.storage.runtime().paused).toBe(false);await host.stop();d.storage.close();
});
