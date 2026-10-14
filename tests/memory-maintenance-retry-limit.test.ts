import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {setup,narrative,silent,emptyMemory,ScriptedModels,NOW} from './helpers';
import {MemoryIdle} from '../src/memory/idle';
import {Storage} from '../src/storage';
import {EnvironmentStore} from '../src/environment/store';
import {SchoolStore} from '../src/school/store';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance,type MaintenanceOptions} from '../src/memory/maintenance';
import {ModelClient,ModelRequestError,type Transport} from '../src/model/client';
import {ModelRunHistory} from '../src/model/run-history';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {EnvironmentPreparation} from '../src/environment/preparation';
import {SerialHost} from '../src/host/runtime';
import {HdsiApp} from '../src/app';
import type {MaintenanceJob} from '../src/memory/types';
import {stageInput} from '../src/model/context-views';
import type {StageModelInput} from '../src/model/context-types';
const all:Array<{host:SerialHost;storage:Storage}>=[],directories:string[]=[];
afterEach(async()=>{for(const d of all.splice(0)){await d.host.stop().catch(()=>{});d.storage.close();}vi.restoreAllMocks();vi.useRealTimers();for(const path of directories.splice(0)){if(dirname(resolve(path))!==resolve(tmpdir()))throw Error('unsafe test cleanup');rmSync(path,{recursive:true,force:true});}});
function disk(){const dir=mkdtempSync(join(tmpdir(),'hdsi-m2-'));directories.push(dir);return join(dir,'test.sqlite');}
async function settled(d:ReturnType<typeof create>){for(let n=0;n<100&&d.maintenance.inFlight;n++)await new Promise<void>(r=>setImmediate(r));expect(d.maintenance.inFlight).toBe(false);await d.host.wake();}
const good={units:[{unitKey:'keep',action:'retain',ids:['s'],readOwners:['s'],sourceIds:[]}]};
function create(transport:Transport={complete:async()=>{throw Error('offline model failure');}},path=':memory:',options:Partial<MaintenanceOptions>={}){
 const base=setup();let storage=base.storage;if(path!==':memory:'){storage=new Storage(path);if(!storage.get('character')){storage.set('character',base.storage.character());storage.set('runtime',base.storage.runtime());}base.storage.close();}
 storage.set('runtime',{...storage.runtime(),nextMaintenanceAt:null,nextEnvironmentAt:'2027-01-01T00:00:00.000Z'});
 const store=new MemoryStore(storage);store.migrate(base.clock.now());
 const lifecycle=new MemoryLifecycle(store),index=new MemoryIndex(store,{model:'offline',embed:async()=>[1,0]},{clock:base.clock});
 const web=new WebSearchService(new WebSearchStore(storage),undefined,base.clock),models=new ModelClient(transport,undefined,undefined,new ModelRunHistory(storage,base.clock));
 let host!:SerialHost;const errors:unknown[]=[];
 const maintenance=new MemoryMaintenance(store,lifecycle,index,models,{clock:base.clock,web,onReady:()=>void host.wake(),...options});
 const d={...base,storage,environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),memoryStore:store,memoryLifecycle:lifecycle,maintenance,web,models};
 host=new SerialHost(new HdsiApp(d),{timers:false,onError:e=>errors.push(e)});
 const result={...d,store,index,host,errors};all.push(result);return result;
}
function seed(d:ReturnType<typeof create>,id='job',extra:Partial<MaintenanceJob>={}){
 const row=d.store.makeOwner({ownerType:'short',ownerId:'s'},{content:'synthetic event',shortExpiresAt:d.clock.now()},d.clock.now());d.store.saveOwner(row);
 const job:MaintenanceJob={id,createdAt:d.clock.now(),cutoff:d.clock.now(),startedAt:null,status:'pending',snapshot:[row],selectedIds:['s'],readSet:[row],result:null,appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null,...extra};d.store.saveJob('memory_maintenance_jobs',job);return job;
}
const job=(d:ReturnType<typeof create>,id='job')=>d.store.job<MaintenanceJob>('memory_maintenance_jobs',id)!;
async function failThree(d:ReturnType<typeof create>){for(let n=0;n<3;n++){expect(d.maintenance.startOne(d.clock.now())).toBe(true);await settled(d);if(n<2){expect(d.maintenance.startOne(d.clock.now())).toBe(false);d.clock.advance(300000);}}}
it('third_failure_pauses_host_and_reports_once',async()=>{
 let calls=0;const d=create({complete:async()=>{calls++;throw Error('offline failure');}});seed(d);await failThree(d);
 expect(calls).toBe(3);expect(job(d)).toMatchObject({status:'failed',retryAt:null,retryCycle:1,executionAttemptCount:3,failureCount:3});
 expect(d.storage.runtime()).toMatchObject({paused:true,lastFailure:{stage:'maintenance',jobId:'job',retryCycle:1},maintenancePause:{jobId:'job',retryCycle:1}});
 for(let n=0;n<3;n++){d.clock.advance(300000);await d.host.wake();expect(d.maintenance.startOne(d.clock.now())).toBe(false);}
 expect(d.sender.errors).toEqual(['记忆整合重试耗尽，程序已暂停']);expect(d.errors).toHaveLength(1);expect(await d.host.status()).toContain('job');
 expect(new ModelRunHistory(d.storage,d.clock).list({ownerType:'maintenance',ownerId:'job'}).filter(r=>r.type==='failure'&&r.stage==='maintenance')).toHaveLength(3);
});
it('consolidation_times_out_at_600_seconds_not_120',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});let signal:AbortSignal|undefined;const d=create({complete:async (_r,options)=>{signal=options?.signal;return new Promise(()=>{});}});seed(d);d.maintenance.startOne(d.clock.now());
 await vi.advanceTimersByTimeAsync(599999);expect(signal!.aborted).toBe(false);expect(job(d).status).toBe('computing');
 await vi.advanceTimersByTimeAsync(1);await settled(d);expect(signal!.aborted).toBe(true);expect(job(d)).toMatchObject({status:'pending',failureCount:1,executionAttemptCount:1});
});
it('index_timeout_remains_120_seconds',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const d=create();const row=seed(d).snapshot[0];d.storage.prepare('DELETE FROM memory_maintenance_jobs').run();
 d.index.prepare=async()=>new Promise(()=>{});d.store.queueIndex(row,d.clock.now(),d.index.configSignature);d.maintenance.startOne(d.clock.now());
 await vi.advanceTimersByTimeAsync(119999);expect(d.maintenance.inFlight).toBe(true);await vi.advanceTimersByTimeAsync(1);await settled(d);expect(d.store.jobs<any>('memory_index_jobs')[0].status).toBe('pending');expect(d.storage.runtime().paused).toBe(false);
});
it('successful_second_attempt_keeps_first_error',async()=>{
 let calls=0;const d=create({complete:async()=>{if(++calls===1)throw Error('first error');return good;}});seed(d);d.maintenance.startOne(d.clock.now());await settled(d);d.clock.advance(300000);d.maintenance.startOne(d.clock.now());await settled(d);
 expect(job(d)).toMatchObject({status:'done',executionAttemptCount:2,failureCount:1});expect(new ModelRunHistory(d.storage,d.clock).list({ownerType:'maintenance',ownerId:'job'}).some(r=>r.type==='failure'&&r.stage==='maintenance')).toBe(true);
});
it('retry_limit_survives_disk_reopen_and_computing_interruption',async()=>{
 const path=disk(),d=create(undefined,path);seed(d);for(let n=0;n<2;n++){d.maintenance.startOne(d.clock.now());await settled(d);d.clock.advance(300000);}
 const current=job(d);d.store.saveJob('memory_maintenance_jobs',{...current,status:'computing',executionAttemptCount:3,attemptId:'interrupted-third'});await d.host.stop();d.storage.close();all.splice(all.indexOf(d),1);
 const e=create(undefined,path);expect(job(e)).toMatchObject({status:'failed',failureCount:3,executionAttemptCount:3});await e.host.start();expect(e.sender.errors).toHaveLength(1);
 await e.host.stop();e.storage.close();all.splice(all.indexOf(e),1);const f=create(undefined,path);await f.host.start();expect(job(f).failureCount).toBe(3);expect(f.sender.errors).toHaveLength(0);
});
it('manual_resume_opens_only_failed_owner_cycle',async()=>{
 const d=create();seed(d);await failThree(d);seed(d,'unrelated',{status:'failed',retryCycle:4,executionAttemptCount:3,failureCount:3,failedAt:d.clock.now()});
 d.storage.set('runtime',{...d.storage.runtime(),lastFailure:{kind:'error',stage:'generation',at:d.clock.now(),safeSummary:'front failed'}});
 // Prevent immediate model dispatch after resume so the reset can be observed.
 d.storage.set('runtime',{...d.storage.runtime(),openBatch:{id:'hold',readyAt:'2027-01-01T00:00:00Z'}});
 await d.host.resume();expect(job(d)).toMatchObject({status:'pending',retryCycle:2,executionAttemptCount:0,failureCount:0,failedAt:null});expect(job(d,'unrelated')).toMatchObject({retryCycle:4,failureCount:3});expect(d.storage.runtime()).toMatchObject({paused:false,maintenancePause:null,lastFailure:null});
});
it('resumes a persisted failed owner with exhausted format budget and accepts its supplied read refs',async()=>{
 const path=disk(),d=create(undefined,path),old=seed(d,'job',{status:'failed',startedAt:NOW,retryCycle:1,executionAttemptCount:3,failureCount:3,failedAt:NOW});
 const ref=d.web.store.openStage('maintenance','job','consolidation','memory_consolidation');
 const input=stageInput('memory_consolidation',{snapshot:old.snapshot,selectedIds:['s'],cutoff:NOW});
 d.web.store.saveCheckpoint(ref.runId,{formatVersion:2,input,repairCount:2,lookupUsed:false,pendingOperationId:null,toolResults:[],repair:{original:{units:[]},errors:'readOwners: unknown snapshot owner'}});
 d.storage.set('runtime',{...d.storage.runtime(),paused:true,maintenancePause:{jobId:'job',retryCycle:1,task:'memory_consolidation',at:NOW,safeSummary:'记忆整合重试耗尽，程序已暂停',notification:'sent'}});
 await d.host.stop();d.storage.close();all.splice(all.indexOf(d),1);
 const e=create({complete:async request=>{
  const resources=(request.input as StageModelInput).resources;
  return {units:[{...good.units[0],readOwners:[resources.owners[0].ref]}]};
 }},path);
 await e.host.resume();await settled(e);await e.host.wake();
 expect(job(e)).toMatchObject({status:'done',retryCycle:2,executionAttemptCount:1,failureCount:0,appliedUnitKeys:['keep']});
 expect(e.storage.runtime()).toMatchObject({paused:false,maintenancePause:null});
 expect(e.store.owner({ownerType:'short',ownerId:'s'})!.consolidatedRevision).toBe(1);
 expect(e.web.store.snapshot(ref.runId).checkpoint).toBeNull();expect(e.sender.errors).toHaveLength(0);
});
it('archive_failure_after_prepare_preserves_ready_result_and_retries_without_model',async()=>{
 let calls=0;const d=create({complete:async()=>{calls++;return good;}});seed(d);
 d.storage.prepare("CREATE TRIGGER fail_archive BEFORE INSERT ON model_run_records WHEN json_extract(NEW.data,'$.type')='checkpoint' BEGIN SELECT RAISE(ABORT,'archive unavailable'); END").run();
 d.maintenance.startOne(d.clock.now());await settled(d);expect(job(d)).toMatchObject({status:'ready',failureCount:1,executionAttemptCount:1});expect(job(d).result).toHaveLength(1);
 const checkpoint=()=>d.web.store.snapshot(d.web.store.openStage('maintenance','job','consolidation','memory_consolidation').runId).checkpoint;expect(checkpoint()).not.toBeNull();
 for(let n=0;n<2;n++){d.clock.advance(300000);await d.host.wake();}expect(job(d)).toMatchObject({status:'failed',failureCount:3,executionAttemptCount:3});expect(calls).toBe(1);expect(checkpoint()).not.toBeNull();expect(d.sender.errors).toHaveLength(1);
 d.storage.prepare('DROP TRIGGER fail_archive').run();await d.host.resume();expect(job(d).status).toBe('done');expect(calls).toBe(1);expect(checkpoint()).toBeNull();
});
it('notification_failure_is_claimed_before_send_and_not_resent_after_reopen',async()=>{
 const path=disk(),d=create(undefined,path);seed(d);let sends=0;d.sender.sendError=async()=>{sends++;throw Error('offline sender');};await failThree(d);expect(sends).toBe(1);expect(d.storage.runtime().maintenancePause?.notification).toBe('failed');
 await d.host.stop();d.storage.close();all.splice(all.indexOf(d),1);const e=create(undefined,path);await e.host.start();expect(e.sender.errors).toHaveLength(0);expect(e.storage.runtime().paused).toBe(true);expect(job(e).retryCycle).toBe(1);
});
it('graceful_stop_does_not_count_successful_drain_as_failure',async()=>{
 let finish!:(v:unknown)=>void;const d=create({complete:async()=>new Promise(r=>finish=r)});seed(d);d.maintenance.startOne(d.clock.now());const stopping=d.host.stop({graceful:true});finish(good);await stopping;expect(job(d)).toMatchObject({status:'ready',failureCount:0,executionAttemptCount:1});
});

