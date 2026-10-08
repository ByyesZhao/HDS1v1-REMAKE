import {it,expect} from 'vitest';
import {setup,NOW} from './helpers';
import {ensureEnvironmentBatch,selectEnvironmentStep} from '../src/environment/scheduler';
import {runEnvironmentStep} from '../src/environment/runtime';
import {Scheduler} from '../src/host/scheduler';
it('timezone_change_supersedes_old_identity_and_selected_step_can_progress',async()=>{
 const d=setup();d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});const old=ensureEnvironmentBatch(d.storage,d.config,NOW)!;d.config.timezone='UTC';d.clock.time='2026-10-07T16:30:00Z';
 const request=await new Scheduler(d.storage,d.config).collectReady(d.clock.now());expect(d.environmentStore.batch(old.id)?.status).toBe('superseded');const selected=selectEnvironmentStep(d.storage,d.clock.now())!;expect(d.environmentStore.batch(selected.batchId)?.timezone).toBe('UTC');expect(request?.environmentStepId).toBe(selected.id);
 await runEnvironmentStep(d,selected.id,async()=>({stage:'world',changes:[]}));expect(d.environmentStore.step(selected.id)?.status).toBe('committed');d.storage.close();
});
