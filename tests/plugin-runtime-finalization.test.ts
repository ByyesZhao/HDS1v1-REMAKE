import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {request} from 'node:http';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setImmediate} from 'node:timers/promises';
import {createPluginRuntimeSync} from '../src/deployment/plugin-runtime';
import {loadSettings,modelRoles} from '../src/settings';
import {startStopControl} from '../src/deployment/stop-control';
import type {HdsiApp} from '../src/app';
import {TestClock,NOW} from './helpers';

vi.mock('koishi',async()=>(await import('node:module')).createRequire(`${process.cwd()}/package.json`)('koishi'));
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};}

// Real runtime/Host/Storage assembly. Only external generation and asynchronous
// media/browser drain boundaries are controlled; no provider network is used.
async function fixture(failAt?:'media'|'browser',failOwner=true,withBrowser=true){
 const root=mkdtempSync(join(tmpdir(),'hdsi-w7-close-')),events:string[]=[],logs:unknown[]=[],mediaGate=gate(),browserGate=gate(),generationGate=gate();
 vi.stubEnv('HDSI_TEST_W7_KEY','synthetic');
 const fetcher=vi.fn(async()=>{throw Error('external network forbidden in shutdown fixture');});vi.stubGlobal('fetch',fetcher);
 const connection={baseUrl:'https://example.invalid',apiKeyEnv:'HDSI_TEST_W7_KEY',model:'deepseek-flash'};
 writeFileSync(join(root,'story.json'),JSON.stringify({background:'synthetic',chatExamples:'synthetic',worldSetting:'',schoolSetting:'',initialScene:{description:'synthetic'},initialPlan:'synthetic',historyBudget:null,models:Object.fromEntries(modelRoles.map(role=>[role,connection])),memoryEmbedding:{baseUrl:'https://example.invalid',apiKeyEnv:'HDSI_TEST_W7_KEY'}}));
 const managed={provider:{signature:'synthetic',search:async()=>[],read:async()=>({bodyFormat:'text' as const,title:'unused',body:'unused'})},stopAccepting(){},dispose:async()=>{events.push('browser.start');await browserGate.promise;if(failAt==='browser')throw Error('browser drain failure');events.push('browser.end');}};
 const ctx={baseDir:root,bots:[],logger:()=>({error:(error:unknown)=>logs.push(error),warn(){}}),middleware(){},command:()=>({action(){}})};
 const runtime=createPluginRuntimeSync(ctx as any,{botId:'fixture',userId:'fixture',databasePath:'story.sqlite',storyConfigPath:'story.json'},loadSettings(join(root,'story.json')),withBrowser?managed:undefined);
 const d=(runtime.host as unknown as {app:HdsiApp}).app.dependencies,clock=new TestClock();d.clock=clock;
 d.storage.set('character',{...d.storage.character(),narratedUntil:NOW,sleep:null,nextAutonomousAt:null});d.storage.set('runtime',{...d.storage.runtime(),environmentPlanningVersion:2,nextEnvironmentAt:null});
 d.generateEnvironment=async()=>{await generationGate.promise;events.push('generation.end');return {stage:'world',changes:[]};};
 const mediaStop=d.incomingMedia!.stop.bind(d.incomingMedia),close=d.storage.close.bind(d.storage);
 vi.spyOn(d.incomingMedia!,'stop').mockImplementation(async options=>{events.push('media.start');await mediaGate.promise;if(failAt==='media')throw Error('media drain failure');await mediaStop(options);events.push('media.end');});
 let closed=false;vi.spyOn(d.storage,'close').mockImplementation(()=>{events.push('storage.close');close();closed=true;});
 await runtime.host.start();const step=d.storage.all('environment_steps').find(s=>s.stage==='world')!,ref=d.web!.store.openStage('environment',step.id,'generation','world');
 d.web!.store.saveCheckpoint(ref.runId,{formatVersion:2,input:{saved:'body'},repairCount:0,lookupUsed:false,lookupPending:false,pendingOperationId:null,toolResults:[]});
 clock.advance(86400000);await runtime.host.wake();
 if(failOwner)d.storage.prepare("CREATE TRIGGER fail_shutdown_finalize BEFORE UPDATE ON web_sessions WHEN json_extract(NEW.data,'$.checkpoint') IS NULL BEGIN SELECT RAISE(ABORT,'owner shutdown cleanup failure'); END").run();
 return {root,runtime,d,events,logs,fetcher,mediaGate,browserGate,generationGate,get closed(){return closed;},cleanup:async()=>{generationGate.release();mediaGate.release();browserGate.release();await runtime.close().catch(()=>{});if(!closed)close();vi.unstubAllEnvs();vi.unstubAllGlobals();rmSync(root,{recursive:true,force:true});}};
}

