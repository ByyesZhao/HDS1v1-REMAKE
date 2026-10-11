import {it,expect,vi} from 'vitest';
import {setImmediate} from 'node:timers/promises';
import {asyncFixture} from './environment-async-fixture';
import {NOW} from './helpers';
import {EnvironmentPreparation} from '../src/environment/preparation';
import {ensureEnvironmentBatch} from '../src/environment/scheduler';
import {runEnvironmentStep} from '../src/environment/runtime';
import {freezeEnvironmentSnapshot} from '../src/environment/snapshot';
import {WebSearchService} from '../src/web/service';
import {ModelRequestError} from '../src/model/client';
import type {WebModelCheckpoint} from '../src/web/types';
const checkpoint:WebModelCheckpoint={formatVersion:2,input:{body:'saved model input'},repairCount:0,lookupUsed:false,lookupPending:false,pendingOperationId:null,toolResults:[]};
function savedWeb(d:ReturnType<typeof asyncFixture>['d'],step:ReturnType<typeof asyncFixture>['step']){const ref=d.web.store.openStage('environment',step.id,'generation',step.stage);d.web.store.saveCheckpoint(ref.runId,checkpoint);return ref;}

it('superseded_execution_cannot_repopulate_owner_after_finalization',async()=>{
 const {d,step}=asyncFixture();let readRelease!:()=>void,executeRelease!:()=>void,lateCheckpoint:unknown,executionFinally=false;
 const provider={signature:'fixture',search:async()=>[],read:vi.fn(async(url:string)=>{if(url.endsWith('/late'))await new Promise<void>(resolve=>readRelease=resolve);return {bodyFormat:'text' as const,title:url,body:'full page'};})};
 d.web=new WebSearchService(d.web.store,provider,d.clock,{enabled:true});const ref=savedWeb(d,step);
 d.generateEnvironment=async(_input,options)=>{const session=options!.modelOptions!.web!;try{for(const url of ['https://example.test/first','https://example.test/late']){const op=session.beginOperation({kind:'read',url});await session.readPage(url,{operationId:op.operationId});}}finally{await new Promise<void>(resolve=>executeRelease=resolve);try{session.saveCheckpoint(checkpoint);}catch(error){lateCheckpoint=error;}executionFinally=true;}return {stage:'world',changes:[]};};
 const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);await setImmediate();const snapshot=d.environmentStore.step(step.id)!.preparationSnapshot;
 d.clock.advance(86400000);p.reconcile(d.clock.now());const newBatch=d.environmentStore.firstActiveBatch();expect(d.environmentStore.step(step.id)).toMatchObject({status:'superseded',preparationSnapshot:snapshot});expect(d.web.store.checkpoint(ref.runId)).toEqual(checkpoint);
 readRelease();await setImmediate();expect(executionFinally).toBe(false);expect(d.environmentStore.step(step.id)!.preparationSnapshot).toEqual(snapshot);expect(d.web.store.checkpoint(ref.runId)).toEqual(checkpoint);
 executeRelease();await p.wait();expect(executionFinally).toBe(true);expect(lateCheckpoint).toBeInstanceOf(Error);expect(d.environmentStore.step(step.id)).toMatchObject({status:'superseded',preparationSnapshot:null,terminalAudit:{version:1}});expect(d.web.store.checkpoint(ref.runId)).toBeNull();expect(d.web.store.state(ref.runId).counters).toEqual({successReads:1,failures:0});expect(d.web.store.materials(ref.runId)).toHaveLength(1);expect(d.environmentStore.firstActiveBatch()).toEqual(newBatch);
 const next=d.web.openSession(d.web.store.openStage('environment',step.id,'inspect-cache','world')),op=next.beginOperation({kind:'read',url:'https://example.test/first'});await next.readPage('https://example.test/first',{operationId:op.operationId});expect(provider.read).toHaveBeenCalledTimes(3);await p.stop();d.storage.close();
});

it.each(['expired_ready_step_schedules_cleanup_before_stale_return','reconcile_cleans_non_active_superseded_owners','scheduler_supersede_is_observed_by_preparation','committed_owner_uses_same_finalizer'] as const)('%s',async route=>{
 const {d,step}=asyncFixture(),p=new EnvironmentPreparation(d),ref=savedWeb(d,step),snapshot=freezeEnvironmentSnapshot(d,step,NOW);d.environmentStore.saveStep({...step,status:route==='reconcile_cleans_non_active_superseded_owners'?'pending':'ready',inputSnapshot:snapshot.input,preparationSnapshot:snapshot,frozenResult:{stage:'world',changes:[]}});
 p.reconcile(NOW);
 if(route==='committed_owner_uses_same_finalizer')expect(p.applyReady(step.id,NOW)).toBe('applied');
 else{d.clock.advance(86400000);if(route==='scheduler_supersede_is_observed_by_preparation')ensureEnvironmentBatch(d.storage,d.config,d.clock.now());if(route==='expired_ready_step_schedules_cleanup_before_stale_return')expect(p.applyReady(step.id,d.clock.now())).toBe('stale');else p.reconcile(d.clock.now());}
 await p.wait();expect(d.web.store.checkpoint(ref.runId)).toBeNull();expect(d.environmentStore.step(step.id)!.preparationSnapshot).toBeNull();await p.stop();d.storage.close();
});

