import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {HdsiApp,generateTurn} from '../src/app';
import type {Dependencies} from '../src/app';
import {Storage} from '../src/storage';
import {EnvironmentStore} from '../src/environment/store';
import {SchoolStore} from '../src/school/store';
import {ModelClient,ModelFormatError} from '../src/model/client';
import type {CompletionRequest} from '../src/model/client';
import {WebSearchService} from '../src/web/service';
import {WebSearchStore} from '../src/web/store';
import {prepareSchoolCommits} from '../src/school/progress';
import {freezeTurn,finishPostprocessing} from '../src/recovery';
import type {CharacterState,NarrativeResult,TurnRecord,TurnRequest} from '../src/types';
import type {SchoolNotice} from '../src/school/types';
import {schoolItem} from './world-school-fixture';
import {setup,narrative,emptyMemory} from './helpers';

const FROM='2026-10-06T23:00:00+08:00',SLEEP={sleepAt:'2026-10-07T00:06:00+08:00',wakeAt:'2026-10-07T08:01:00.000+08:00'},AT='2026-10-07T08:01:00.008+08:00';
const RELEASE='2026-10-07T08:00:00.012+08:00',BEFORE_WAKE='2026-10-07T08:00:40+08:00';
const REF={noticeId:'wake-notice',deliveryRevision:1};
const REQUEST:TurnRequest={inputMessageIds:[],taskIds:[],triggerKinds:['sleep'],schoolNoticeRefs:[REF]};
function seed(storage:Storage){
 const state=setup();const initial=state.storage.character();state.storage.close();
 storage.set('character',{...initial,narratedUntil:FROM,sleep:SLEEP});
 storage.set('runtime',{...storage.runtime(),dialogueContextVersion:2,environmentPlanningVersion:2,nextEnvironmentAt:'2099-01-01T00:00:00Z'});
 storage.save('chat_index_metadata','chat-index',{id:'chat-index',idleMinutes:15});
 const item=schoolItem({issuedAt:RELEASE});
 const notice:SchoolNotice={id:REF.noticeId,sourceItemId:item.id,instanceId:null,weekStart:null,deliveryRevision:1,kind:'issue',reminderKey:'issue',channel:'institution',publishAt:RELEASE,releasedAt:RELEASE,payload:{text:'合成班会通知',snapshots:[{entityKind:'plan_item',entityId:item.id,revision:1,value:item}]},status:'available',nextWakeAt:null,readAt:null,readTurnId:null};
 storage.save('school_plan_items',item.id,item);storage.save('school_notices',notice.id,notice);
}
function waking(){const d=setup();seed(d.storage);d.clock.time=AT;return d;}
function readAt(happenedAt:string):NarrativeResult{return {...narrative,experiences:[{happenedAt,description:'实际阅读合成通知',relatedEventIds:[]}],schoolObservations:[{via:'notice',sourceId:REF.noticeId,experienceIndex:0}]};}
function prepare(d:ReturnType<typeof setup>,at:string,result=readAt(at),turnAt=AT){const experiences=result.experiences.map((e,i)=>({...e,id:'read-'+i}));return prepareSchoolCommits(d.storage,{id:'wake-turn',at:turnAt,schoolNoticeRefs:[REF]} as TurnRecord,result,experiences);}
function setState(d:ReturnType<typeof setup>,patch:Partial<CharacterState>){d.storage.set('character',{...d.storage.character(),...patch});}
const restricted=(startsAt:string,expectedEndAt:string|null=null)=>({description:'合成不可看手机活动',startsAt,expectedEndAt,phoneAccess:false});

