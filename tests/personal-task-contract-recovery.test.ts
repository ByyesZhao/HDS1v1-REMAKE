import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {Storage} from '../src/storage';
import {EnvironmentStore} from '../src/environment/store';
import {SchoolStore} from '../src/school/store';
import {initialCharacter} from '../src/config';
import {HdsiApp,generateTurn} from '../src/app';
import type {Dependencies} from '../src/app';
import {InputBuffer} from '../src/host/input';
import {Scheduler} from '../src/host/scheduler';
import {SerialHost} from '../src/host/runtime';
import {ModelClient,ModelFormatError} from '../src/model/client';
import type {CompletionRequest} from '../src/model/client';
import {personalTask} from '../src/model/contracts';
import {freezeTurn,sendFrozen,finishPostprocessing} from '../src/recovery';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import type {WebSearchProvider} from '../src/web/provider';
import {schoolItem,expand} from './world-school-fixture';
import {NOW,setup,narrative,silent,emptyMemory} from './helpers';

const after=(at:string,ms:number)=>new Date(Date.parse(at)+ms).toISOString();
function openDiskFixture(provider?:WebSearchProvider){
 const root=mkdtempSync(join(tmpdir(),'personal-task-contract-')),path=join(root,'state.sqlite'),seed=setup();seed.storage.close();
 let storage=new Storage(path),web:WebSearchService;
 storage.set('character',initialCharacter(NOW));storage.set('runtime',{...storage.runtime(),dialogueContextVersion:2,environmentPlanningVersion:2,nextEnvironmentAt:'2099-01-01T00:00:00Z'});
 storage.save('chat_index_metadata','chat-index',{id:'chat-index',idleMinutes:15});
 const requests:CompletionRequest[]=[];
 let response:(r:CompletionRequest)=>Promise<unknown>=async r=>r.task.name==='narrative'?narrative:r.task.name==='personal_chat'?silent:r.task.name==='personal_life'?{innerThought:'休息',emotions:[],contact:{willing:false}}:r.task.name==='expression'?{parts:[{kind:'text',content:'旧稿'},{kind:'text',content:'旧尾段'}]}:emptyMemory;
 const models=new ModelClient({complete:async r=>{
  const {task,...data}=r;requests.push({...structuredClone(data),task:{...task,schema:structuredClone(task.schema)}});return response(r);
 }});
 const refresh=()=>{web=new WebSearchService(new WebSearchStore(storage),provider,seed.clock,{enabled:!!provider});};refresh();
 const deps=():Dependencies=>({storage,clock:seed.clock,random:seed.random,config:seed.config,sender:seed.sender,wait:seed.wait,models,web,environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage)});
 return {db:()=>storage,deps,reopen:()=>{storage.close();storage=new Storage(path);refresh();},close:()=>{
  storage.close();const resolved=resolve(root);if(!resolved.startsWith(resolve(tmpdir())+sep))throw Error('unsafe test cleanup');rmSync(resolved,{recursive:true,force:true});
 },clock:seed.clock,sender:seed.sender,requests,setResponse:(handler:typeof response)=>{response=handler;}};
}
type Disk=ReturnType<typeof openDiskFixture>;
function assertNewContract(request:CompletionRequest){
 const schema=request.task.schema as any;const items=schema.properties.taskChanges.items;
 const create=items.oneOf?.find((b:any)=>b.properties.action.const==='create')??items;
 expect(create.properties.task.properties.kind).toEqual({type:'string',const:'appointment'});
}
async function failMixed(x:Disk){
 const d=x.deps();x.db().save('school_plan_items','meeting',schoolItem());expand(d as ReturnType<typeof setup>);
 await new InputBuffer(x.db()).acceptInput({id:'new',content:'合成新消息',receivedAt:x.clock.now()});x.clock.advance(15_000);
 const request=(await new Scheduler(x.db(),d.config).collectReady(x.clock.now()))!;expect(request.schoolNoticeRefs?.length).toBeGreaterThan(0);expect(request.replyInputRevision).toBeUndefined();
 const noticeId=request.schoolNoticeRefs![0].noticeId,observedAt=x.clock.now();
 const invalid={innerThought:'合成休息',emotions:[],contact:{willing:false},taskChanges:[{action:'create',task:{kind:'check_messages',at:after(observedAt,1_800_000),description:'非法检查'}}]};
 const narration=(r:CompletionRequest,readable=false)=>({...narrative,
  experiences:[{happenedAt:observedAt,description:'合成读取通知',relatedEventIds:['meeting']}],schoolObservations:[{via:'notice',sourceId:noticeId,experienceIndex:0}],
  currentScene:readable?narrative.currentScene:{description:'合成不可读',activity:{description:'小憩',startsAt:(r.input as any).context.at,expectedEndAt:after((r.input as any).context.at,300_000),phoneAccess:false}},
 });
 x.setResponse(async r=>r.task.name==='narrative'?narration(r):r.task.name==='personal_life'?invalid:emptyMemory);
 await expect(new HdsiApp(d).runTurn(request)).rejects.toThrow(ModelFormatError);
 const turn=x.db().unfinishedTurn()!;expect(x.db().runtime().lastError).toMatch(/^personal_life:/);expect(turn.frozenResult).toBeNull();expect(x.db().outbox(turn.id)).toEqual([]);
 const ref=d.web!.store.openStage('turn',turn.id,'personal','personal_life');expect(d.web!.store.checkpoint(ref.runId)!.repairCount).toBe(2);
 return {turn,ref,invalid,narration};
}

