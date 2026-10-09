import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {Storage} from '../src/storage';
import {initialCharacter} from '../src/config';
import {TestClock,NOW} from './helpers';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {ModelClient,type CompletionRequest,type Transport} from '../src/model/client';
import {WebSearchService} from '../src/web/service';
import {WebSearchStore} from '../src/web/store';
import type {MaintenanceJob} from '../src/memory/types';

const good={units:[{unitKey:'keep',action:'retain',ids:['s'],readOwners:['s'],sourceIds:[]}]};
const resources:Array<{storage:Storage;maintenance:MemoryMaintenance}>=[];
const directories:string[]=[];
afterEach(async()=>{
 for(const d of resources.splice(0)){await d.maintenance.stop();d.storage.close();}
 vi.restoreAllMocks();vi.useRealTimers();
 for(const root of directories.splice(0)){
  const target=resolve(root);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('hdsi-r1-checkpoint-'))throw Error('unexpected temporary directory');
  rmSync(target,{recursive:true,force:true});
 }
});
async function until(predicate:()=>boolean){
 for(let n=0;n<100&&!predicate();n++)await new Promise<void>(resolve=>setImmediate(resolve));
 expect(predicate(),'expected asynchronous checkpoint/job state').toBe(true);
}
function fixture(transport:Transport,path=':memory:',withWeb=true,backgroundTimeoutMs=120000,onReady?:()=>void){
 const storage=new Storage(path),clock=new TestClock();
 if(!storage.get('character')){
  storage.set('character',initialCharacter(NOW));
  storage.set('runtime',{...storage.runtime(),nextMaintenanceAt:clock.now()});
 }
 const store=new MemoryStore(storage);store.migrate(clock.now());
 const life=new MemoryLifecycle(store),index=new MemoryIndex(store,{model:'offline',embed:async()=>[1,0]},{clock});
 const web=new WebSearchService(new WebSearchStore(storage),undefined,clock);
 const client=new ModelClient(transport),maintenance=new MemoryMaintenance(store,life,index,client,{clock,web:withWeb?web:undefined,retryDelayMs:1000,backgroundTimeoutMs,onReady});
 const d={storage,clock,store,life,index,web,client,maintenance};resources.push(d);return d;
}
type Fixture=ReturnType<typeof fixture>;
function seed(d:Fixture){
 const row=d.store.makeOwner({ownerType:'short',ownerId:'s'},{content:'旧事件',shortExpiresAt:d.clock.now()},d.clock.now());
 d.store.saveOwner(row);d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:d.clock.now()});return row;
}
function job(d:Fixture){return d.store.jobs<MaintenanceJob>('memory_maintenance_jobs')[0]!;}
function phase(d:Fixture){return d.web.store.openStage('maintenance',job(d).id,'consolidation','memory_consolidation');}
function checkpoint(d:Fixture){return d.web.store.snapshot(phase(d).runId).checkpoint;}
function frozen(j:MaintenanceJob){return {id:j.id,startedAt:j.startedAt,cutoff:j.cutoff,snapshot:j.snapshot,readSet:j.readSet};}
function capture(request:CompletionRequest){const {task,...data}=request;return {...structuredClone(data),taskName:task.name};}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

it('retains repair checkpoint after transport failure and resumes the same repair',async()=>{
 const requests:ReturnType<typeof capture>[]=[];
 const d=fixture({complete:async request=>{
  requests.push(capture(request));if(requests.length===1)return {invalid:true};if(requests.length===2)throw Error('temporary transport interruption');return good;
 }});
 const row=seed(d);expect(d.maintenance.startOne(d.clock.now())).toBe(true);await until(()=>!d.maintenance.inFlight);
 const failed=job(d),cp=checkpoint(d),run=phase(d).runId;
 expect(failed.status).toBe('pending');expect(failed.startedAt).toBe(NOW);
 expect(cp).toMatchObject({repairCount:1,repair:requests[1].repair});expect(requests[1].repair).toBeDefined();
 d.store.saveOwner({...row,content:'新事件',eventSummary:'新事件',revision:2,stateVersion:2});
 d.clock.advance(1000);expect(d.maintenance.startOne(d.clock.now())).toBe(true);await until(()=>!d.maintenance.inFlight);
 expect(requests).toHaveLength(3);expect(requests[2].repair).toEqual(requests[1].repair);
 expect(requests[2].input).toEqual(requests[0].input);expect(frozen(job(d))).toEqual(frozen(failed));expect(phase(d).runId).toBe(run);
 expect(job(d).status).toBe('ready');expect(checkpoint(d)).toBeNull();
 expect(d.maintenance.applyOneReady(d.clock.now())).toBe('stale');expect(d.store.owner(row)!.content).toBe('新事件');
});