it('failed_finalization_is_observable_and_retains_observed_id_for_explicit_retry',async()=>{
 const {d,step}=asyncFixture();let wakes=0;const p=new EnvironmentPreparation(d,{onReady:()=>{if(++wakes<10)p.reconcile(d.clock.now());}}),ref=savedWeb(d,step);p.reconcile(NOW);d.clock.advance(86400000);ensureEnvironmentBatch(d.storage,d.config,d.clock.now());
 d.storage.prepare("CREATE TRIGGER fail_finalize BEFORE UPDATE ON web_sessions BEGIN SELECT RAISE(ABORT,'cleanup failure'); END").run();p.reconcile(d.clock.now());await p.wait();expect(p.takeError()).toMatchObject({message:expect.stringContaining('cleanup failure')});expect(d.web.store.checkpoint(ref.runId)).not.toBeNull();
 expect(wakes).toBeLessThan(10);
 d.storage.prepare('DROP TRIGGER fail_finalize').run();p.reconcile(d.clock.now());await p.wait();expect(d.web.store.checkpoint(ref.runId)).toBeNull();expect(p.takeError()).toBeUndefined();await p.stop();d.storage.close();
});

it('temporary_preparation_surfaces_cleanup_errors_after_drain',async()=>{
 const {d,step}=asyncFixture();savedWeb(d,step);
 d.storage.prepare("CREATE TRIGGER fail_finalize BEFORE UPDATE ON web_sessions WHEN json_extract(NEW.data,'$.checkpoint') IS NULL BEGIN SELECT RAISE(ABORT,'one-shot cleanup failure'); END").run();
 await expect(runEnvironmentStep(d,step.id,async()=>({stage:'world',changes:[]}))).rejects.toThrow('one-shot cleanup failure');expect(d.environmentStore.step(step.id)?.status).toBe('committed');d.storage.close();
});

it('successful_finalization_wakes_once_without_rediscovering_committed_history',async()=>{
 const {d,step}=asyncFixture();let wakes=0;const p=new EnvironmentPreparation(d,{onReady:()=>{if(++wakes<10)p.reconcile(d.clock.now());}}),snapshot=freezeEnvironmentSnapshot(d,step,NOW),ref=savedWeb(d,step);
 d.environmentStore.saveStep({...step,status:'ready',inputSnapshot:snapshot.input,preparationSnapshot:snapshot,frozenResult:{stage:'world',changes:[]}});p.reconcile(NOW);expect(p.applyReady(step.id,NOW)).toBe('applied');await p.wait();expect(wakes).toBe(1);expect(d.web.store.checkpoint(ref.runId)).toBeNull();await p.stop();d.storage.close();
});

it('stop_retry_and_generation_invalidation_preserve_recovery',async()=>{
 const {d,step}=asyncFixture('school_group'),ref=savedWeb(d,step),p=new EnvironmentPreparation(d);let failing=true;
 d.generateEnvironment=async()=>{if(failing)throw new ModelRequestError('retryable');return {stage:'school_group',planChanges:[],itemChanges:[]};};
 p.startOne(step.id,NOW);await p.wait();expect(d.environmentStore.step(step.id)?.status).toBe('pending');expect(d.web.store.checkpoint(ref.runId)).toEqual(checkpoint);
 failing=false;d.clock.advance(d.config.environmentRetryMs);p.startOne(step.id,d.clock.now());await p.wait();d.storage.save('school_progress','changed',{id:'changed',taskId:'task',kind:'feedback',experienceId:'experience',turnId:'turn',happenedAt:NOW,summary:'changed basis'});
 expect(p.applyReady(step.id,d.clock.now())).toBe('stale');await p.wait();expect(d.environmentStore.step(step.id)).toMatchObject({status:'pending',preparationGeneration:2});expect(d.web.store.checkpoint(ref.runId)).toEqual(checkpoint);expect(d.web.store.openStage('environment',step.id,'generation',step.stage)).toEqual(ref);await p.stop();expect(d.web.store.checkpoint(ref.runId)).toEqual(checkpoint);d.storage.close();
});

it.each([0,1] as const)('one_shot_version_%s_waits_for_cleanup_before_return',async version=>{
 const {d,step}=asyncFixture();d.environmentStore.saveStep({...step,preparationVersion:version});const ref=savedWeb(d,step);let release!:()=>void;
 const finalize=d.web.finalizeOwner?.bind(d.web);vi.spyOn(d.web,'finalizeOwner').mockImplementation(async(...args)=>{await new Promise<void>(resolve=>release=resolve);await finalize!(...args);});
 const running=runEnvironmentStep(d,step.id,async()=>({stage:'world',changes:[]}));let done=false;void running.then(()=>done=true);await setImmediate();expect(done).toBe(false);expect(d.web.store.checkpoint(ref.runId)).not.toBeNull();release();await running;expect(d.web.store.checkpoint(ref.runId)).toBeNull();expect(d.environmentStore.step(step.id)?.inputSnapshot===null).toBe(version===1);d.storage.close();
});

it.each(['already-terminal','expired-before','expired-error','expired-result'] as const)('legacy_%s_finalizes_checkpoint_and_retains_legacy_payload',async route=>{
 const {d,step}=asyncFixture(),snapshot=freezeEnvironmentSnapshot(d,step,NOW);d.environmentStore.saveStep({...step,preparationVersion:0,inputSnapshot:snapshot.input,status:route==='already-terminal'?'superseded':'pending'});const ref=savedWeb(d,step);
 if(route==='expired-before')d.clock.advance(86400000);
 await runEnvironmentStep(d,step.id,async()=>{if(route.startsWith('expired-'))d.clock.advance(86400000);if(route==='expired-error')throw new ModelRequestError('transport');return {stage:'world',changes:[]};});
 expect(d.web.store.checkpoint(ref.runId)).toBeNull();expect(d.environmentStore.step(step.id)?.inputSnapshot).toEqual(snapshot.input);expect(d.environmentStore.step(step.id)?.terminalAudit).toBeUndefined();d.storage.close();
});