it('unfrozen_recovery_keeps_repairs_with_new_time',async()=>{
 const x=openDiskFixture();try{
  const failed=await failMixed(x);x.clock.advance(600_000);x.reopen();x.requests.length=0;let recoveredCount=-1;
  x.setResponse(async r=>{if(r.task.name==='narrative')return failed.narration(r);if(r.task.name==='personal_life'){
   assertNewContract(r);expect(r.repair?.original).toEqual(failed.invalid);expect((r.input as any).context.at).toBe(x.clock.now());
   recoveredCount=x.deps().web!.store.checkpoint(failed.ref.runId)!.repairCount;return {innerThought:'合法休息',emotions:[],contact:{willing:false}};
  }return emptyMemory;});
  await new HdsiApp(x.deps()).resumeUnfinishedTurn();const turn=x.db().read('turns',failed.turn.id)!;
  expect(turn).toMatchObject({done:true,at:x.clock.now()});expect(turn.at).not.toBe(failed.turn.at);expect(recoveredCount).toBe(2);
  expect(x.requests.filter(r=>r.task.name==='personal_life')).toHaveLength(1);expect(x.sender.sent).toEqual([]);
  expect(x.deps().web!.store.openStage('turn',turn.id,'personal','personal_life').runId).toBe(failed.ref.runId);expect(x.db().read('messages','new')!.seenTurnId).toBeNull();
 }finally{x.close();}
});

it('invalid_recovery_does_not_get_another_repair',async()=>{
 const x=openDiskFixture();try{
  const failed=await failMixed(x);x.clock.advance(600_000);x.reopen();x.requests.length=0;
  x.setResponse(async r=>r.task.name==='narrative'?failed.narration(r):failed.invalid);
  await expect(new HdsiApp(x.deps()).resumeUnfinishedTurn()).rejects.toThrow(ModelFormatError);
  expect(x.requests.filter(r=>r.task.name==='personal_life')).toHaveLength(1);expect(x.deps().web!.store.checkpoint(failed.ref.runId)!.repairCount).toBe(2);
  expect(x.db().runtime()).toMatchObject({paused:true,lastFailure:{stage:'generation'}});expect(x.db().unfinishedTurn()).toMatchObject({frozenResult:null,outputComplete:false});
  expect(x.db().outbox(failed.turn.id)).toEqual([]);expect(x.db().all('experiences')).toEqual([]);expect(x.db().all('school_knowledge')).toEqual([]);expect(x.sender.sent).toEqual([]);expect(x.sender.errors.length).toBeGreaterThan(0);
 }finally{x.close();}
});

