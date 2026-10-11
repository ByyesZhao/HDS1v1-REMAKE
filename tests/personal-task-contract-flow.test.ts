import {expect,it} from 'vitest';
import {HdsiApp} from '../src/app';
import {InputBuffer} from '../src/host/input';
import {Scheduler} from '../src/host/scheduler';
import {personalTask} from '../src/model/contracts';
import {ModelClient} from '../src/model/client';
import {modern} from './chat-fixture';
import {schoolItem,expand} from './world-school-fixture';
import {narrative,silent} from './helpers';

const after=(at:string,ms:number)=>new Date(Date.parse(at)+ms).toISOString();
async function mixed(){
 const d=modern();d.storage.set('runtime',{...d.storage.runtime(),environmentPlanningVersion:2});
 const input=new InputBuffer(d.storage),scheduler=new Scheduler(d.storage,d.config),app=new HdsiApp(d);
 await input.acceptInput({id:'old-a',content:'合成历史一',receivedAt:d.clock.now()});await input.acceptInput({id:'old-b',content:'合成历史二',receivedAt:d.clock.now()});
 d.clock.advance(15_000);const seed=(await scheduler.collectReady(d.clock.now()))!;await app.runTurn(seed);
 const oldSeen=['old-a','old-b'].map(id=>d.storage.read('messages',id)!.seenTurnId);expect(oldSeen.every(Boolean)).toBe(true);
 d.storage.save('school_plan_items','meeting',schoolItem());expand(d,d.clock.now());
 await input.acceptInput({id:'new',content:'合成新输入',receivedAt:d.clock.now()});d.clock.advance(15_000);
 const request=(await scheduler.collectReady(d.clock.now()))!;expect(request.schoolNoticeRefs?.length).toBeGreaterThan(0);expect(request.replyInputRevision).toBeUndefined();
 const observedAt=d.clock.now(),end=after(observedAt,5*60_000),noticeId=request.schoolNoticeRefs![0].noticeId;
 const experiences=[{happenedAt:observedAt,description:'合成获知学校通知',relatedEventIds:['meeting']}];
 d.models.outputs.narrative={...narrative,experiences,schoolObservations:[{via:'notice',sourceId:noticeId,experienceIndex:0}],currentScene:{description:'合成小憩',activity:{description:'合成不可读活动',startsAt:observedAt,expectedEndAt:end,phoneAccess:false}}};
 d.models.calls.length=0;
 return {d,input,scheduler,app,request,oldSeen,experiences,end};
}

it.each(['chat','life','shared'] as const)('personal_%s_prompts_assign_checks_to_program',kind=>{
 const task=personalTask(kind,'2026-10-07T10:00:00+08:00',[],'chat',[]);
 expect(task.prompt).toMatch(/taskChanges[^。]*仅[^。]*appointment/u);
 expect(task.prompt).toMatch(/check_messages[^。]*scene_step[^。]*程序/u);
 expect(task.prompt).not.toContain('taskChanges 中 create/update 后最终 check_messages.at 必须晚于本轮 at');
 if(kind==='life')expect(task.prompt).toMatch(/未来[^。]*nextPlan/u);else expect(task.prompt).toContain('reply=later');
});

it('normal_lookup_and_repair_requests_keep_ownership_prompt',async()=>{
 const task=personalTask('chat','2026-10-07T10:00:00+08:00',[],'chat',[]),prompts:string[]=[];
 const values:unknown[]=[{lookupDetails:'合成'},{...silent,taskChanges:[{action:'create',task:{kind:'check_messages',at:'2026-10-07T11:00:00+08:00',description:'非法',checkReason:'unread',messageIds:[]}}]},silent];
 await new ModelClient({complete:async r=>{prompts.push(r.task.prompt);return values.shift();}}).runModel(task,{}, {lookup:async()=>({fact:'合成'})});
 expect(prompts).toHaveLength(3);for(const prompt of prompts){expect(prompt).toEqual(task.prompt);expect(prompt).toMatch(/taskChanges[^。]*仅[^。]*appointment/u);}
});

