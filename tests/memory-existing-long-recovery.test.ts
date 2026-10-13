import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HdsiApp} from '../src/app';
import {organizeMemory} from '../src/memory/organize';
import {ContextBuilder} from '../src/memory/context';
import {stageInput} from '../src/model/context-views';
import {ModelRunHistory} from '../src/model/run-history';
import {WebSearchService} from '../src/web/service';
import {fixture,linkedCreate,claim,QUERY} from './memory-existing-long-fixture';
import {NOW} from './helpers';
import type {MemoryResult} from '../src/types';

const opened=new Set<ReturnType<typeof fixture>>(),dirs:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const d of opened)d.close();opened.clear();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function use(options:Parameters<typeof fixture>[0]={}){const d=fixture(options);opened.add(d);return d;}
function close(d:ReturnType<typeof fixture>){d.close();opened.delete(d);}
function disk(){const dir=mkdtempSync(join(tmpdir(),'linked-memory-'));dirs.push(dir);return join(dir,'story.sqlite');}
const permissions={shortUpdateIds:['S'],longAwakenIds:[],existingLongIds:['L']};
const none={shortUpdateIds:[],longAwakenIds:[],existingLongIds:[]};
function savedLookup(d:ReturnType<typeof fixture>,format:'raw'|'projected'){
 const raw={details:[],retrieved:[d.short],memoryWritePermissions:claim};
 return format==='raw'?raw:stageInput('memory',raw);
}
function history(d:ReturnType<typeof fixture>){
 new ModelRunHistory(d.deps.storage,d.deps.clock).append({id:'original-history',type:'checkpoint',reason:'completed',runId:'old-run',ownerType:'turn',ownerId:'old-turn',taskName:'memory',occurredAt:NOW,checkpoint:{formatVersion:2,input:{old:true},repairCount:1,lookupUsed:true,pendingOperationId:null,toolResults:[]}});
 return d.deps.storage.prepare("SELECT data FROM model_run_records WHERE id='original-history'").get()!.data;
}
function originalHistory(d:ReturnType<typeof fixture>){return d.deps.storage.prepare("SELECT data FROM model_run_records WHERE id='original-history'").get()?.data;}