it.each([false,true])('mixed_school_recovery_can_switch_life_to_chat (invalid=%s)',async invalid=>{
 const x=openDiskFixture();try{
  const failed=await failMixed(x);x.clock.advance(600_000);x.reopen();x.requests.length=0;let runId='',repairCount=-1;
  x.setResponse(async r=>{if(r.task.name==='narrative')return failed.narration(r,true);if(r.task.name==='personal_chat'){
   expect((r.input as any).context.at).toBe(x.clock.now());expect((r.input as any).roles.visibleIds).toEqual(['new']);expect(r.repair?.original).toEqual(failed.invalid);
   const ref=x.deps().web!.store.openStage('turn',failed.turn.id,'personal','personal_chat');runId=ref.runId;repairCount=x.deps().web!.store.checkpoint(runId)!.repairCount;
   return invalid?{...silent,taskChanges:[{action:'create',task:{kind:'check_messages',at:after(x.clock.now(),600_000),description:'旧合同合法检查',checkReason:'unread',messageIds:['new']}}]}:silent;
  }return emptyMemory;});
  if(invalid)await expect(new HdsiApp(x.deps()).resumeUnfinishedTurn()).rejects.toThrow(ModelFormatError);else await new HdsiApp(x.deps()).resumeUnfinishedTurn();
  expect(runId).toBe(failed.ref.runId);expect(repairCount).toBe(2);expect(x.requests.filter(r=>r.task.name==='personal_chat')).toHaveLength(1);
  assertNewContract(x.requests.find(r=>r.task.name==='personal_chat')!);
  expect(x.db().read('turns',failed.turn.id)!.done).toBe(!invalid);expect(x.db().read('messages','new')!.seenTurnId).toBe(invalid?null:failed.turn.id);
  expect(x.deps().web!.store.state(runId).ref.taskName).toBe('personal_chat');
 }finally{x.close();}
});

async function freezeLegacy(x:Disk,withOutput:boolean){
 await new InputBuffer(x.db()).acceptInput({id:'input',content:'合成对话',receivedAt:x.clock.now()});x.clock.advance(15_000);
 x.db().save('tasks','legacy-check',{id:'legacy-check',kind:'check_messages',at:'2026-10-08T14:00:00+08:00',description:'旧检查',status:'pending',checkReason:'deferred_reply',messageIds:['input']});
 const request=(await new Scheduler(x.db(),x.deps().config).collectReady(x.clock.now()))!;
 x.setResponse(async()=>{throw Error('synthetic selection interruption');});const d=x.deps(),app=new HdsiApp(d);
 await expect(app.runTurn(request)).rejects.toThrow('synthetic selection interruption');const turn=x.db().unfinishedTurn()!;
 x.setResponse(async r=>r.task.name==='narrative'?{...narrative,experiences:[{happenedAt:turn.at,description:'旧经历',relatedEventIds:[]}]}:r.task.name==='personal_chat'?{...silent,reply:withOutput?{decision:'now',intention:'回应',draft:'旧稿'}:{decision:'none'}}:r.task.name==='expression'?{parts:[{kind:'text',content:'旧稿'},{kind:'text',content:'旧尾段'}]}:emptyMemory);
 const generated=await generateTurn(d,request,turn.id,turn.at);generated.candidate.taskChanges=[{action:'update',id:'legacy-check',task:{kind:'appointment',at:'2026-10-08T15:00:00+08:00'}}];
 return {d,turn:freezeTurn(d,turn,generated.candidate,generated.items),app};
}
const postOnly=async(r:CompletionRequest)=>{if(r.task.name!=='memory')throw Error('personal/narrative/expression must not regenerate');return emptyMemory;};