function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(predicate:()=>boolean){for(let n=0;n<100&&!predicate();n++)await new Promise<void>(r=>setImmediate(r));expect(predicate()).toBe(true);}
it.each(['success','failure'] as const)('foreground_%s_preserves_maintenance_pause_owner_in_real_host',async outcome=>{
 const backend=deferred<unknown>(),front=deferred<unknown>();let calls=0,frontStarted=false;
 const d=create({complete:async request=>{
  if(request.task.name==='memory_consolidation'){if(++calls<3)throw Error('backend failed');return backend.promise;}
  if(request.task.name==='narrative'){frontStarted=true;return front.promise;}
  if(request.task.name==='personal_chat')return silent;
  if(request.task.name==='memory')return emptyMemory;
  throw Error('unexpected task '+request.task.name);
 }});seed(d);
 for(let n=0;n<2;n++){d.maintenance.startOne(d.clock.now());await settled(d);d.clock.advance(300000);}
 d.maintenance.startOne(d.clock.now());await d.host.acceptInput({id:'front',content:'hello',receivedAt:d.clock.now()});d.clock.advance(15000);const wake=d.host.wake();await until(()=>frontStarted);
 backend.reject(Error('third failure'));await until(()=>!d.maintenance.inFlight);expect(d.storage.runtime().maintenancePause).toMatchObject({jobId:'job',retryCycle:1,notification:'pending'});expect(d.sender.errors).toHaveLength(0);
 if(outcome==='success')front.resolve(narrative);else front.reject(Error('front failure'));await wake;await d.host.wake();
 expect(d.storage.runtime()).toMatchObject({paused:true,maintenancePause:{jobId:'job',retryCycle:1,notification:'sent'}});expect(job(d)).toMatchObject({status:'failed',retryCycle:1,failureCount:3});
 expect(d.sender.errors.filter(s=>s==='记忆整合重试耗尽，程序已暂停')).toHaveLength(1);
 if(outcome==='failure')expect(d.storage.runtime().lastFailure?.stage).toBe('generation');else expect(d.storage.unfinishedTurn()).toBeNull();
});
it.each([false,true])('failed_owner_cannot_be_recreated_to_bypass_budget (idle=%s)',async idleMode=>{
 const d=create(),old=seed(d,'failed',{status:'failed',startedAt:d.clock.now(),retryCycle:1,executionAttemptCount:3,failureCount:3,failedAt:d.clock.now()});d.store.queueDirty(old.snapshot[0],'event',d.clock.now());
 d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:d.clock.now()});
 const idle=idleMode?new MemoryIdle(d.storage,15,true):undefined;
 const executor=new MemoryMaintenance(d.store,d.memoryLifecycle,d.index,d.models,{clock:d.clock,idle});
 expect(executor.startOne(d.clock.now())).toBe(false);expect(d.store.jobs('memory_maintenance_jobs')).toHaveLength(1);expect(d.store.activeMaintenanceJobsReferencing(old.snapshot[0]).map(j=>j.id)).toEqual(['failed']);
 await executor.stop();
});
it('legacy_computing_baseline_does_not_invent_historical_attempts',async()=>{
 const path=disk(),d=create(undefined,path);seed(d,'legacy',{status:'computing',startedAt:d.clock.now()});await d.host.stop();d.storage.close();all.splice(all.indexOf(d),1);
 const e=create(undefined,path);expect(job(e,'legacy')).toMatchObject({status:'pending',retryBaseline:'legacy',retryCycle:1,executionAttemptCount:1,failureCount:1});
 expect(e.maintenance.startOne(e.clock.now())).toBe(false);
 await e.host.stop();e.storage.close();all.splice(all.indexOf(e),1);const f=create(undefined,path);expect(job(f,'legacy')).toMatchObject({executionAttemptCount:1,failureCount:1});
 f.clock.advance(300000);f.maintenance.startOne(f.clock.now());await settled(f);expect(job(f,'legacy')).toMatchObject({executionAttemptCount:2,failureCount:2});
});
it('ready_result_commit_failure_never_regenerates_and_units_share_attempt',async()=>{
 let calls=0;const d=create({complete:async()=>{calls++;throw Error('must not regenerate');}}),first=seed(d),second=d.store.makeOwner({ownerType:'short',ownerId:'s2'},{content:'other'},d.clock.now());d.store.saveOwner(second);
 const units=[first.snapshot[0],second].map(row=>({unitKey:row.id,action:'retain' as const,ids:[row.id],readSet:[row],sourceIds:[]}));
 d.store.saveJob('memory_maintenance_jobs',{...first,status:'ready',startedAt:d.clock.now(),snapshot:[first.snapshot[0],second],selectedIds:['s','s2'],readSet:[first.snapshot[0],second],result:units,retryCycle:1,executionAttemptCount:1,failureCount:1,attemptId:'first',settledAttemptId:'first'});
 d.storage.prepare("CREATE TRIGGER fail_commit BEFORE UPDATE ON memory_maintenance_jobs WHEN json_array_length(NEW.data,'$.appliedUnitKeys')=2 BEGIN SELECT RAISE(ABORT,'commit unavailable'); END").run();
 expect(d.maintenance.applyOneReady(d.clock.now())).toBe('applied');expect(job(d)).toMatchObject({executionAttemptCount:2,failureCount:1});
 expect(d.maintenance.applyOneReady(d.clock.now())).toBe('none');expect(job(d)).toMatchObject({executionAttemptCount:2,failureCount:2,appliedUnitKeys:['s']});
 d.clock.advance(300000);d.storage.prepare('DROP TRIGGER fail_commit').run();expect(d.maintenance.applyOneReady(d.clock.now())).toBe('applied');expect(job(d)).toMatchObject({status:'done',executionAttemptCount:3,failureCount:2});expect(calls).toBe(0);
});
it('storage_accounting_failure_is_owned_and_blocks_dispatch_during_stop',async()=>{
 const gate=deferred<unknown>(),d=create({complete:async()=>gate.promise});seed(d);d.maintenance.startOne(d.clock.now());
 d.storage.prepare("CREATE TRIGGER fail_accounting BEFORE INSERT ON model_run_records BEGIN SELECT RAISE(ABORT,'disk unavailable'); END").run();
 const stopping=d.host.stop({graceful:true});gate.reject(Error('model failed'));
 await expect(stopping).rejects.toThrow(/存储故障/);expect(d.storage.runtime().paused).toBe(true);expect(job(d).status).toBe('computing');expect(d.maintenance.startOne(d.clock.now())).toBe(false);
});
it('graceful_stop_archive_failure_remains_retryable_and_does_not_reject_unowned_promise',async()=>{
 const gate=deferred<unknown>(),d=create({complete:async()=>gate.promise});seed(d);d.maintenance.startOne(d.clock.now());
 d.storage.prepare("CREATE TRIGGER fail_archive BEFORE INSERT ON model_run_records WHEN json_extract(NEW.data,'$.type')='checkpoint' BEGIN SELECT RAISE(ABORT,'archive unavailable'); END").run();
 const stopping=d.host.stop({graceful:true});gate.resolve(good);await stopping;expect(job(d)).toMatchObject({status:'ready',failureCount:1,executionAttemptCount:1});expect(job(d).result).toHaveLength(1);expect(d.storage.runtime().paused).toBe(false);
});
it('terminal_failure_during_graceful_stop_is_reported_after_drain',async()=>{
 const gate=deferred<unknown>(),d=create({complete:async()=>gate.promise});seed(d,'job',{retryCycle:1,executionAttemptCount:2,failureCount:2,attemptId:'second',settledAttemptId:'second'});d.maintenance.startOne(d.clock.now());
 const stopping=d.host.stop({graceful:true});gate.reject(Error('third failure'));await stopping;expect(d.sender.errors).toEqual(['记忆整合重试耗尽，程序已暂停']);expect(d.errors).toHaveLength(1);expect(job(d)).toMatchObject({status:'failed',failureCount:3});
});

