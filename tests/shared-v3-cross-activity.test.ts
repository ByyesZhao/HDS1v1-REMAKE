import {it,expect} from 'vitest';
import {modern} from './chat-fixture';
import {emptyMemory,silent} from './helpers';
import {makeSharedFixture,configureSharedModels} from './shared-v3-fixture';
import {InputBuffer} from '../src/host/input';
import {HdsiApp} from '../src/app';
import {Scheduler} from '../src/host/scheduler';
it('retains prior activity identity when next activity starts before its unread transfer batch is selected',async()=>{
 const d=modern();
 try{
  makeSharedFixture(d,{completedSteps:19});configureSharedModels(d);d.clock.advance(60_000);
  const input=new InputBuffer(d.storage),send=d.sender.sendItem.bind(d.sender),scheduler=new Scheduler(d.storage);
  let lateSent=false;
  d.sender.sendItem=async item=>{
   if(!lateSent){lateSent=true;await input.acceptInput({id:'old-activity-late',content:'【动作：把旧游戏的手柄放下】',receivedAt:d.clock.now()});}
   return send(item);
  };
  let endingPost=true;
  const run=d.models.runModel.bind(d.models);
  d.models.runModel=async(task,data,opts)=>{
   if(task.name==='memory'&&endingPost){
    endingPost=false;
    expect(d.storage.runtime().sharedClock?.status).toBe('ended');
    await input.acceptInput({id:'new-invitation',content:'现在一起开始拼图吧',receivedAt:d.clock.now()});
    d.clock.advance(16_000);
    await input.acceptInput({id:'new-extra',content:'拼图就在桌上',receivedAt:d.clock.now()});
   }
   return run(task,data,opts);
  };
  d.models.outputs.memory=emptyMemory;
  const app=new HdsiApp(d);
  await app.runTurn((await scheduler.collectReady(d.clock.now()))!);
  expect(d.storage.read('messages','old-activity-late')).toMatchObject({sharedActivityId:'activity-a',seenTurnId:null});
  expect(d.storage.read('messages','old-activity-late')?.batchId).toBe(d.storage.read('messages','new-extra')?.batchId);
  expect(d.storage.read('messages','new-invitation')?.batchId).not.toBe(d.storage.read('messages','old-activity-late')?.batchId);
  const next=(await scheduler.collectReady(d.clock.now()))!;
  expect(next.inputMessageIds).toEqual(['new-invitation']);
  d.models.outputs.personal_chat={...silent,sharedChange:{action:'start',mode:'shared_offline',title:'拼图'}};
  await app.runTurn(next);
  expect(d.storage.character().scene.shared?.activityId).not.toBe('activity-a');
  expect(d.storage.read('messages','old-activity-late')?.sharedActivityId).toBe('activity-a');
 }finally{d.storage.close();}
});

import {SerialHost} from '../src/host/runtime';
import {finishSharedTurn} from '../src/host/shared';
import type {TurnRecord} from '../src/types';
import {fixtureModelInput,narrative} from './helpers';