it('unattempted_legacy_candidate_is_regenerated_under_new_contract',async()=>{
 const x=openDiskFixture();try{
  const old=await freezeLegacy(x,true);expect(x.db().outbox(old.turn.id).every(i=>i.status==='pending')).toBe(true);expect(old.turn.replyFreshness!.firstAttemptAt).toBeNull();
  x.clock.advance(600_000);x.reopen();x.requests.length=0;
  x.setResponse(async r=>{if(r.task.name==='personal_chat'){assertNewContract(r);return {...silent,reply:{decision:'now',intention:'新回应',draft:'新稿'}};}return r.task.name==='narrative'?narrative:r.task.name==='expression'?{parts:[{kind:'text',content:'新稿'}]}:emptyMemory;});
  await new HdsiApp(x.deps()).resumeUnfinishedTurn();expect(x.sender.sent.map(i=>i.payload)).toEqual(['新稿']);expect(x.sender.sent.map(i=>i.payload)).not.toContain('旧稿');
  expect(x.db().read('turns',old.turn.id)).toMatchObject({at:x.clock.now(),done:true});expect(x.db().read('tasks','legacy-check')!.kind).toBe('check_messages');
  for(const task of ['narrative','personal_chat','expression'])expect(x.requests.some(r=>r.task.name===task)).toBe(true);
 }finally{x.close();}
});

it.each(['retry','confirmed_tail_retry','sending'] as const)('attempted_legacy_candidate_finishes_without_personal_reparse (%s)',async window=>{
 const x=openDiskFixture();try{
  const old=await freezeLegacy(x,true);const send=x.sender.sendItem.bind(x.sender);
  if(window==='sending')x.db().saveOutbox({...x.db().outbox(old.turn.id)[0],status:'sending'});
  else{x.sender.sendItem=async item=>{if(item.seq===(window==='retry'?0:1))throw Error('synthetic unknown send');return send(item);};await expect(sendFrozen(old.d,old.turn)).rejects.toThrow('synthetic unknown send');x.sender.sendItem=send;}
  const confirmedBefore=x.db().outbox(old.turn.id).filter(i=>i.status==='confirmed');x.clock.advance(600_000);x.reopen();x.requests.length=0;x.setResponse(postOnly);
  await new HdsiApp(x.deps()).resumeUnfinishedTurn();expect(x.db().read('turns',old.turn.id)).toMatchObject({at:old.turn.at,done:true});
  expect(x.db().read('tasks','legacy-check')).toMatchObject({kind:'appointment',at:'2026-10-08T15:00:00+08:00',status:'pending'});
  expect(x.requests.every(r=>r.task.name==='memory')).toBe(true);expect(x.sender.sent.map(i=>i.payload)).toEqual(['旧稿','旧尾段']);
  for(const confirmed of confirmedBefore){expect(x.db().outbox(old.turn.id).find(i=>i.seq===confirmed.seq)).toEqual(confirmed);expect(x.sender.sent.filter(i=>i.seq===confirmed.seq)).toHaveLength(1);}
  expect(x.db().messagesByTurn(old.turn.id).filter(m=>m.direction==='outgoing')).toHaveLength(2);
 }finally{x.close();}
});

it('silent_complete_legacy_candidate_only_finishes_post',async()=>{
 const x=openDiskFixture();try{
  const old=await freezeLegacy(x,false);expect(old.turn.outputComplete).toBe(true);x.setResponse(async()=>{throw Error('synthetic post failure');});await expect(finishPostprocessing(old.d,old.turn)).rejects.toThrow('synthetic post failure');
  await new InputBuffer(x.db()).acceptInput({id:'later',content:'新合成输入',receivedAt:x.clock.now()});x.clock.advance(600_000);x.reopen();x.requests.length=0;x.setResponse(postOnly);
  await new HdsiApp(x.deps()).resumeUnfinishedTurn();expect(x.db().read('turns',old.turn.id)).toMatchObject({done:true,at:old.turn.at});expect(x.sender.sent).toEqual([]);expect(x.db().read('messages','later')!.seenTurnId).toBeNull();
  expect(x.db().read('tasks','legacy-check')!.kind).toBe('appointment');expect(x.requests.map(r=>r.task.name)).toEqual(['memory']);
 }finally{x.close();}
});