it('dispatch_persistence_failure_pauses_host_before_any_model_request',async()=>{
 let calls=0;const d=create({complete:async()=>{calls++;return good;}});seed(d);
 d.storage.prepare("CREATE TRIGGER fail_dispatch BEFORE UPDATE ON memory_maintenance_jobs WHEN json_extract(NEW.data,'$.status')='computing' BEGIN SELECT RAISE(ABORT,'write unavailable'); END").run();
 await d.host.start();expect(d.storage.runtime().paused).toBe(true);expect(calls).toBe(0);await d.host.wake();expect(d.errors).toHaveLength(1);
 await expect(d.host.resume()).rejects.toThrow(/存储故障/);expect(d.storage.runtime().paused).toBe(true);
});
it('storage_unavailable_take_error_drains_without_repeated_fault_creation',async()=>{
 const d=create();vi.spyOn(d.storage,'runtime').mockImplementation(()=>{throw Error('database inaccessible');});
 try{expect(d.maintenance.takeError()).toBeInstanceOf(Error);expect(d.maintenance.takeError()).toBeInstanceOf(Error);expect(d.maintenance.takeError()).toBeUndefined();}finally{vi.restoreAllMocks();}
});

it('all_stale_generated_result_stays_ready_when_archive_fails',async()=>{
 const gate=deferred<unknown>(),d=create({complete:async()=>gate.promise}),first=seed(d),dependency=d.store.makeOwner({ownerType:'long',ownerId:'dependency'},{content:'summary'},d.clock.now());d.store.saveOwner(dependency);
 d.store.saveJob('memory_maintenance_jobs',{...first,startedAt:d.clock.now(),snapshot:[first.snapshot[0],dependency],readSet:[first.snapshot[0],dependency]});d.maintenance.startOne(d.clock.now());
 d.store.pruneOwnerFromJobs(dependency,d.clock.now());d.storage.prepare("CREATE TRIGGER fail_archive BEFORE INSERT ON model_run_records WHEN json_extract(NEW.data,'$.type')='checkpoint' BEGIN SELECT RAISE(ABORT,'archive unavailable'); END").run();
 gate.resolve({units:[{...good.units[0],readOwners:['s','dependency']}]});await settled(d);
 expect(job(d)).toMatchObject({status:'ready',failureCount:1,staleUnitKeys:['keep']});expect(job(d).result).toHaveLength(1);
 expect(d.web.store.snapshot(d.web.store.openStage('maintenance','job','consolidation','memory_consolidation').runId).checkpoint).not.toBeNull();
 d.storage.prepare('DROP TRIGGER fail_archive').run();d.clock.advance(300000);await d.host.wake();expect(job(d)).toMatchObject({status:'done',executionAttemptCount:2,failureCount:1});expect(d.store.owner(first.snapshot[0])?.consolidatedRevision).toBeNull();
});
it('ready_archive_retry_survives_reopen_without_model_regeneration',async()=>{
 const path=disk(),d=create({complete:async()=>good},path);seed(d);
 d.storage.prepare("CREATE TRIGGER fail_archive BEFORE INSERT ON model_run_records WHEN json_extract(NEW.data,'$.type')='checkpoint' BEGIN SELECT RAISE(ABORT,'archive unavailable'); END").run();d.maintenance.startOne(d.clock.now());await settled(d);
 const prepared=job(d).result;await d.host.stop();d.storage.close();all.splice(all.indexOf(d),1);
 let calls=0;const e=create({complete:async()=>{calls++;throw Error('must not regenerate');}},path);expect(job(e).result).toEqual(prepared);expect(job(e)).toMatchObject({status:'ready',executionAttemptCount:1,failureCount:1});
 e.storage.prepare('DROP TRIGGER fail_archive').run();e.clock.advance(300000);await e.host.start();expect(calls).toBe(0);expect(job(e)).toMatchObject({status:'done',executionAttemptCount:2,failureCount:1});
});
it('manual_resume_keeps_same_run_and_exhausted_repair_budget',async()=>{
 let calls=0;const d=create({complete:async()=>({invalid:++calls})});seed(d);await failThree(d);expect(calls).toBe(5);
 const ref=d.web.store.openStage('maintenance','job','consolidation','memory_consolidation'),cp=d.web.store.snapshot(ref.runId).checkpoint!;expect(cp.repairCount).toBe(2);
 await d.host.resume();await settled(d);expect(calls).toBe(6);expect(job(d)).toMatchObject({retryCycle:2,failureCount:1,executionAttemptCount:1,status:'pending'});
 expect(d.web.store.openStage('maintenance','job','consolidation','memory_consolidation')).toEqual(ref);expect(d.web.store.snapshot(ref.runId).checkpoint).toMatchObject({repairCount:2,repair:cp.repair,executionAttempt:{retryCycle:2}});
 expect(job(d).terminalNotices).toEqual([{retryCycle:1,attemptedAt:expect.any(String),status:'sent'}]);
});
it('resume_with_both_failures_reopens_only_recorded_cycle_after_disk_reopen',async()=>{
 const path=disk(),backend=deferred<unknown>(),front=deferred<unknown>();let started=false;
 const d=create({complete:async request=>request.task.name==='memory_consolidation'?backend.promise:(started=true,front.promise)},path);seed(d,'job',{retryCycle:1,executionAttemptCount:2,failureCount:2,attemptId:'second',settledAttemptId:'second'});
 d.maintenance.startOne(d.clock.now());await d.host.acceptInput({id:'front-disk',content:'hello',receivedAt:d.clock.now()});d.clock.advance(15000);const wake=d.host.wake();await until(()=>started);backend.reject(Error('third'));await until(()=>!d.maintenance.inFlight);front.reject(Error('front failed'));await wake;await d.host.wake();
 const owner=job(d);d.store.saveJob('memory_maintenance_jobs',{...owner,id:'unrelated',retryCycle:9});expect(d.storage.runtime().lastFailure?.stage).toBe('generation');
 await d.host.stop();d.storage.close();all.splice(all.indexOf(d),1);
 const e=create(undefined,path);await e.host.start();expect(e.sender.errors).toHaveLength(0);expect(e.storage.runtime()).toMatchObject({paused:true,lastFailure:{stage:'generation'},maintenancePause:{jobId:'job',retryCycle:1}});
 const scripts=new ScriptedModels({narrative,personal_chat:silent,memory:emptyMemory,memory_consolidation:good});e.models.runModel=scripts.runModel.bind(scripts);await e.host.resume();await settled(e);
 expect(job(e)).toMatchObject({retryCycle:2,failureCount:0,executionAttemptCount:1,status:'done'});expect(job(e,'unrelated')).toMatchObject({retryCycle:9,status:'failed',failureCount:3});expect(e.storage.runtime().maintenancePause).toBeNull();expect(e.storage.unfinishedTurn()).toBeNull();
});
it('audit_uses_same_limit_and_original_task_name',async()=>{
 const names:string[]=[],d=create({complete:async request=>{names.push(request.task.name);throw Error('audit failure');}});const row=d.store.makeOwner({ownerType:'detail',ownerId:'detail'},{key:'detail',value:'known',content:'known'},d.clock.now());d.store.saveOwner(row);
 seed(d,'job',{kind:'audit',startedAt:d.clock.now(),snapshot:[row],selectedIds:['detail'],readSet:[row]});await failThree(d);expect(names).toEqual(['memory_consolidation','memory_consolidation','memory_consolidation']);
 expect(new ModelRunHistory(d.storage,d.clock).list({ownerType:'maintenance',ownerId:'job'}).filter(r=>r.type==='failure'&&r.stage==='maintenance').every(r=>r.taskName==='memory_consolidation')).toBe(true);expect(d.storage.runtime().maintenancePause?.task).toBe('memory_consolidation');
});
it('zero_retries_stops_on_first_failure',async()=>{
 const d=create(undefined,':memory:',{consolidationMaxRetries:0});seed(d);d.maintenance.startOne(d.clock.now());await settled(d);expect(job(d)).toMatchObject({status:'failed',executionAttemptCount:1,failureCount:1});expect(d.storage.runtime().paused).toBe(true);
});