describe('linked memory final commit and disk recovery',()=>{
 it.each(['missing','wrong-kind','discarded','discarded-alias'])('saved result rejects %s after disk reopen and rolls back earlier changes',async kind=>{
  const path=disk();let d=use({path});const saved=linkedCreate(kind==='discarded-alias'?'A':'L');
  const first={...linkedCreate().shortTermChanges[0],clientRef:'first'};delete (first as {existingLongId?:string}).existingLongId;
  saved.shortTermChanges.unshift(first);d.deps.storage.save('post_jobs',d.turn.id,{turnId:d.turn.id,result:saved});
  if(kind==='missing')d.deps.storage.remove('memories','L');
  else if(kind==='wrong-kind')d.store.saveOwner({...d.long,kind:'short'});
  else {d.store.saveOwner({...d.long,status:'discarded'});if(kind==='discarded-alias')d.store.saveOwner({...d.long,id:'A',ownerId:'A',status:'merged',mergedInto:'L'});}
  const beforeHistory=history(d);close(d);d=use({path,seed:false});
  await expect(new HdsiApp(d.deps).resumeUnfinishedTurn()).rejects.toThrow(/existingLongId/);
  expect(d.deps.storage.read('turns',d.turn.id)?.done).toBe(false);
  expect(d.deps.storage.read('post_jobs',d.turn.id)?.result).toEqual(saved);
  for(const index of [0,1]){expect(d.store.owner({ownerType:'short',ownerId:d.turn.id+':short:'+index})).toBeNull();expect(d.store.owner({ownerType:'long',ownerId:d.turn.id+':short:'+index+':long'})).toBeNull();}
  expect(d.requests).toHaveLength(0);expect(d.deps.sender).toMatchObject({sent:[]});expect(d.deps.storage.runtime().paused).toBe(true);
  expect(d.store.listGrants(d.turn.id+':short:0:long')).toEqual([]);expect(originalHistory(d)).toBe(beforeHistory);
 });
 it('valid merged alias and legacy saved result without progress commit once without model or resend',async()=>{
  const path=disk();let d=use({path});d.store.saveOwner({...d.long,id:'A',ownerId:'A',status:'merged',mergedInto:'L'});
  const saved=linkedCreate('A');delete (saved.shortTermChanges[0] as {hasNewEventProgress?:boolean}).hasNewEventProgress;
  const before=d.store.canonical('L')!,beforeHistory=history(d);d.deps.storage.save('post_jobs',d.turn.id,{turnId:d.turn.id,result:saved});
  close(d);d=use({path,seed:false});const app=new HdsiApp(d.deps);await app.resumeUnfinishedTurn();await app.resumeUnfinishedTurn();
  expect(d.deps.storage.read('turns',d.turn.id)?.done).toBe(true);expect(d.requests).toHaveLength(0);expect(d.deps.sender).toMatchObject({sent:[]});
  expect(d.store.owner({ownerType:'short',ownerId:d.turn.id+':short:0'})?.linkedLongId).toBe('L');
  expect(d.store.owner({ownerType:'long',ownerId:d.turn.id+':short:0:long'})).toBeNull();
  expect(d.store.canonical('L')).toMatchObject({retainedFrom:before.retainedFrom,expiresAt:before.expiresAt,lastEventUpdateAt:before.lastEventUpdateAt,totalAwakenings:0});
  expect(originalHistory(d)).toBe(beforeHistory);
 });
 it.each([['raw',false],['raw',true],['projected',false],['projected',true]] as const)('confirmed %s lookup reopens with media=%s and current transmitted authority',async(format,media)=>{
  const path=disk();let d=use({path,query:'无关新经历',media});const originalRef=d.ref,oldResult=savedLookup(d,format),beforeHistory=history(d);
  d.session.saveCheckpoint({formatVersion:2,input:{},repairCount:1,repair:{original:{wrong:true},errors:'prior format'},lookupUsed:true,lookupPending:false,privateLookupResult:oldResult,pendingOperationId:null,toolResults:[]});
  close(d);d=use({path,seed:false,query:'无关新经历',media});
  const lookup=vi.spyOn(d.deps.retrieval!,'lookup');await organizeMemory(d.deps,d.turn);
  expect(d.ref.runId).toBe(originalRef.runId);expect(lookup).not.toHaveBeenCalled();expect(d.requests).toHaveLength(1);
  expect(d.envelopes[0].input.context.memoryWritePermissions).toEqual(none);
  expect(d.envelopes[0].lookupResult.context.memoryWritePermissions).toEqual(permissions);
  expect(JSON.stringify(d.envelopes[0].lookupResult)).not.toContain('UNPROVIDED');
  expect(d.session.checkpoint()).toMatchObject({repairCount:1,lookupUsed:true,lookupPending:false,repair:{original:{wrong:true},errors:'prior format'}});
  expect(originalHistory(d)).toBe(beforeHistory);
 });
 it('pending lookup reopens and waits for confirmed rows before next completion',async()=>{
  const path=disk();let d=use({path,query:'无关新经历'});const runId=d.ref.runId;
  d.session.saveCheckpoint({formatVersion:2,input:{},repairCount:1,lookupUsed:true,lookupPending:true,lookupRequest:QUERY,privateLookupResult:savedLookup(d,'raw'),pendingOperationId:null,toolResults:[]});
  close(d);d=use({path,seed:false,query:'无关新经历'});
  let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),entered=new Promise<void>(resolve=>started=resolve);
  const original=ContextBuilder.prototype.lookupForMemory;
  vi.spyOn(ContextBuilder.prototype,'lookupForMemory').mockImplementationOnce(async function(this:ContextBuilder,q,base){started();await gate;return original.call(this,q,base);});
  const running=organizeMemory(d.deps,d.turn);await entered;
  expect(d.requests).toHaveLength(0);expect(d.session.checkpoint()?.input).toMatchObject({context:{memoryWritePermissions:none}});
  release();await running;
  expect(d.ref.runId).toBe(runId);expect(d.requests).toHaveLength(1);
  expect(d.envelopes[0].lookupResult.context.memoryWritePermissions).toEqual(permissions);
  expect(d.session.checkpoint()).toMatchObject({lookupPending:false,lookupUsed:true,repairCount:1});
 });
 it('disk recovery preserves web 1/1 and only the remaining repair allowance',async()=>{
  const path=disk();let d=use({path,query:'无关新经历'});
  const provider={signature:'offline',search:async()=>[],read:async(url:string)=>{if(url.endsWith('/bad'))throw Error('offline failure');return {bodyFormat:'text' as const,title:'合成',body:'合成网页正文'};}};
  const available=new WebSearchService(d.web.store,provider,d.deps.clock,{enabled:true}),session=available.openSession(d.ref);
  for(const url of ['https://fixture.invalid/good','https://fixture.invalid/bad']){
   const op=session.beginOperation({kind:'read',url});await session.readPage(url,{operationId:op.operationId});
  }
  expect(session.state().counters).toEqual({successReads:1,failures:1});
  const runId=d.ref.runId;d.session.saveCheckpoint({formatVersion:2,input:{},repairCount:1,lookupUsed:true,lookupPending:false,privateLookupResult:savedLookup(d,'projected'),pendingOperationId:null,toolResults:[]});
  close(d);d=use({path,seed:false,query:'无关新经历'});d.responses[0]=linkedCreate('UNPROVIDED');
  await expect(organizeMemory(d.deps,d.turn)).rejects.toThrow(/existingLongId/);
  expect(d.ref.runId).toBe(runId);expect(d.requests).toHaveLength(2);expect(d.session.checkpoint()?.repairCount).toBe(2);
  expect(d.session.state().counters).toEqual({successReads:1,failures:1});
  expect(d.envelopes[0].lookupResult.context.memoryWritePermissions).toEqual(permissions);
 });
 it('checkpoint projection save failure preserves result and never sends a model request',async()=>{
  const d=use({query:'无关新经历'});const cp={formatVersion:2 as const,input:{},repairCount:1,lookupUsed:true,lookupPending:false,privateLookupResult:savedLookup(d,'raw'),pendingOperationId:null,toolResults:[]};
  d.session.saveCheckpoint(cp);d.deps.storage.save('post_jobs',d.turn.id,{turnId:d.turn.id,result:null});
  d.deps.storage.prepare("CREATE TRIGGER reject_projection BEFORE UPDATE ON web_sessions WHEN json_type(NEW.data,'$.checkpoint.privateLookupResult.context.memoryWritePermissions')='object' BEGIN SELECT RAISE(ABORT,'projection write failure'); END").run();
  await expect(new HdsiApp(d.deps).resumeUnfinishedTurn()).rejects.toThrow(/projection write failure/);
  expect(d.requests).toHaveLength(0);expect(d.session.checkpoint()).toEqual(cp);
  expect(d.deps.storage.read('turns',d.turn.id)?.done).toBe(false);expect(d.deps.storage.runtime().paused).toBe(true);
 });
});