it('saved_post_result_commits_legacy_changes_once',async()=>{
 const x=openDiskFixture();try{
  const old=await freezeLegacy(x,false);x.setResponse(async r=>{if(r.task.name!=='memory')throw Error('unexpected model');return {...emptyMemory,shortTermChanges:[{action:'create',clientRef:'r',content:'合成记忆',eventSummary:'合成事件',feelingSummary:'',topics:[],importance:'normal',sourceIds:['input']}]};});
  x.db().prepare("CREATE TRIGGER reject_commit BEFORE UPDATE ON state WHEN NEW.key='character' BEGIN SELECT RAISE(ABORT,'synthetic commit failure'); END").run();
  await expect(finishPostprocessing(old.d,old.turn)).rejects.toThrow('synthetic commit failure');expect(x.db().read('post_jobs',old.turn.id)!.result).not.toBeNull();expect(x.db().all('experiences')).toEqual([]);
  x.clock.advance(600_000);x.reopen();x.db().prepare('DROP TRIGGER reject_commit').run();x.requests.length=0;x.setResponse(async()=>{throw Error('saved post must not call models');});
  const app=new HdsiApp(x.deps());await app.resumeUnfinishedTurn();const counts={tasks:x.db().all('tasks'),experiences:x.db().all('experiences'),memories:x.db().all('memories')};await app.resumeUnfinishedTurn();
  expect(x.requests).toEqual([]);expect(x.db().all('tasks')).toEqual(counts.tasks);expect(x.db().all('experiences')).toEqual(counts.experiences);expect(x.db().all('memories')).toEqual(counts.memories);
  expect(counts.experiences).toHaveLength(1);expect(counts.memories.filter(m=>m.kind==='short')).toHaveLength(1);expect(x.db().read('messages','input')!.seenTurnId).toBe(old.turn.id);expect(x.db().read('tasks','legacy-check')!.kind).toBe('appointment');
 }finally{x.close();}
});

it.each([false,true])('disk_recovery_preserves_tools_without_new_repair_budget (operationDone=%s)',async done=>{
 let reads=0;const provider:WebSearchProvider={signature:'disk-tools-'+done,search:async()=>[],read:async()=>{reads++;return {title:'合成',body:'合成公开正文',bodyFormat:'text'};}};
 const x=openDiskFixture(provider);try{
  const ref=x.deps().web!.store.openStage('turn','tool-owner','personal','personal_chat'),web=x.deps().web!.openSession(ref),url='https://example.test/disk-tools-'+done,op=web.beginOperation({kind:'read',url});
  if(done)await web.readPage(url,{operationId:op.operationId});
  web.saveCheckpoint({formatVersion:2,input:{},repairCount:2,repair:{original:{bad:true},errors:'old'},lookupUsed:true,privateLookupResult:{fact:'合成'},pendingOperationId:op.operationId,toolResults:[]});const before=reads;
  x.reopen();let lookupCalls=0;const recovered=x.deps().web!.openSession(ref),captured:CompletionRequest[]=[];
  await new ModelClient({complete:async r=>{captured.push(r);return silent;}}).runModel(personalTask('chat',NOW,[],'chat',[]),{}, {web:recovered,lookup:async()=>{lookupCalls++;return {};}});
  expect(reads-before).toBe(done?0:1);expect(lookupCalls).toBe(0);expect(captured[0].repair?.original).toEqual({bad:true});expect(captured[0].lookupResult).toEqual({fact:'合成'});expect(captured[0].tools!.lookup).toBe(false);
  expect(recovered.checkpoint()).toMatchObject({repairCount:2,lookupUsed:true,pendingOperationId:null});expect(recovered.checkpoint()!.toolResults).toHaveLength(1);expect(recovered.state().counters.successReads).toBe(1);
 }finally{x.close();}
});

