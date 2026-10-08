import {it,expect} from 'vitest';
import {setup,NOW} from './helpers';
import {schoolPlan,schoolItem} from './world-school-fixture';
import {generateEnvironmentStep} from '../src/directors/school';
import {schoolCampusTask,schoolGroupTask} from '../src/school/contracts';
import {makeRetrievalRequest} from '../src/memory/retrieval';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {ensureEnvironmentBatch,selectEnvironmentStep} from '../src/environment/scheduler';
import {runEnvironmentStep,environmentInput} from '../src/environment/runtime';
import {ModelFormatError} from '../src/model/client';
it('roles_can_differ_empty_updates_keep_plan_and_doctoral_zero_courses_valid',async()=>{
 const d=setup();d.storage.save('school_plans',schoolPlan.id,schoolPlan);
 for(const stage of ['school_campus','school_group','school_week'] as const){d.models.outputs[stage]=stage==='school_week'?{stage,instanceChanges:[],noticeCandidates:[],weekChanges:[]}:{stage,planChanges:[],itemChanges:[]};expect((await generateEnvironmentStep(d,{stage,batchId:'batch',at:NOW,context:{background:'已有导师和研究方向',plans:[schoolPlan],items:[]}})).stage).toBe(stage);}
 expect(d.models.calls.map(c=>c.name)).toEqual(['school_campus','school_group','school_week']);expect(d.schoolStore.plans()).toEqual([schoolPlan]);expect(d.storage.all('experiences')).toEqual([]);d.storage.close();
});
it('wrong_owner_or_revision_rejected',()=>{
 const d=setup();d.storage.save('school_plans',schoolPlan.id,schoolPlan);d.storage.save('school_plan_items','meeting',schoolItem());
 expect(()=>schoolGroupTask(d,()=>[]).parse({stage:'school_group',planChanges:[],itemChanges:[{action:'cancel',id:'meeting',expectedRevision:1}]})).toThrow(/owner/);
 expect(()=>schoolCampusTask(d,()=>[]).parse({stage:'school_campus',planChanges:[],itemChanges:[{action:'cancel',id:'meeting',expectedRevision:9}]})).toThrow(/revision/);d.storage.close();
});
it('fiction_default_and_provided_urls_only_and_plan_is_not_research_result',()=>{
 const d=setup();d.storage.save('school_plans',schoolPlan.id,schoolPlan);const {id,revision,deliveryRevision,...item}=schoolItem();delete (item as any).basis;delete (item as any).sourceUrls;
 const task=schoolCampusTask(d,()=>[]),result:any=task.parse({stage:'school_campus',planChanges:[],itemChanges:[{action:'create',clientRef:'i',item}]});expect(result.itemChanges[0].item).toMatchObject({basis:'fiction',sourceUrls:[]});
 expect(()=>task.parse({stage:'school_campus',planChanges:[],itemChanges:[{action:'create',clientRef:'i',item:{...item,basis:'web_reference',sourceUrls:['https://not-provided.test']}}]})).toThrow(/supplied/);
 expect(()=>task.parse({stage:'school_campus',planChanges:[],itemChanges:[],researchProgress:[{summary:'完成'}]})).toThrow();d.storage.close();
});
it('each_step_has_own_web_session_and_same_step_does_not_reopen',async()=>{
 const d=setup(),store=new WebSearchStore(d.storage),web=new WebSearchService(store,undefined,d.clock,{enabled:false});
 for(const stage of ['school_campus','school_group'] as const){d.models.outputs[stage]={stage,planChanges:[],itemChanges:[]};for(let i=0;i<2;i++)await generateEnvironmentStep({...d,web},{stage,batchId:'b',at:NOW,context:{}});}
 const refs=d.models.calls.map(c=>c.options?.runRef!);expect(refs[0].ownerType).toBe('environment');expect(refs[0].runId).toBe(refs[1].runId);expect(refs[2].runId).not.toBe(refs[0].runId);expect(web.selfReadSources('b')).toEqual([]);d.storage.close();
});
it.each(['school_campus','school_group','school_week'])('new_roles_current_only: %s',stage=>{
 const r=makeRetrievalRequest('还记得去年那次，之前的变化',NOW,stage);expect(r.permissions.allowArchive).toBe(false);expect(r.permissions.allowDetailHistory).toBe(false);
});
it('repair_and_retry_keep_counters_and_next_date_independent_quota',async()=>{
 const d=setup();d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});ensureEnvironmentBatch(d.storage,d.config,NOW);const step=selectEnvironmentStep(d.storage,NOW)!;
 const store=new WebSearchStore(d.storage),web=new WebSearchService(store,undefined,d.clock,{enabled:false}),ref=store.openStage('environment',step.id,'generation','world');
 const op=store.beginOperation(ref.runId,{kind:'read',url:'https://example.test'});store.commitStep(ref.runId,{operationId:op.operationId,stepIndex:0,nextCandidateIndex:1,reason:'failed'});
 store.saveCheckpoint(ref.runId,{input:{},repairCount:2,lookupUsed:true,pendingOperationId:null,toolResults:[],repair:{original:'bad',errors:'bad'}});
 await runEnvironmentStep({...d,web},step.id,async()=>{throw new ModelFormatError('bad');});d.clock.advance(300000);
 await runEnvironmentStep({...d,web},step.id,async()=>{expect(store.snapshot(ref.runId)).toMatchObject({counters:{successReads:0,failures:1},repairCount:0,lookupUsed:true});return {stage:'world',changes:[]};});
 d.clock.time='2026-10-08T06:00:00+08:00';ensureEnvironmentBatch(d.storage,d.config,d.clock.now());const next=selectEnvironmentStep(d.storage,d.clock.now())!;const newRef=store.openStage('environment',next.id,'generation','world');expect(store.snapshot(newRef.runId).counters).toEqual({successReads:0,failures:0});expect(store.snapshot(ref.runId).counters.failures).toBe(1);d.storage.close();
});
it('campus_group_context_has_existing_identity_without_private_chat',()=>{
 const d=setup();d.config.background='导师既有姓名，研究方向既有课题';d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});ensureEnvironmentBatch(d.storage,d.config,NOW);
 const step=d.environmentStore.steps().find(s=>s.stage==='school_group')!;const context=environmentInput(d,step).context as any;expect(context.background).toContain('导师既有姓名');expect(context.messages).toBeUndefined();d.storage.close();
});
