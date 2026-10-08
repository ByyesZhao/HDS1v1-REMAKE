import {it,expect} from 'vitest';
import {setup,NOW} from './helpers';
import {ensureEnvironmentBatch,selectEnvironmentStep,environmentDeadline} from '../src/environment/scheduler';
import {runEnvironmentStep} from '../src/environment/runtime';
import {Scheduler} from '../src/host/scheduler';
it('timezone_change_supersedes_old_identity_and_selected_step_can_progress',async()=>{
 const d=setup();d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});const old=ensureEnvironmentBatch(d.storage,d.config,NOW)!;d.config.timezone='UTC';d.clock.time='2026-10-07T16:30:00Z';
 const request=await new Scheduler(d.storage,d.config).collectReady(d.clock.now());expect(d.environmentStore.batch(old.id)?.status).toBe('superseded');const selected=selectEnvironmentStep(d.storage,d.clock.now())!;expect(d.environmentStore.batch(selected.batchId)?.timezone).toBe('UTC');expect(request?.environmentStepId).toBe(selected.id);
 await runEnvironmentStep(d,selected.id,async()=>({stage:'world',changes:[]}));expect(d.environmentStore.step(selected.id)?.status).toBe('committed');d.storage.close();
});
it.each(['05:00','06:00'])('completed_batch_timezone_change_reconciles_local_six_%s',time=>{
 const d=setup();d.config.timezone='UTC';d.clock.time='2026-10-07T08:00:00Z';d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});const old=ensureEnvironmentBatch(d.storage,d.config,d.clock.now())!;d.environmentStore.saveBatch({...old,status:'committed',closedAt:d.clock.now()});for(const s of d.environmentStore.steps(old.id))d.environmentStore.saveStep({...s,status:'committed'});
 d.config.timezone='Asia/Shanghai';d.clock.time=`2026-10-08T${time}:00+08:00`;const current=ensureEnvironmentBatch(d.storage,d.config,d.clock.now());if(time==='05:00'){expect(current).toBeNull();expect(Date.parse(environmentDeadline(d.storage,d.clock.now())!)).toBe(Date.parse('2026-10-08T06:00:00+08:00'));d.clock.time='2026-10-08T06:00:00+08:00';ensureEnvironmentBatch(d.storage,d.config,d.clock.now());}
 expect(d.environmentStore.batches().find(b=>b.status==='active')).toMatchObject({timezone:'Asia/Shanghai',localDate:'2026-10-08'});expect(selectEnvironmentStep(d.storage,d.clock.now())?.stage).toBe('world');d.storage.close();
});
it('same_day_return_to_superseded_timezone_does_not_reopen_steps_or_leave_hot_deadline',()=>{
 const d=setup();d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});const old=ensureEnvironmentBatch(d.storage,d.config,NOW)!;d.config.timezone='UTC';ensureEnvironmentBatch(d.storage,d.config,NOW);expect(d.environmentStore.batch(old.id)?.status).toBe('superseded');d.config.timezone='Asia/Shanghai';d.clock.time='2026-10-07T14:00:00+08:00';
 for(let i=0;i<2;i++){ensureEnvironmentBatch(d.storage,d.config,d.clock.now());expect(selectEnvironmentStep(d.storage,d.clock.now())).toBeNull();expect(Date.parse(environmentDeadline(d.storage,d.clock.now())!)).toBe(Date.parse('2026-10-08T06:00:00+08:00'));}expect(d.environmentStore.batches()).toHaveLength(1);expect(d.environmentStore.steps(old.id).every(s=>s.status==='superseded'&&s.attempt===0)).toBe(true);d.storage.close();
});