it('waking_narrative_receives_original_sleep_window',async()=>{
 const d=waking();try{
 d.models.outputs.narrative=readAt(SLEEP.wakeAt);
 const generated=await generateTurn(d,REQUEST,'wake-turn');
 const context=d.models.calls.find(c=>c.name==='narrative')!.input.context;
 expect(context).toMatchObject({from:FROM,at:AT,waking:true,state:{sleep:SLEEP}});
 expect(d.models.calls.find(c=>c.name==='personal_life')!.input.context.state.sleep).toBeNull();
 expect(d.storage.character()).toMatchObject({sleep:SLEEP,narratedUntil:FROM});
 expect(generated.candidate.nextState.sleep).toEqual({sleepAt:'2026-10-07T16:00:00.000Z',wakeAt:'2026-10-08T00:30:00.000Z'});
 expect(generated.candidate.schoolObservations?.[0].happenedAt).toBe(SLEEP.wakeAt);
 }finally{d.storage.close();}
});
it.each([BEFORE_WAKE,'2026-10-07T00:30:00+08:00'])('read_notice_before_wake_is_rejected (%s)',at=>{
 const d=waking();try{const notice=d.storage.read('school_notices',REF.noticeId)!;d.storage.save('school_notices',notice.id,{...notice,publishAt:FROM,releasedAt:FROM});expect(()=>prepare(d,at)).toThrow(/not readable/);}finally{d.storage.close();}
});
it.each([SLEEP.wakeAt,AT])('read_notice_at_or_after_wake_is_allowed (%s)',at=>{
 const d=waking();try{expect(prepare(d,at).observations).toMatchObject([{happenedAt:at,via:'notice'}]);}finally{d.storage.close();}
});
it('waking_round_preserves_valid_presleep_notice_reading',()=>{
 const d=waking();try{const notice=d.storage.read('school_notices',REF.noticeId)!;d.storage.save('school_notices',notice.id,{...notice,publishAt:FROM,releasedAt:FROM});expect(prepare(d,'2026-10-06T23:50:00+08:00').observations).toHaveLength(1);}finally{d.storage.close();}
});
it.each(['publishAt','releasedAt'] as const)('unpublished_or_unreleased_notice_is_rejected (%s)',field=>{
 const d=waking();try{const notice=d.storage.read('school_notices',REF.noticeId)!;d.storage.save('school_notices',notice.id,{...notice,[field]:AT});expect(()=>prepare(d,SLEEP.wakeAt)).toThrow(/not published/);}finally{d.storage.close();}
});
it('phone_access_false_after_wake_still_rejects_notice',()=>{
 const d=waking();try{const scene={...d.storage.character().scene,activity:restricted(FROM,'2026-10-07T08:30:00+08:00')};setState(d,{scene});expect(()=>prepare(d,SLEEP.wakeAt,{...readAt(SLEEP.wakeAt),currentScene:scene})).toThrow(/not readable/);}finally{d.storage.close();}
});
it('new_readable_activity_after_wake_allows_notice_before_turn_millisecond',()=>{
 const d=waking();try{setState(d,{scene:{...d.storage.character().scene,activity:restricted(FROM,'2026-10-07T08:30:00+08:00')}});const result={...readAt(SLEEP.wakeAt),currentScene:{description:'已结束活动并起床',activity:{description:'实际查看手机',startsAt:SLEEP.wakeAt,phoneAccess:true,expectedEndAt:null}}};expect(prepare(d,SLEEP.wakeAt,result).observations).toHaveLength(1);}finally{d.storage.close();}
});
it('new_readable_activity_cannot_authorize_sleep_interval_reading',()=>{
 const d=waking();try{setState(d,{scene:{...d.storage.character().scene,activity:restricted(FROM,'2026-10-07T08:30:00+08:00')}});const result={...readAt(BEFORE_WAKE),currentScene:{description:'非法提前醒',activity:{description:'看手机',startsAt:BEFORE_WAKE,phoneAccess:true,expectedEndAt:null}}};expect(()=>prepare(d,BEFORE_WAKE,result)).toThrow(/not readable/);}finally{d.storage.close();}
});
it.each(['2026-10-06T22:59:59+08:00','2026-10-07T08:01:00.009+08:00'])('experience_outside_turn_is_rejected (%s)',at=>{
 const d=waking();try{expect(()=>prepare(d,at)).toThrow(/actual experience/);}finally{d.storage.close();}
});
it('non_waking_round_preserves_future_sleep_window',async()=>{
 const d=waking();try{d.clock.time='2026-10-06T23:50:00+08:00';d.models.outputs.narrative=narrative;await generateTurn(d,{inputMessageIds:[],taskIds:[],triggerKinds:['autonomous']},'awake-turn');const context=d.models.calls.find(c=>c.name==='narrative')!.input.context;expect(context.waking).toBe(false);expect(context.state.sleep).toEqual(SLEEP);expect(d.models.calls.find(c=>c.name==='personal_life')!.input.context.state.sleep).toEqual(SLEEP);}finally{d.storage.close();}
});
it('shared_notice_permissions_remain_readable_during_stored_sleep',()=>{
 const d=waking();try{setState(d,{scene:{...d.storage.character().scene,mode:'shared_online',activity:restricted(FROM,'2026-10-07T08:30:00+08:00'),shared:{activityId:'shared',title:'合成活动',progress:'进行中',lastPublicNode:'',nextStepAt:AT,completedSteps:1,maxSteps:10,idleSeconds:60,outline:null}}});expect(prepare(d,BEFORE_WAKE).observations).toHaveLength(1);}finally{d.storage.close();}
});
it('waking_state_commits_only_with_story_B_transaction_and_keeps_next_night',async()=>{
 const d=waking();try{d.models.outputs.narrative=readAt(SLEEP.wakeAt);const turn:TurnRecord={id:'wake-turn',at:AT,inputMessageIds:[],triggerTaskIds:[],triggerKinds:['sleep'],batchIds:[],entryMode:'chat',frozenResult:null,outputComplete:false,done:false,completedAt:null,schoolNoticeRefs:[REF]};const app=new HdsiApp(d);turn.dialogueWindowVersion=2;turn.chatBinding=app.dependencies.chat!.bindTurn(turn);d.storage.save('turns',turn.id,turn);const generated=await generateTurn(d,REQUEST,turn.id);const frozen=freezeTurn(d,turn,generated.candidate,generated.items);expect(d.storage.character().sleep).toEqual(SLEEP);
 d.storage.prepare("CREATE TRIGGER reject_wake_commit BEFORE UPDATE ON state WHEN NEW.key='character' BEGIN SELECT RAISE(ABORT,'synthetic B failure'); END").run();
 await expect(finishPostprocessing(d,frozen)).rejects.toThrow('synthetic B failure');expect(d.storage.character()).toMatchObject({sleep:SLEEP,narratedUntil:FROM});expect(d.storage.all('experiences')).toEqual([]);expect(d.storage.all('school_knowledge')).toEqual([]);expect(d.storage.read('school_notices',REF.noticeId)!.status).toBe('available');
 d.storage.prepare('DROP TRIGGER reject_wake_commit').run();await finishPostprocessing(d,frozen);expect(d.storage.character()).toMatchObject({narratedUntil:AT,sleep:{sleepAt:'2026-10-07T16:00:00.000Z',wakeAt:'2026-10-08T00:30:00.000Z'}});expect(d.storage.read('school_notices',REF.noticeId)).toMatchObject({status:'read',readAt:SLEEP.wakeAt});expect(d.storage.read('turns',turn.id)!.done).toBe(true);
 }finally{d.storage.close();}
});