it.each([{successReads:20,failures:0},{successReads:0,failures:40}])('disk_recovery_preserves_quota (%j)',async counters=>{
 let providerCalls=0;const x=openDiskFixture({signature:'quota',search:async()=>{providerCalls++;return [];},read:async()=>{providerCalls++;return {title:'synthetic',body:'synthetic',bodyFormat:'text'};}});try{
  const ref=x.deps().web!.store.openStage('turn','quota-owner','personal','personal_chat');x.deps().web!.openSession(ref).saveCheckpoint({formatVersion:2,input:{},repairCount:2,lookupUsed:true,pendingOperationId:null,toolResults:[]});
  x.db().prepare("UPDATE web_sessions SET data=json_set(data,'$.counters',json(?)) WHERE id=?").run(JSON.stringify(counters),ref.runId);x.reopen();let request:CompletionRequest|undefined;
  await new ModelClient({complete:async r=>{request=r;return silent;}}).runModel(personalTask('chat',NOW,[],'chat',[]),{}, {web:x.deps().web!.openSession(ref),lookup:null});
  expect(request!.tools!.web).toBe(false);expect(request!.webStatus!.stopReason).toBe('quota');expect(x.deps().web!.store.state(ref.runId).counters).toEqual(counters);expect(providerCalls).toBe(0);expect(x.deps().web!.store.checkpoint(ref.runId)!.repairCount).toBe(2);
 }finally{x.close();}
});

it('new_tool_continuation_clears_repair_material_but_not_budget',async()=>{
 const x=openDiskFixture({signature:'new-tool',search:async()=>[],read:async()=>({title:'合成',body:'合成公开正文',bodyFormat:'text'})});try{
  const ref=x.deps().web!.store.openStage('turn','continuation-owner','personal','personal_chat');x.deps().web!.openSession(ref).saveCheckpoint({formatVersion:2,input:{},repairCount:2,repair:{original:{bad:true},errors:'old'},lookupUsed:true,pendingOperationId:null,toolResults:[]});x.reopen();
  const captured:CompletionRequest[]=[];const values=[{webRead:{url:'https://example.test/new-tool'}},silent];
  await new ModelClient({complete:async r=>{captured.push({...r,repair:structuredClone(r.repair)});return values.shift();}}).runModel(personalTask('chat',NOW,[],'chat',[]),{}, {web:x.deps().web!.openSession(ref),lookup:null});
  expect(captured[0].repair).toBeDefined();expect(captured[1].repair).toBeUndefined();expect(x.deps().web!.store.checkpoint(ref.runId)!.repairCount).toBe(2);expect(x.deps().web!.store.state(ref.runId).counters.successReads).toBe(1);
 }finally{x.close();}
});

it.each([false,true])('host_start_keeps_failure_paused_and_resume_finishes_it (invalid=%s)',async invalid=>{
 const x=openDiskFixture();let host:SerialHost|undefined;try{
  const failed=await failMixed(x);x.clock.advance(600_000);x.reopen();x.requests.length=0;
  x.setResponse(async r=>r.task.name==='narrative'?failed.narration(r):r.task.name==='personal_life'?invalid?failed.invalid:{innerThought:'合法',emotions:[],contact:{willing:false}}:emptyMemory);
  const errors:unknown[]=[];host=new SerialHost(new HdsiApp(x.deps()),{timers:false,onError:error=>errors.push(error)});await host.start();expect(x.requests).toEqual([]);expect(x.db().runtime().paused).toBe(true);
  await host.resume();expect(x.db().runtime().paused).toBe(invalid);expect(x.db().read('turns',failed.turn.id)!.done).toBe(!invalid);
  if(invalid)expect(errors[0]).toBeInstanceOf(ModelFormatError);else expect(errors).toEqual([]);
 }finally{await host?.stop();x.close();}
});