it.each(['open','pending','mixed_pending'] as const)('start keeps residual batches and original times: %s',kind=>{
 const d=modern();try{
  makeSharedFixture(d,{activityId:'B'});
  const readyAt='2026-10-07T10:00:15+08:00';
  const add=(id:string,batchId:string,sharedActivityId:string|null,receivedAt='2026-10-07T10:00:00+08:00')=>d.chat.acceptMessage({id,content:id,direction:'incoming',receivedAt,platformMessageIds:[],batchId,sharedActivityId,seenTurnId:null,turnId:null,outboxSeq:null});
  if(kind!=='pending')add('old','mixed','A');add('ordinary','mixed',null);add('only-old','old-batch','A');add('move-all','empty',null);
  d.storage.set('runtime',{...d.storage.runtime(),openBatch:kind==='open'?{id:'mixed',readyAt}:null,pendingBatchIds:kind==='open'?['old-batch','empty']:['mixed','old-batch','empty']});
  const turn={id:'start',frozenResult:{personal:{sharedChange:{action:'start'}}},sharedMeta:null} as TurnRecord;
  d.storage.transaction(()=>finishSharedTurn(d.storage,turn,d.clock.now(),d.chat));
  if(kind!=='pending')expect(d.storage.read('messages','old')).toMatchObject({sharedActivityId:'A',batchId:'mixed',seenTurnId:null,chatEpisodeId:null});
  expect(d.storage.read('messages','only-old')).toMatchObject({sharedActivityId:'A',seenTurnId:null});
  expect(d.storage.read('messages','ordinary')).toMatchObject({sharedActivityId:'B',batchId:null,chatEpisodeId:null});
  expect(d.storage.runtime().pendingBatchIds).toEqual(kind==='open'||kind==='pending'?['old-batch']:['mixed','old-batch']);
  expect(d.storage.runtime().openBatch).toEqual(kind==='open'?{id:'mixed',readyAt}:null);
  expect(d.storage.runtime().sharedClock?.lastInputAt).toBe('2026-10-07T10:00:00+08:00');
 }finally{d.storage.close();}
});
it('transfer transaction rolls back and replay preserves exactly the same residual batch',()=>{
 const d=modern();try{
  makeSharedFixture(d,{activityId:'B'});
  d.chat.acceptMessage({id:'old',content:'old',receivedAt:d.clock.now(),platformMessageIds:[],direction:'incoming',sharedActivityId:'A',batchId:'mixed',seenTurnId:null,turnId:null,outboxSeq:null});
  d.chat.acceptMessage({id:'new',content:'new',receivedAt:d.clock.now(),platformMessageIds:[],direction:'incoming',sharedActivityId:null,batchId:'mixed',seenTurnId:null,turnId:null,outboxSeq:null});
  d.storage.set('runtime',{...d.storage.runtime(),pendingBatchIds:['mixed']});
  const turn={id:'start',sharedMeta:null,frozenResult:{personal:{sharedChange:{action:'start'}}}} as TurnRecord;
  expect(()=>d.storage.transaction(()=>{finishSharedTurn(d.storage,turn,d.clock.now(),d.chat);throw Error('B failure');})).toThrow('B failure');
  expect(d.storage.read('messages','new')?.sharedActivityId).toBeNull();
  d.storage.transaction(()=>finishSharedTurn(d.storage,turn,d.clock.now(),d.chat));
  const saved=d.storage.messages(),runtime=d.storage.runtime();
  d.storage.transaction(()=>finishSharedTurn(d.storage,turn,d.clock.now(),d.chat));
  expect(d.storage.messages()).toEqual(saved);expect(d.storage.runtime()).toEqual(runtime);
 }finally{d.storage.close();}
});
it('SerialHost keeps A outside B and reads A once after B ends',async()=>{
 const d=modern();const errors:unknown[]=[],host=new SerialHost(new HdsiApp(d),{timers:false,onError:e=>errors.push(e)});
 try{
  makeSharedFixture(d,{completedSteps:19});configureSharedModels(d);d.clock.advance(60000);
  const send=d.sender.sendItem.bind(d.sender),run=d.models.runModel.bind(d.models);let late=false,post=true;
  d.sender.sendItem=async item=>{if(!late){late=true;await host.acceptInput({id:'old-host',content:'【动作：放下旧手柄】',receivedAt:d.clock.now()});}return send(item);};
  d.models.runModel=async(task,data,options)=>{
   if(task.name==='memory'&&post){post=false;await host.acceptInput({id:'invite-host',content:'开始拼图',receivedAt:d.clock.now()});d.clock.advance(16000);await host.acceptInput({id:'extra-host',content:'拼图在桌上',receivedAt:d.clock.now()});d.models.outputs.personal_chat={...silent,sharedChange:{action:'start',mode:'shared_offline',title:'拼图'}};}
   return run(task,data,options);
  };
  await host.start();expect(errors).toEqual([]);
  const b=d.storage.character().scene.shared!.activityId,open=d.storage.runtime().openBatch;
  expect(b).not.toBe('activity-a');expect(d.storage.read('messages','old-host')).toMatchObject({sharedActivityId:'activity-a',seenTurnId:null,batchId:open?.id});
  d.models.outputs.personal_chat=silent;
  d.models.outputs.narrative_shared=(input:any)=>({...narrative,publicNarration:'本次拼图告一段落，下次继续。',progress:'收尾',outline:{goal:'拼图',openThreads:[],endingCondition:'本次告一段落'},simulatedUserActions:[]});
  d.models.outputs.personal_shared={...silent,sharedChange:{action:'end'},nextPlan:'休息'};
  d.clock.advance(16000);await host.acceptInput({id:'advance-host',content:'【推进】',receivedAt:d.clock.now()});await host.wake();
  expect(errors).toEqual([]);expect(d.storage.read('messages','old-host')?.sharedActivityId).toBe('activity-a');
  const seen=d.storage.read('messages','old-host')?.seenTurnId;expect(seen).toBeTruthy();
  const sharedCalls=d.models.calls.filter(c=>c.name==='narrative_shared'&&fixtureModelInput(c.input).sharedMeta.activityId===b);
  expect(sharedCalls.length).toBeGreaterThan(0);expect(sharedCalls.every(c=>!c.input.resources.messages.some((m:any)=>m.id==='old-host'))).toBe(true);
  expect(d.chat.recent('personal',d.clock.now(),4).messages.some(m=>m.id==='old-host')).toBe(false);
  await host.wake();expect(d.storage.read('messages','old-host')?.seenTurnId).toBe(seen);
 }finally{await host.stop();d.storage.close();}
});
