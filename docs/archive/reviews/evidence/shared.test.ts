import {it,expect} from 'vitest';
import {modern} from '../../../../tests/chat-fixture';
import {emptyMemory,silent} from '../../../../tests/helpers';
import {makeSharedFixture,configureSharedModels} from '../../../../tests/shared-v3-fixture';
import {InputBuffer} from '../../../../src/host/input';
import {HdsiApp} from '../../../../src/app';
import {Scheduler} from '../../../../src/host/scheduler';
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