it('runtime_close_drains_media_then_browser_then_storage_after_host_cleanup_failure_and_logs_cause',async()=>{
 const f=await fixture();try{
 const closing=f.runtime.close({graceful:true});expect(f.runtime.close()).toBe(closing);let done=false;const result=closing.then(()=>undefined,error=>error);void result.then(()=>done=true);
 await setImmediate();expect(f.events).toEqual([]);f.generationGate.release();await setImmediate();expect(f.events).toEqual(['generation.end','media.start']);expect(done).toBe(false);expect(f.closed).toBe(false);
 f.mediaGate.release();await setImmediate();expect(f.events).toEqual(['generation.end','media.start','media.end','browser.start']);expect(done).toBe(false);expect(f.closed).toBe(false);
 f.browserGate.release();const error=await result;expect(error.message).toContain('owner shutdown cleanup failure');expect(f.events).toEqual(['generation.end','media.start','media.end','browser.start','browser.end','storage.close']);expect(f.closed).toBe(true);expect(f.logs.some(error=>String(error).includes('owner shutdown cleanup failure'))).toBe(true);
 expect(f.fetcher).not.toHaveBeenCalled();
 }finally{await f.cleanup();}
});

it.each(['media','browser'] as const)('runtime_close_preserves_host_and_%s_errors_without_closing_live_storage',async failAt=>{
 const f=await fixture(failAt);try{
 const result=f.runtime.close({graceful:true}).then(()=>undefined,error=>error);f.generationGate.release();f.mediaGate.release();f.browserGate.release();const error=await result;
 expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toHaveLength(2);expect(error.errors.map((e:Error)=>e.message)).toEqual([expect.stringContaining('owner shutdown cleanup failure'),`${failAt} drain failure`]);expect(f.closed).toBe(false);expect(f.d.storage.runtime()).toBeDefined();
 expect(f.events).not.toContain('storage.close');if(failAt==='media')expect(f.events).not.toContain('browser.start');expect(f.logs.some(error=>String(error).includes('owner shutdown cleanup failure'))).toBe(true);expect(f.logs.some(error=>String(error).includes(`${failAt} drain failure`))).toBe(true);
 expect(f.fetcher).not.toHaveBeenCalled();
 }finally{await f.cleanup();}
});

it('healthy_runtime_close_preserves_order_and_reports_success',async()=>{
 const f=await fixture(undefined,false);try{
 const closing=f.runtime.close({graceful:true});f.generationGate.release();f.mediaGate.release();f.browserGate.release();await closing;
 expect(f.events).toEqual(['generation.end','media.start','media.end','browser.start','browser.end','storage.close']);expect(f.logs).toEqual([]);expect(f.fetcher).not.toHaveBeenCalled();
 }finally{await f.cleanup();}
});

it.each([false,true])('stop_control_returns_failure_with_specific_runtime_logger_cause_after_resource_drain (browser=%s)',async withBrowser=>{
 const f=await fixture(undefined,true,withBrowser),file=join(f.root,'synthetic-control.json'),exit=vi.fn(),stopping=vi.spyOn(f.runtime.host,'stop'),control=await startStopControl(file,()=>f.runtime.close({graceful:true}),{exit});
 try{
 const descriptor=JSON.parse(readFileSync(file,'utf8'));const response=new Promise<{status:number;body:string}>((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:descriptor.port,path:'/stop',method:'POST',headers:{authorization:`Bearer ${descriptor.token}`}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode!,body}));});req.on('error',reject);req.end();});
 await vi.waitFor(()=>expect(stopping).toHaveBeenCalledTimes(1));f.generationGate.release();f.mediaGate.release();f.browserGate.release();const result=await response;expect(result.status).toBe(500);expect(JSON.parse(result.body).stopped).toBe(false);expect(exit).not.toHaveBeenCalled();expect(f.closed).toBe(true);expect(f.logs.some(error=>String(error).includes('owner shutdown cleanup failure'))).toBe(true);expect(f.fetcher).not.toHaveBeenCalled();
 }finally{await control.close();await f.cleanup();}
});