it.each(['timeout','stop'] as const)('preserves repair progress on %s and ignores a late response',async mode=>{
 if(mode==='timeout')vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 const gate=deferred<unknown>(),requests:ReturnType<typeof capture>[]=[];
 const d=fixture({complete:async request=>{requests.push(capture(request));return requests.length===1?{invalid:true}:gate.promise;}},':memory:',true,50);
 seed(d);expect(d.maintenance.startOne(d.clock.now())).toBe(true);await until(()=>requests.length===2);
 const cp=checkpoint(d),ref=phase(d);expect(cp).toMatchObject({repairCount:1,repair:requests[1].repair});
 if(mode==='timeout'){await vi.advanceTimersByTimeAsync(50);await until(()=>!d.maintenance.inFlight);}else await d.maintenance.stop();
 const interrupted=job(d);
 expect(interrupted.status).toBe(mode==='timeout'?'pending':'computing');
 if(mode==='timeout')expect(interrupted.retryAt).toBe('2026-10-07T02:00:01.000Z');
 expect(checkpoint(d)).toEqual(cp);expect(phase(d)).toEqual(ref);
 gate.resolve(good);await new Promise<void>(resolve=>setImmediate(resolve));
 expect(job(d)).toEqual(interrupted);expect(checkpoint(d)).toEqual(cp);expect(requests).toHaveLength(2);
});

it.each(['pending','computing'] as const)('reopens interrupted %s maintenance with frozen input and the same checkpoint',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-r1-checkpoint-'));directories.push(root);
 const path=join(root,'test.sqlite'),gate=deferred<unknown>(),requests:ReturnType<typeof capture>[]=[];
 const transport:Transport={complete:async request=>{
  requests.push(capture(request));if(requests.length===1)return {invalid:true};
  if(requests.length===2){if(mode==='pending')throw Error('temporary interruption');return gate.promise;}return good;
 }};
 const d=fixture(transport,path);const row=seed(d);expect(d.maintenance.startOne(d.clock.now())).toBe(true);
 await until(()=>requests.length===2);if(mode==='pending')await until(()=>!d.maintenance.inFlight);
 const cp=checkpoint(d),before=frozen(job(d)),ref=phase(d);
 expect(cp).toMatchObject({repairCount:1});
 await d.maintenance.stop();expect(job(d).status).toBe(mode);expect(checkpoint(d)).toEqual(cp);
 gate.resolve(good);await new Promise<void>(resolve=>setImmediate(resolve));
 d.storage.close();resources.splice(resources.indexOf(d),1);
 const reopened=fixture(transport,path);
 expect(job(reopened).status).toBe('pending');expect(frozen(job(reopened))).toEqual(before);
 expect(phase(reopened)).toEqual(ref);expect(checkpoint(reopened)).toEqual(cp);
 reopened.store.saveOwner({...row,content:'重开后新事件',revision:2,stateVersion:2});
 reopened.clock.advance(1000);expect(reopened.maintenance.startOne(reopened.clock.now())).toBe(true);
 await until(()=>!reopened.maintenance.inFlight);
 expect(requests).toHaveLength(3);expect(requests[2].input).toEqual(requests[0].input);
 expect(requests[2].repair).toEqual(requests[1].repair);expect(frozen(job(reopened))).toEqual(before);
 expect(phase(reopened)).toEqual(ref);expect(job(reopened).status).toBe('ready');expect(checkpoint(reopened)).toBeNull();
});