it('capacity_upgrade_keeps_computing_until_executor_reconciles_without_constructor_callback',async()=>{
 const d=create();seed(d,'job',{status:'computing',startedAt:d.clock.now(),retryCycle:1,executionAttemptCount:3,failureCount:2,attemptId:'third',settledAttemptId:'second'});
 d.storage.set('runtime',{...d.storage.runtime(),memoryCapacityVersion:undefined});d.store.migrateCapacity(d.clock.now());expect(job(d).status).toBe('computing');
 let wakes=0;const executor=new MemoryMaintenance(d.store,d.memoryLifecycle,d.index,d.models,{clock:d.clock,onReady:()=>{wakes++;throw Error('Host not assigned yet');}});
 expect(wakes).toBe(0);expect(job(d)).toMatchObject({status:'failed',failureCount:3,executionAttemptCount:3});expect(d.storage.runtime().maintenancePause).toMatchObject({jobId:'job',notification:'pending'});await executor.stop();
});

it('unpersistable_pause_still_blocks_foreground_on_repeated_host_wake',async()=>{
 let frontCalls=0;const d=create({complete:async request=>{if(request.task.name==='memory_consolidation')throw Error('backend');frontCalls++;return request.task.name==='narrative'?narrative:request.task.name==='memory'?emptyMemory:silent;}});seed(d);
 d.storage.prepare("CREATE TRIGGER fail_history BEFORE INSERT ON model_run_records BEGIN SELECT RAISE(ABORT,'history unavailable'); END").run();
 d.storage.prepare("CREATE TRIGGER fail_pause BEFORE UPDATE ON state WHEN NEW.key='runtime' AND json_extract(NEW.data,'$.paused')=1 BEGIN SELECT RAISE(ABORT,'pause unavailable'); END").run();
 d.maintenance.startOne(d.clock.now());await until(()=>!d.maintenance.inFlight);expect(d.storage.runtime().paused).toBe(false);
 await d.host.acceptInput({id:'after-storage-fault',content:'hello',receivedAt:d.clock.now()});d.clock.advance(15000);for(let n=0;n<4;n++)await d.host.wake();expect(frontCalls).toBe(0);expect(d.storage.unfinishedTurn()).toBeNull();
});