it.each([false,true])('school_observation_keeps_personal_life_when_phone_is_inaccessible (taskChanges=%s)',async explicit=>{
 const x=await mixed(),{d}=x;try{
  d.models.outputs.personal_life={innerThought:'理解通知后休息',emotions:[],contact:{willing:false},nextPlan:'醒来再查看手机',...(explicit?{taskChanges:[]}: {})};
  await x.app.runTurn(x.request);
  const person=d.models.calls.find(c=>c.name==='personal_life')!.input;
  expect(person.context.experiences).toEqual(x.experiences);expect(person.context.state.scene.activity).toMatchObject({phoneAccess:false,expectedEndAt:x.end});
  expect(person.roles.visibleIds).toEqual([]);expect(person.roles.reconsiderIds).toEqual([]);expect(d.models.calls.some(c=>c.name==='expression')).toBe(false);
  expect(d.storage.all('turns').at(-1)!.done).toBe(true);expect(d.storage.runtime().paused).toBe(false);expect(d.sender.sent).toEqual([]);
  expect(d.storage.read('messages','new')!.seenTurnId).toBeNull();expect(['old-a','old-b'].map(id=>d.storage.read('messages',id)!.seenTurnId)).toEqual(x.oldSeen);
  expect(d.storage.pendingTasks().filter(t=>t.kind==='check_messages')).toEqual([expect.objectContaining({checkReason:'unread',messageIds:['new'],at:x.end})]);
 }finally{d.storage.close();}
});

it('inaccessible_without_observation_can_skip_personal',async()=>{
 const d=modern();try{
  d.storage.set('runtime',{...d.storage.runtime(),environmentPlanningVersion:2});await new InputBuffer(d.storage).acceptInput({id:'new',content:'合成',receivedAt:d.clock.now()});d.clock.advance(15_000);
  d.models.outputs.narrative={...narrative,currentScene:{description:'小憩',activity:{description:'不可读',startsAt:d.clock.now(),expectedEndAt:after(d.clock.now(),300_000),phoneAccess:false}}};
  await new HdsiApp(d).runTurn((await new Scheduler(d.storage,d.config).collectReady(d.clock.now()))!);
  expect(d.models.calls.filter(c=>c.name.startsWith('personal_'))).toEqual([]);expect(d.storage.read('messages','new')!.seenTurnId).toBeNull();
 }finally{d.storage.close();}
});

it('readable_later_reuses_deferred_id_without_rereading_history',async()=>{
 const x=await mixed(),{d}=x;try{
  await x.app.runTurn(x.request);d.clock.time=x.end;d.models.outputs.narrative=narrative;
  d.models.outputs.personal_chat={...silent,reply:{decision:'later',reconsiderAt:after(d.clock.now(),600_000),intention:'稍后认真考虑'}};
  await x.app.runTurn((await x.scheduler.collectReady(d.clock.now()))!);
  const seen=d.storage.read('messages','new')!.seenTurnId;expect(seen).toBeTruthy();
  const deferred=d.storage.pendingTasks().find(t=>t.checkReason==='deferred_reply')!;expect(deferred.messageIds).toEqual(['new']);
  d.clock.time=deferred.at;d.models.outputs.personal_chat.reply.reconsiderAt=after(d.clock.now(),600_000);
  await x.app.runTurn((await x.scheduler.collectReady(d.clock.now()))!);
  const person=d.models.calls.filter(c=>c.name==='personal_chat').at(-1)!.input;
  expect(person.roles.visibleIds).toEqual([]);expect(person.roles.reconsiderIds).toEqual(['new']);
  expect(d.storage.read('tasks',deferred.id)).toMatchObject({status:'pending',checkReason:'deferred_reply',messageIds:['new'],at:d.models.outputs.personal_chat.reply.reconsiderAt});
  expect(d.storage.pendingTasks().filter(t=>t.kind==='check_messages')).toHaveLength(1);expect(d.storage.read('messages','new')!.seenTurnId).toBe(seen);
  expect(['old-a','old-b'].map(id=>d.storage.read('messages',id)!.seenTurnId)).toEqual(x.oldSeen);
 }finally{d.storage.close();}
});