function seedWebMaterial(d:Fixture){
 const ref=phase(d),material={id:'offline-material',url:'https://example.test/r1',title:'offline',body:'offline material',readAt:d.clock.now(),bodyCharacters:16,selectionMode:'full_body' as const,sourceKind:'external_reference' as const};
 const op=d.web.store.beginOperation(ref.runId,{kind:'read',url:material.url});
 d.web.store.commitStep(ref.runId,{operationId:op.operationId,stepIndex:0,nextCandidateIndex:1,material});
 d.web.store.finishOperation(ref.runId,op.operationId,{materials:[material],counters:{successReads:1,failures:0},stopReason:'satisfied'});
}
function withoutCheckpoint(snapshot:ReturnType<WebSearchStore['snapshot']>){
 const {checkpoint:_checkpoint,repairCount:_repairCount,lookupUsed:_lookupUsed,...rest}=snapshot;return rest;
}

it.each([true,false])('compacts a prepared result and retries its application without another model call (web=%s)',async withWeb=>{
 const requests:ReturnType<typeof capture>[]=[];let d!:Fixture,savedBeforeCleanup:ReturnType<WebSearchStore['snapshot']>|undefined;
 d=fixture({complete:async request=>{
  requests.push(capture(request));if(requests.length===1){if(withWeb)seedWebMaterial(d);return {invalid:true};}return good;
 }},':memory:',withWeb,120000,()=>{if(withWeb)savedBeforeCleanup=d.web.store.snapshot(phase(d).runId);});
 const row=seed(d);expect(d.maintenance.startOne(d.clock.now())).toBe(true);await until(()=>!d.maintenance.inFlight);
 const ready=job(d);expect(ready.status).toBe('ready');expect(ready.result).toHaveLength(1);expect(requests).toHaveLength(2);
 if(withWeb){
  const after=d.web.store.snapshot(phase(d).runId);expect(savedBeforeCleanup!.checkpoint).toMatchObject({repairCount:1});
  expect(after.checkpoint).toBeNull();expect(withoutCheckpoint(after)).toEqual(withoutCheckpoint(savedBeforeCleanup!));
  expect(after.operations).toHaveLength(1);expect(after.materials).toHaveLength(1);expect(after.counters).toEqual({successReads:1,failures:0});
 }else expect(d.storage.prepare('SELECT count(*) n FROM web_sessions').get()!.n).toBe(0);
 const before=d.store.owner(row),save=d.store.saveJob.bind(d.store);let injected=false;
 vi.spyOn(d.store,'saveJob').mockImplementation((table,record)=>{
  if(!injected&&table==='memory_maintenance_jobs'&&(record as MaintenanceJob).appliedUnitKeys.includes('keep')){injected=true;throw Error('application storage interruption');}
  save(table,record);
 });
 expect(d.maintenance.applyOneReady(d.clock.now())).toBe('none');expect(injected).toBe(true);
 expect(d.store.owner(row)).toEqual(before);expect(job(d).status).toBe('ready');expect(job(d).result).toEqual(ready.result);
 expect(job(d).appliedUnitKeys).toEqual([]);expect(job(d).retryAt).toBe('2026-10-07T02:00:01.000Z');
 expect(d.maintenance.startOne(d.clock.now())).toBe(false);
 d.clock.advance(1000);expect(d.maintenance.applyOneReady(d.clock.now())).toBe('applied');
 expect(job(d).status).toBe('done');expect(job(d).appliedUnitKeys).toEqual(['keep']);
 expect(d.store.owner(row)!.consolidatedRevision).toBe(1);expect(requests).toHaveLength(2);
});