it.each([false,true])('graceful_stop_rejects_previously_consumed_storage_fault_after_all_drains (pauseWriteFails=%s)',async pauseWriteFails=>{
 const d=create();seed(d);d.storage.prepare("CREATE TRIGGER fail_accounting BEFORE INSERT ON model_run_records BEGIN SELECT RAISE(ABORT,'history unavailable'); END").run();
 if(pauseWriteFails)d.storage.prepare("CREATE TRIGGER fail_pause BEFORE UPDATE ON state WHEN NEW.key='runtime' AND json_extract(NEW.data,'$.paused')=1 BEGIN SELECT RAISE(ABORT,'pause unavailable'); END").run();
 d.maintenance.startOne(d.clock.now());await settled(d);for(let n=0;n<3;n++)await d.host.wake();expect(d.maintenance.hasStorageFault).toBe(true);expect(d.maintenance.takeError()).toBeUndefined();expect(d.errors.length).toBeGreaterThan(0);
 const backgroundGate=deferred<void>(),environmentGate=deferred<void>(),backgroundStop=d.maintenance.stop.bind(d.maintenance),environmentStop=EnvironmentPreparation.prototype.stop;
 vi.spyOn(d.maintenance,'stop').mockImplementation(async options=>{await backgroundStop(options);await backgroundGate.promise;});
 vi.spyOn(EnvironmentPreparation.prototype,'stop').mockImplementation(async function(this:EnvironmentPreparation,options){await environmentStop.call(this,options);await environmentGate.promise;});
 let result:'pending'|'resolved'|'rejected'='pending';let fault:unknown;const stopping=d.host.stop({graceful:true}).then(()=>{result='resolved';},error=>{result='rejected';fault=error;});
 await new Promise<void>(r=>setImmediate(r));expect(result).toBe('pending');backgroundGate.resolve();await new Promise<void>(r=>setImmediate(r));expect(result).toBe('pending');environmentGate.resolve();await stopping;
 expect(result).toBe('rejected');expect(fault).toBeInstanceOf(Error);expect((fault as Error).message).toMatch(/存储故障/);expect(d.maintenance.takeError()).toBeUndefined();
});
it.each([{phase:'archive',recovery:'retry'},{phase:'archive',recovery:'resume'},{phase:'apply',recovery:'retry'},{phase:'apply',recovery:'resume'}] as const)('immutable $phase diagnostic survives $recovery and successful completion',async({phase,recovery})=>{
 let calls=0;const d=create({complete:async()=>{calls++;return good;}},':memory:',{consolidationMaxRetries:recovery==='resume'?0:2});seed(d);
 const detail=phase==='archive'?'specific archive failure':'specific commit failure';
 d.storage.prepare(phase==='archive'?"CREATE TRIGGER fail_diagnostic BEFORE INSERT ON model_run_records WHEN json_extract(NEW.data,'$.type')='checkpoint' BEGIN SELECT RAISE(ABORT,'specific archive failure'); END":"CREATE TRIGGER fail_diagnostic BEFORE UPDATE ON memory_maintenance_jobs WHEN json_array_length(NEW.data,'$.appliedUnitKeys')>0 BEGIN SELECT RAISE(ABORT,'specific commit failure'); END").run();
 d.maintenance.startOne(d.clock.now());await settled(d);expect(job(d)).toMatchObject({status:recovery==='resume'?'failed':'ready',failureCount:1});
 expect(await d.host.status()).not.toContain(detail);expect(JSON.stringify(d.storage.runtime())).not.toContain(detail);
 d.storage.prepare('DROP TRIGGER fail_diagnostic').run();if(recovery==='resume')await d.host.resume();else{d.clock.advance(300000);await d.host.wake();}
 expect(job(d)).toMatchObject({status:'done',lastError:null});expect(calls).toBe(1);
 const records=new ModelRunHistory(d.storage,d.clock).list({ownerType:'maintenance',ownerId:'job'}).filter(r=>r.type==='failure'&&r.stage==='maintenance');expect(records).toHaveLength(1);expect(records[0]).toMatchObject({category:phase,error:expect.stringContaining(detail),retryCycle:1,attemptId:expect.any(String)});
});
it('unknown_transport_secret_is_not_copied_to_executor_history_or_public_status',async()=>{
 const secret='maintenance-secret-canary',d=create({complete:async()=>{throw Error('Authorization: Bearer '+secret);}});seed(d);d.maintenance.startOne(d.clock.now());await settled(d);
 const history=new ModelRunHistory(d.storage,d.clock).list({ownerType:'maintenance',ownerId:'job'});expect(JSON.stringify(history)).not.toContain(secret);expect(JSON.stringify(job(d))).not.toContain(secret);expect(await d.host.status()).not.toContain(secret);expect(JSON.stringify(d.storage.runtime())).not.toContain(secret);
 expect(history.filter(r=>r.type==='failure'&&r.stage==='maintenance')).toEqual([expect.objectContaining({category:'prepare',error:expect.stringContaining('preparation failed')})]);
});
it('safe_model_request_classification_is_retained_with_prepare_phase',async()=>{
 const d=create({complete:async()=>{throw new ModelRequestError('memory_consolidation: model HTTP 401 (request)',{httpStatus:401,kind:'request',taskName:'memory_consolidation'});}});seed(d);d.maintenance.startOne(d.clock.now());await settled(d);
 expect(new ModelRunHistory(d.storage,d.clock).list({ownerType:'maintenance',ownerId:'job'}).filter(r=>r.type==='failure'&&r.stage==='maintenance')).toEqual([expect.objectContaining({category:'prepare',error:expect.stringContaining('HTTP 401')})]);
});

