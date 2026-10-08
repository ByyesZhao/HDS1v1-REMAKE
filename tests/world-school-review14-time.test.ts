import {it,expect} from 'vitest';
import {setup,NOW,narrative} from './helpers';
import {schoolItem,expand} from './world-school-fixture';
import {applySchoolChanges} from '../src/school/changes';
import {ensureEnvironmentBatch,selectEnvironmentStep,environmentDeadline} from '../src/environment/scheduler';
import {Scheduler} from '../src/host/scheduler';
import {narrativeSchoolContext,personalSchoolContext} from '../src/school/context';
import {prepareSchoolCommits} from '../src/school/progress';
it('midnight_supersedes_old_batch_but_daily_waits_until_six_and_deadline_is_not_hot',async()=>{
 const d=setup();d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});const old=ensureEnvironmentBatch(d.storage,d.config,NOW)!;d.clock.time='2026-10-08T00:05:00+08:00';const scheduler=new Scheduler(d.storage,d.config);
 expect(await scheduler.collectReady(d.clock.now())).toBeNull();expect(d.environmentStore.batch(old.id)?.status).toBe('superseded');expect(d.environmentStore.batches()).toHaveLength(1);expect(selectEnvironmentStep(d.storage,d.clock.now())).toBeNull();expect(environmentDeadline(d.storage,d.clock.now())).toBe('2026-10-07T22:00:00.000Z');
 d.clock.time='2026-10-08T06:00:00+08:00';expect((await scheduler.collectReady(d.clock.now()))?.environmentStepId).toBeDefined();expect(d.environmentStore.batches()).toHaveLength(2);d.storage.close();
});
it('bootstrap_and_explicit_upgrade_remain_eligible_before_six',()=>{
 const d=setup();d.clock.time='2026-10-08T05:00:00+08:00';d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});const batch=ensureEnvironmentBatch(d.storage,d.config,d.clock.now())!;expect(selectEnvironmentStep(d.storage,d.clock.now())).not.toBeNull();d.environmentStore.saveBatch({...batch,reason:'upgrade'});expect(selectEnvironmentStep(d.storage,d.clock.now())).not.toBeNull();d.storage.close();
});
function cancelled(){const d=setup(),before='2026-10-07T08:00:00+08:00',item=schoolItem({issuedAt:before,timing:{kind:'once',startsAt:'2026-10-07T09:00:00+08:00',endsAt:'2026-10-07T12:00:00+08:00'}});d.storage.save('school_plan_items',item.id,item);expand(d,before);const old=d.schoolStore.instances()[0];d.storage.save('school_knowledge','known',{id:'known',entityKind:'instance',entityId:old.id,revision:old.sourceRevision,snapshot:{entityKind:'instance',entityId:old.id,revision:old.sourceRevision,value:old},acquiredAt:'2026-10-07T09:15:00+08:00',experienceId:'old-e',turnId:'old-turn',via:'onsite'});d.storage.set('character',{...d.storage.character(),narratedUntil:'2026-10-07T09:00:00+08:00'});d.storage.transaction(()=>applySchoolChanges(d.storage,{stage:'school_campus',plans:[],items:[{...item,status:'cancelled',revision:2,deliveryRevision:2}]},NOW));return {d,old};}
it('ongoing_cancel_keeps_raw_history_and_old_known_but_clips_crossing_objective_interval',()=>{
 const {d,old}=cancelled(),scene={...d.storage.character().scene,description:'学院'};
 expect(d.storage.read('school_instances',old.id)).toMatchObject({...old,cancelledAt:NOW});
 const crossing=narrativeSchoolContext(d.storage,'2026-10-07T09:00:00+08:00','2026-10-07T11:00:00+08:00',scene);expect(crossing.objectiveInstances[0]?.endsAt).toBe(NOW);expect(crossing.objectiveInstances[0]?.sourceSnapshot).toEqual(old.sourceSnapshot);
 expect(narrativeSchoolContext(d.storage,NOW,'2026-10-07T11:00:00+08:00',scene).objectiveInstances).toEqual([]);expect(personalSchoolContext(d.storage,[],'').knownSnapshots[0].value).toEqual(old);d.storage.close();
});
it('onsite_before_cancel_is_allowed_but_after_cancel_is_rejected_in_same_crossing_turn',()=>{
 const {d,old}=cancelled(),turn:any={id:'t',at:'2026-10-07T11:00:00+08:00',schoolNoticeRefs:[]};const e={id:'e',happenedAt:'2026-10-07T09:30:00+08:00',description:'在学院现场看到安排',relatedEventIds:[old.id]},r={...narrative,experiences:[e],schoolObservations:[{via:'onsite' as const,sourceId:old.id,experienceIndex:0}]};
 const before=prepareSchoolCommits(d.storage,turn,r,[e]);expect(before.observations).toHaveLength(1);expect(before.observations[0].snapshots[0].value).toMatchObject({endsAt:old.endsAt});expect((before.observations[0].snapshots[0].value as any).cancelledAt).toBeUndefined();const later={...e,happenedAt:'2026-10-07T10:30:00+08:00'};expect(()=>prepareSchoolCommits(d.storage,turn,{...r,experiences:[later]},[later])).toThrow(/onsite/);d.storage.close();
});