it.each(['success','failure','stop'] as const)('cleans the checkpoint when pruning finishes an in-flight job before %s',async outcome=>{
 const gate=deferred<unknown>(),requests:ReturnType<typeof capture>[]=[];
 const d=fixture({complete:async request=>{requests.push(capture(request));return requests.length===1?{invalid:true}:gate.promise;}});
 const row=seed(d);expect(d.maintenance.startOne(d.clock.now())).toBe(true);await until(()=>requests.length===2);
 expect(checkpoint(d)).toMatchObject({repairCount:1});const ref=phase(d);
 d.store.pruneOwnerFromJobs(row,d.clock.now());expect(job(d).status).toBe('done');const ended=job(d);
 if(outcome==='stop'){await d.maintenance.stop();gate.resolve(good);}
 else {if(outcome==='failure')gate.reject(Error('temporary interruption'));else gate.resolve(good);await until(()=>!d.maintenance.inFlight);}
 await new Promise<void>(resolve=>setImmediate(resolve));
 expect(job(d)).toEqual(ended);expect(checkpoint(d)).toBeNull();expect(phase(d)).toEqual(ref);
 expect(d.maintenance.applyOneReady(d.clock.now())).toBe('none');expect(requests).toHaveLength(2);
});

it('cleans the checkpoint when a pruned dependency invalidates the only prepared unit',async()=>{
 const gate=deferred<unknown>(),requests:ReturnType<typeof capture>[]=[];
 const d=fixture({complete:async request=>{requests.push(capture(request));return requests.length===1?{invalid:true}:gate.promise;}});
 const row=seed(d),dependency=d.store.makeOwner({ownerType:'long',ownerId:'l'},{content:'已有简要摘要'},d.clock.now());
 d.store.saveOwner(dependency);d.store.saveOwner({...row,linkedLongId:'l'});
 expect(d.maintenance.startOne(d.clock.now())).toBe(true);await until(()=>requests.length===2);
 expect(job(d).selectedIds).toEqual(['s']);expect(job(d).snapshot.map(r=>r.id)).toEqual(['s','l']);
 d.store.pruneOwnerFromJobs(dependency,d.clock.now());expect(job(d).status).toBe('computing');expect(checkpoint(d)).toMatchObject({repairCount:1});
 gate.resolve({units:[{unitKey:'keep',action:'retain',ids:['s'],readOwners:['s','l'],sourceIds:[]}]});await until(()=>!d.maintenance.inFlight);
 expect(job(d).status).toBe('done');expect(job(d).staleUnitKeys).toEqual(['keep']);expect(checkpoint(d)).toBeNull();
 expect(d.store.owner(row)!.consolidatedRevision).toBeNull();expect(requests).toHaveLength(2);
});

it('does not reset the repair budget across background retries',async()=>{
 const requests:ReturnType<typeof capture>[]=[];
 const d=fixture({complete:async request=>{
  requests.push(capture(request));if(requests.length===3)throw Error('temporary interruption');return requests.length===5?good:{invalid:requests.length};
 }});
 seed(d);expect(d.maintenance.startOne(d.clock.now())).toBe(true);await until(()=>!d.maintenance.inFlight);
 const first=job(d),cp=checkpoint(d);expect(cp).toMatchObject({repairCount:2,repair:requests[2].repair});expect(requests).toHaveLength(3);
 d.clock.advance(1000);expect(d.maintenance.startOne(d.clock.now())).toBe(true);await until(()=>!d.maintenance.inFlight);
 expect(requests).toHaveLength(4);expect(requests[3].repair).toEqual(requests[2].repair);expect(checkpoint(d)).toEqual(cp);
 expect(job(d).status).toBe('pending');expect(frozen(job(d))).toEqual(frozen(first));
 d.clock.advance(1000);expect(d.maintenance.startOne(d.clock.now())).toBe(true);await until(()=>!d.maintenance.inFlight);
 expect(requests).toHaveLength(5);expect(requests[4].repair).toEqual(requests[2].repair);
 expect(requests[4].input).toEqual(requests[0].input);expect(frozen(job(d))).toEqual(frozen(first));
 expect(job(d).status).toBe('ready');expect(checkpoint(d)).toBeNull();
});