function disk(){
 const base=waking();base.storage.close();const root=mkdtempSync(join(tmpdir(),'waking-school-')),file=join(root,'state.sqlite');let storage=new Storage(file);seed(storage);const requests:CompletionRequest[]=[];
 let response:(r:CompletionRequest)=>Promise<unknown>=async r=>r.task.name==='narrative'?readAt(SLEEP.wakeAt):r.task.name==='personal_life'?{innerThought:'合成休息',emotions:[],contact:{willing:false}}:emptyMemory;
 const models=new ModelClient({complete:async r=>{requests.push({...r,input:structuredClone(r.input),repair:structuredClone(r.repair)});return response(r);}});
 const deps=():Dependencies=>({...base,storage,models,web:new WebSearchService(new WebSearchStore(storage),undefined,base.clock,{enabled:false}),environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage)});
 return {db:()=>storage,deps,clock:base.clock,sender:base.sender,requests,setResponse:(fn:typeof response)=>{response=fn;},reopen:()=>{storage.close();storage=new Storage(file);},close:()=>{storage.close();const target=resolve(root);if(!target.startsWith(resolve(tmpdir())+sep))throw Error('unsafe test cleanup');rmSync(target,{recursive:true,force:true});}};
}
async function failWaking(x:ReturnType<typeof disk>){
 x.setResponse(async()=>readAt(BEFORE_WAKE));await expect(new HdsiApp(x.deps()).runTurn(REQUEST)).rejects.toThrow(ModelFormatError);const turn=x.db().unfinishedTurn()!,ref=x.deps().web!.store.openStage('turn',turn.id,'narrative','narrative');
 expect(x.requests.map(r=>r.task.name)).toEqual(['narrative','narrative','narrative']);expect(x.deps().web!.store.checkpoint(ref.runId)!.repairCount).toBe(2);expect(turn).toMatchObject({frozenResult:null,outputComplete:false,done:false});expect(x.db().outbox(turn.id)).toEqual([]);expect(x.sender.sent).toEqual([]);expect(x.db().character()).toMatchObject({sleep:SLEEP,narratedUntil:FROM});return {turn,ref};
}
it.each([false,true])('failed_waking_turn_reopens_at_new_clock_with_repair_budget_two (invalid=%s)',async invalid=>{
 const x=disk();try{const {turn,ref}=await failWaking(x);x.clock.advance(600_000);x.reopen();x.requests.length=0;let repairCount=-1;
 x.setResponse(async r=>{if(r.task.name==='narrative'){expect(r.repair?.original).toEqual(readAt(BEFORE_WAKE));const recovered=x.deps().web!.store.openStage('turn',turn.id,'narrative','narrative');expect(recovered.runId).toBe(ref.runId);repairCount=x.deps().web!.store.checkpoint(ref.runId)!.repairCount;return readAt(invalid?BEFORE_WAKE:SLEEP.wakeAt);}if(r.task.name==='personal_life'){expect((r.input as any).context.state.sleep).toBeNull();return {innerThought:'合法合成起床',emotions:[],contact:{willing:false}};}return emptyMemory;});
 if(invalid)await expect(new HdsiApp(x.deps()).resumeUnfinishedTurn()).rejects.toThrow(ModelFormatError);else await new HdsiApp(x.deps()).resumeUnfinishedTurn();
 expect(repairCount).toBe(2);expect(x.requests.filter(r=>r.task.name==='narrative')).toHaveLength(1);expect((x.requests[0].input as any).context).toMatchObject({at:x.clock.now(),from:FROM,waking:true,state:{sleep:SLEEP}});expect(x.db().read('turns',turn.id)).toMatchObject({id:turn.id,at:x.clock.now(),done:!invalid});expect(x.sender.sent).toEqual([]);
 if(invalid){expect(x.db().runtime()).toMatchObject({paused:true,lastFailure:{stage:'generation'}});expect(x.requests.map(r=>r.task.name)).toEqual(['narrative']);expect(x.db().unfinishedTurn()).toMatchObject({id:turn.id,frozenResult:null,outputComplete:false});expect(x.deps().web!.store.checkpoint(ref.runId)!.repairCount).toBe(2);expect(x.db().all('experiences')).toEqual([]);expect(x.db().all('school_knowledge')).toEqual([]);expect(x.db().character().sleep).toEqual(SLEEP);}
 else{expect(x.requests.map(r=>r.task.name)).toEqual(['narrative','personal_life','memory']);expect(x.db().read('school_notices',REF.noticeId)).toMatchObject({status:'read',readAt:SLEEP.wakeAt});expect(x.db().character().sleep?.wakeAt).toBe('2026-10-08T00:30:00.000Z');}
 }finally{x.close();}
});
it.each([false,true])('disk_waking_attempted_or_silent_sealed_candidate_does_not_regenerate (attempted=%s)',async attempted=>{
 const x=disk();try{const d=x.deps(),turn:TurnRecord={id:'sealed-wake',at:AT,inputMessageIds:[],triggerTaskIds:[],triggerKinds:['sleep'],batchIds:[],entryMode:'chat',frozenResult:null,outputComplete:false,done:false,completedAt:null,schoolNoticeRefs:[REF]};const app=new HdsiApp(d);turn.dialogueWindowVersion=2;turn.chatBinding=app.dependencies.chat!.bindTurn(turn);x.db().save('turns',turn.id,turn);const generated=await generateTurn(d,REQUEST,turn.id);const items=attempted?[{turnId:turn.id,seq:0,kind:'text' as const,payload:'已尝试的合成输出',status:'pending' as const,confirmedAt:null,platformMessageIds:[],notBefore:null}]:[];freezeTurn(d,turn,generated.candidate,items);if(attempted)x.db().saveOutbox({...x.db().outbox(turn.id)[0],status:'sending'});else expect(x.db().read('turns',turn.id)!.outputComplete).toBe(true);
 x.clock.advance(600_000);x.reopen();x.requests.length=0;x.setResponse(async r=>{if(r.task.name!=='memory')throw Error('sealed candidate must not regenerate');return emptyMemory;});await new HdsiApp(x.deps()).resumeUnfinishedTurn();expect(x.requests.map(r=>r.task.name)).toEqual(['memory']);expect(x.db().read('turns',turn.id)).toMatchObject({at:AT,done:true});expect(x.sender.sent.map(i=>i.payload)).toEqual(attempted?['已尝试的合成输出']:[]);expect(x.db().read('school_notices',REF.noticeId)!.readAt).toBe(SLEEP.wakeAt);
 }finally{x.close();}
});
