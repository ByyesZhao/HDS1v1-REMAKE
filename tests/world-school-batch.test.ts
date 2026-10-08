import { it,expect,vi } from 'vitest';
import {setup as originalSetup,NOW} from './helpers';
function setup(){const d=originalSetup();d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});return d;}
import {ensureEnvironmentBatch,selectEnvironmentStep,environmentDeadline} from '../src/environment/scheduler';
import {runEnvironmentStep} from '../src/environment/runtime';
import {ModelRequestError} from '../src/model/client';
import {Scheduler} from '../src/host/scheduler';
import {SerialHost} from '../src/host/runtime';
import {HdsiApp} from '../src/app';
const empty:any=(input:any)=>({stage:input.stage,...(input.stage==='world'?{changes:[]}:input.stage==='school_week'?{instanceChanges:[],noticeCandidates:[],weekChanges:[]}:{planChanges:[],itemChanges:[]})});
it('bootstrap_same_date_once_and_daily_six_no_drift',()=>{
 const d=setup();d.clock.time='2026-10-08T05:00:00+08:00';
 const b=ensureEnvironmentBatch(d.storage,d.config,d.clock.now())!;
 expect(ensureEnvironmentBatch(d.storage,d.config,'2026-10-08T06:00:00+08:00')?.id).toBe(b.id);
 expect(d.environmentStore.batches()).toHaveLength(1);expect(d.storage.runtime().nextEnvironmentAt).toBe('2026-10-08T22:00:00.000Z');d.storage.close();
});
it('world_before_three_school_steps_and_ready_predecessor_blocks_downstream',async()=>{
 const d=setup();ensureEnvironmentBatch(d.storage,d.config,NOW);const stages=[];
 for(let i=0;i<4;i++){const s=selectEnvironmentStep(d.storage,NOW)!;stages.push(s.stage);await runEnvironmentStep(d,s.id,async input=>empty(input));}
 expect(stages).toEqual(['world','school_campus','school_group','school_week']);expect(selectEnvironmentStep(d.storage,NOW)).toBeNull();
 expect(d.storage.all('turns')).toEqual([]);expect(d.storage.character().narratedUntil).toBe(NOW);expect(d.sender.sent).toEqual([]);d.storage.close();
});
it('model_failure_not_pause_retry_wait_does_not_block_autonomy',async()=>{
 const d=setup();ensureEnvironmentBatch(d.storage,d.config,NOW);const s=selectEnvironmentStep(d.storage,NOW)!;
 await runEnvironmentStep(d,s.id,async()=>{throw new ModelRequestError('HTTP 503');});
 expect(d.storage.runtime().paused).toBe(false);expect(d.storage.unfinishedTurn()).toBeNull();expect(d.sender.errors).toEqual([]);
 expect(d.environmentStore.step(s.id)?.retryAt).toBe('2026-10-07T02:05:00.000Z');expect(selectEnvironmentStep(d.storage,NOW)).toBeNull();expect(environmentDeadline(d.storage,NOW)).toBe('2026-10-07T02:05:00.000Z');
 d.storage.set('character',{...d.storage.character(),nextAutonomousAt:NOW});expect((await new Scheduler(d.storage,d.config).collectReady(NOW))?.triggerKinds).toContain('autonomous');d.storage.close();
});
it('ready_restart_no_regeneration_and_storage_failure_not_model_retry',async()=>{
 const d=setup();ensureEnvironmentBatch(d.storage,d.config,NOW);const s=selectEnvironmentStep(d.storage,NOW)!;
 d.environmentStore.saveStep({...s,status:'ready',frozenResult:{stage:'world',changes:[]}});const generate=vi.fn();await runEnvironmentStep(d,s.id,generate);
 expect(generate).not.toHaveBeenCalled();expect(d.environmentStore.step(s.id)?.status).toBe('committed');
 const next=selectEnvironmentStep(d.storage,NOW)!;await expect(runEnvironmentStep(d,next.id,async()=>{throw Error('disk error');})).rejects.toThrow('disk error');expect(d.environmentStore.step(next.id)?.retryAt).toBeNull();d.storage.close();
});
it('cross_date_supersedes_only_uncommitted_including_running_response',async()=>{
 const d=setup();ensureEnvironmentBatch(d.storage,d.config,NOW);const old=selectEnvironmentStep(d.storage,NOW)!;
 await runEnvironmentStep(d,old.id,async input=>{d.clock.time='2026-10-08T00:01:00+08:00';return {stage:'world',changes:[{action:'create',event:{kind:'world',startsAt:NOW,endsAt:null,description:'旧日结果',basis:'fiction',sourceUrls:[]}}]};});
 expect(d.environmentStore.step(old.id)?.status).toBe('superseded');expect(d.environmentStore.step(old.id)?.frozenResult).not.toBeNull();expect(d.storage.all('events')).toEqual([]);
 expect(d.environmentStore.batches()).toHaveLength(2);d.storage.close();
});
it('open_batch_yields_before_new_step_and_no_hot_deadline',async()=>{
 const d=setup();ensureEnvironmentBatch(d.storage,d.config,NOW);const at='2026-10-07T10:00:15+08:00';d.storage.set('runtime',{...d.storage.runtime(),openBatch:{id:'b',readyAt:at}});
 const scheduler=new Scheduler(d.storage,d.config);expect(await scheduler.collectReady(NOW)).toBeNull();expect(await scheduler.nextDeadline(NOW)).toBe(at);d.storage.close();
});
it('input_arrives_during_request_committed_step_yields_before_next_generation',async()=>{
 const d=setup();const order:string[]=[];let release!:()=>void,entered!:()=>void;
 const seen=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);
 d.generateEnvironment=async input=>{order.push(input.stage);if(input.stage==='world'){entered();await blocked;}return empty(input);};
 const original=d.models.runModel.bind(d.models);d.models.runModel=async(task,input,options)=>{order.push(task.name);return original(task,input,options);};
 const host=new SerialHost(new HdsiApp(d),{timers:false});const pump=host.start();await seen;
 await host.acceptInput({id:'input',content:'你好',receivedAt:d.clock.now()});
 expect(d.storage.read('messages','input')).not.toBeNull();expect(order).toEqual(['world']);d.clock.advance(15000);release();await pump;
 expect(order.indexOf('narrative')).toBeGreaterThan(order.indexOf('world'));expect(order.indexOf('school_campus')).toBeGreaterThan(order.indexOf('memory'));
 expect(d.storage.read('messages','input')?.seenTurnId).not.toBeNull();await host.stop();d.storage.close();
});
it('running_restart_keeps_attempt_and_ready_blocks_later_steps',()=>{
 const d=setup();ensureEnvironmentBatch(d.storage,d.config,NOW);const s=selectEnvironmentStep(d.storage,NOW)!;
 d.environmentStore.saveStep({...s,status:'ready',attempt:1,frozenResult:{stage:'world',changes:[]}});
 expect(selectEnvironmentStep(d.storage,NOW)?.stage).toBe('world');expect(d.environmentStore.steps().filter(s=>s.inputSnapshot)).toEqual([]);d.storage.close();
});