it('local_archive_diagnostic_preserves_cause_but_redacts_credentials_and_bounds_size',async()=>{
 const d=create({complete:async()=>good});seed(d);
 const detail='specific archive failure; Authorization: Bearer local-bearer-canary; api_key=local-key-canary; url=https://user:local-password-canary@example.test/; '+ 'x'.repeat(2500);
 d.storage.prepare("CREATE TRIGGER fail_safe_detail BEFORE INSERT ON model_run_records WHEN json_extract(NEW.data,'$.type')='checkpoint' BEGIN SELECT RAISE(ABORT,'"+detail+"'); END").run();d.maintenance.startOne(d.clock.now());await settled(d);
 const records=new ModelRunHistory(d.storage,d.clock).list({ownerType:'maintenance',ownerId:'job'}).filter(r=>r.type==='failure'&&r.stage==='maintenance');expect(records).toHaveLength(1);
 const record=records[0];expect(record).toMatchObject({category:'archive',error:expect.stringContaining('specific archive failure')});if(record.type!=='failure')throw Error('expected failure');
 for(const secret of ['local-bearer-canary','local-key-canary','local-password-canary'])expect(record.error).not.toContain(secret);expect(record.error.length).toBeLessThanOrEqual(2100);expect(await d.host.status()).not.toContain('specific archive failure');
});
