import {it,expect,vi} from 'vitest';
import {setup} from './helpers';
import {HdsiApp} from '../src/app';
import {SerialHost} from '../src/host/runtime';
import {WebSearchService} from '../src/web/service';
import {WebSearchStore} from '../src/web/store';
import {ensureEnvironmentBatch} from '../src/environment/scheduler';
import {setImmediate} from 'node:timers/promises';
it('chat formally commits while environment HTTP is unresolved; ready waits for foreground boundary',async()=>{
 const base=setup(),web=new WebSearchService(new WebSearchStore(base.storage),undefined,base.clock,{enabled:false}),d={...base,web};
 d.storage.set('runtime',{...d.storage.runtime(),environmentPlanningVersion:2,nextEnvironmentAt:null});
 let finish!:(v:any)=>void;let requests=0;
 d.generateEnvironment=async input=>{requests++;if(input.stage==='world')return new Promise(resolve=>{finish=resolve;});return {stage:input.stage,planChanges:[],itemChanges:[]} as any;};
 const host=new SerialHost(new HdsiApp(d),{timers:false});
 const wake=host.start();await setImmediate();
 expect(requests).toBe(1);await wake;
 expect(d.storage.all('events')).toHaveLength(0);
 await host.acceptInput({id:'chat',receivedAt:d.clock.now(),content:'早上好',platformMessageIds:[]});
 d.clock.advance(16000);await host.wake();
 expect(d.storage.all('turns').some(t=>t.done&&t.inputMessageIds.includes('chat'))).toBe(true);
 expect(d.storage.all('events')).toHaveLength(0);
 await host.pause();finish({stage:'world',changes:[]});await setImmediate();
 const step=d.storage.all('environment_steps').find(s=>s.stage==='world')!;
 expect(step.status).toBe('ready');expect(await host.status()).toContain('待提交');
 await host.stop();d.storage.close();
});
it('foreground_pump_does_not_wait_for_terminal_web_drain',async()=>{
 const base=setup();let release!:()=>void;const web=new WebSearchService(new WebSearchStore(base.storage),{signature:'fixture',search:async()=>[],read:async()=>{await new Promise<void>(resolve=>release=resolve);return {bodyFormat:'text',title:'late',body:'late body'};}},base.clock,{enabled:true}),d={...base,web};
 d.storage.set('runtime',{...d.storage.runtime(),environmentPlanningVersion:2,nextEnvironmentAt:null});
 d.generateEnvironment=async(input,options)=>{const session=options!.modelOptions!.web!,url='https://example.test/late',op=session.beginOperation({kind:'read',url});await session.readPage(url,{operationId:op.operationId});return {stage:input.stage,changes:[]} as any;};
 const errors:unknown[]=[];const host=new SerialHost(new HdsiApp(d),{timers:false,onError:error=>errors.push(error)});await host.start();await setImmediate();d.clock.advance(86400000);await host.wake();
 await host.acceptInput({id:'new-day-chat',receivedAt:d.clock.now(),content:'早上好',platformMessageIds:[]});d.clock.advance(16000);await host.wake();await setImmediate();await host.wake();expect(errors).toEqual([]);expect(d.storage.all('turns').some(t=>t.done&&t.inputMessageIds.includes('new-day-chat'))).toBe(true);
 const stopping=host.stop();release();await stopping;d.storage.close();
});

it('host_stop_waits_for_finalizers_before_storage_close',async()=>{
 const base=setup(),web=new WebSearchService(new WebSearchStore(base.storage),undefined,base.clock,{enabled:false}),d={...base,web};
 d.storage.set('runtime',{...d.storage.runtime(),environmentPlanningVersion:2,nextEnvironmentAt:null});let generateRelease!:(v:any)=>void,finalizeRelease!:()=>void;
 d.generateEnvironment=async()=>new Promise(resolve=>generateRelease=resolve);
 const finalize=web.finalizeOwner?.bind(web);vi.spyOn(web,'finalizeOwner').mockImplementation(async(...args)=>{if(!finalizeRelease)await new Promise<void>(resolve=>finalizeRelease=resolve);await finalize!(...args);});
 const host=new SerialHost(new HdsiApp(d),{timers:false});await host.start();const step=d.storage.all('environment_steps').find(s=>s.stage==='world')!,ref=web.store.openStage('environment',step.id,'generation','world');web.store.saveCheckpoint(ref.runId,{formatVersion:2,input:{saved:'body'},repairCount:0,lookupUsed:false,lookupPending:false,pendingOperationId:null,toolResults:[]});
 d.clock.advance(86400000);await host.wake();const stopping=host.stop();let stopped=false;void stopping.then(()=>stopped=true);generateRelease({stage:'world',changes:[]});await setImmediate();expect(stopped).toBe(false);finalizeRelease();await stopping;expect(web.store.checkpoint(ref.runId)).toBeNull();d.storage.close();
});

it.each([false,true])('host_stop_reports_cleanup_failure_only_after_all_finalizers_settle (graceful=%s)',async graceful=>{
 const base=setup(),web=new WebSearchService(new WebSearchStore(base.storage),undefined,base.clock,{enabled:false}),d={...base,web};
 d.storage.set('runtime',{...d.storage.runtime(),environmentPlanningVersion:2,nextEnvironmentAt:null});let generateRelease!:(v:any)=>void,cleanupRelease!:()=>void;
 d.generateEnvironment=async()=>new Promise(resolve=>generateRelease=resolve);
 const host=new SerialHost(new HdsiApp(d),{timers:false});await host.start();const steps=d.storage.all('environment_steps'),world=steps.find(s=>s.stage==='world')!,campus=steps.find(s=>s.stage==='school_campus')!;
 const refs=[world,campus].map(step=>web.store.openStage('environment',step.id,'generation',step.stage));
 for(const ref of refs)web.store.saveCheckpoint(ref.runId,{formatVersion:2,input:{saved:'recoverable'},repairCount:0,lookupUsed:false,lookupPending:false,pendingOperationId:null,toolResults:[]});
 const finalize=web.finalizeOwner.bind(web);vi.spyOn(web,'finalizeOwner').mockImplementation(async(type,id)=>{if(id===campus.id)await new Promise<void>(resolve=>cleanupRelease=resolve);await finalize(type,id);});
 d.clock.advance(86400000);await host.wake();
 d.storage.prepare("CREATE TRIGGER fail_shutdown_cleanup BEFORE UPDATE ON web_sessions WHEN json_extract(NEW.data,'$.checkpoint') IS NULL BEGIN SELECT RAISE(ABORT,'shutdown cleanup failure'); END").run();
 let done=false;const stopping=host.stop({graceful}).then(()=>({error:undefined}),error=>({error}));void stopping.then(()=>done=true);generateRelease({stage:'world',changes:[]});await setImmediate();
 expect(done).toBe(false);expect(web.store.checkpoint(refs[0].runId)).not.toBeNull();expect(web.store.checkpoint(refs[1].runId)).not.toBeNull();cleanupRelease();const result=await stopping;
 expect(result.error).toBeInstanceOf(AggregateError);expect((result.error as AggregateError).errors).toHaveLength(2);expect((result.error as AggregateError).errors.every(error=>error.message.includes('shutdown cleanup failure'))).toBe(true);
 expect(d.environmentStore.step(world.id)?.status).toBe('superseded');expect(web.store.checkpoint(refs[0].runId)).not.toBeNull();expect(web.store.checkpoint(refs[1].runId)).not.toBeNull();d.storage.close();
});
