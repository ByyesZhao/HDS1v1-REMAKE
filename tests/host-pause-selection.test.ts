import {expect,it} from 'vitest';
import {HdsiApp} from '../src/app';
import {InputBuffer} from '../src/host/input';
import {Scheduler} from '../src/host/scheduler';
import {SerialHost} from '../src/host/runtime';
import {MemoryStore} from '../src/memory/store';
import {modern} from './chat-fixture';
import {emptyMemory} from './helpers';

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
function appointment(d:ReturnType<typeof modern>,id:string){d.storage.save('tasks',id,{id,kind:'appointment',at:d.clock.now(),description:id,status:'pending'});}
async function waiting(){
 const d=modern(),input=new InputBuffer(d.storage),scheduler=new Scheduler(d.storage);
 await input.acceptInput({id:'a',content:'old',receivedAt:d.clock.now()});d.clock.advance(15000);
 const request=(await scheduler.collectReady(d.clock.now()))!;
 await input.acceptInput({id:'b',content:'new',receivedAt:d.clock.now()});
 const app=new HdsiApp(d);await app.runTurn(request);
 return {d,app,id:d.storage.unfinishedTurn()!.id};
}

// This deliberately exercises the Host API's resolved-Promise microtask boundary.
it('pause after ready selection starts no new story and resume consumes it once',async()=>{
 const d=modern();appointment(d,'due');const host=new SerialHost(new HdsiApp(d),{timers:false});
 try{
  const starting=host.start();const pausing=host.pause();
  expect(d.models.calls).toHaveLength(0);expect(d.storage.all('turns')).toHaveLength(0);
  await Promise.all([starting,pausing]);
  expect(d.models.calls).toHaveLength(0);expect(d.storage.all('turns')).toHaveLength(0);
  expect(d.storage.read('tasks','due')!.status).toBe('pending');
  await host.resume();
  expect(d.storage.read('tasks','due')!.status).toBe('completed');expect(d.storage.all('turns')).toHaveLength(1);
  expect(d.models.calls.filter(c=>c.name==='narrative')).toHaveLength(1);
 }finally{await host.stop();d.storage.close();}
});

it.each(['ordinary','event'] as const)('pause after waiting %s selection preserves generation until resume',async scope=>{
 const {d,app,id}=await waiting();
 if(scope==='ordinary')d.clock.advance(15000);else appointment(d,'event');
 const before=structuredClone(d.storage.read('turns',id)!.replyFreshness),host=new SerialHost(app,{timers:false});
 try{
  const starting=host.start();const pausing=host.pause();expect(d.models.calls).toHaveLength(0);
  await Promise.all([starting,pausing]);
  expect(d.models.calls).toHaveLength(0);expect(d.storage.read('turns',id)!.replyFreshness).toEqual(before);
  expect(d.storage.all('turns')).toHaveLength(1);
  await host.resume();
  expect(d.storage.read('turns',id)).toMatchObject({done:true,replyFreshness:{generation:2,scope}});
  expect(d.models.calls.filter(c=>c.name==='narrative')).toHaveLength(1);
 }finally{await host.stop();d.storage.close();}
});

it.each([false,true])('pause lets an already entered whole turn finish (waiting continuation=%s)',async continuation=>{
 const fixture=continuation?await waiting():null,d=fixture?.d??modern(),app=fixture?.app??new HdsiApp(d);
 if(continuation)d.clock.advance(15000);else appointment(d,'first');
 d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'完成当前回复',draft:'暂停时继续完成。两段都已发送。'},taskChanges:[]};
 d.models.outputs.expression={parts:[{kind:'text',content:'暂停时继续完成。'},{kind:'text',content:'两段都已发送。'}]};
 d.models.outputs.memory=(input:any)=>({...emptyMemory,detailChanges:[{action:'create',key:'暂停期间完成的回复',value:'两段都已发送',aliases:[],reason:'本轮已经确认的输出',sourceIds:[input.outgoing[0].id]}]});
 const started=deferred(),gate=deferred(),original=d.models.runModel.bind(d.models);let modelSignal:AbortSignal|undefined;
 const pausedStages:Array<{name:string;paused:boolean}>=[],sendingWhilePaused:boolean[]=[],send=d.sender.sendItem.bind(d.sender);
 d.models.runModel=async(task,input,options)=>{if(task.name==='narrative'){modelSignal=options?.signal;started.resolve();await gate.promise;}if(task.name==='expression'||task.name==='memory')pausedStages.push({name:task.name,paused:d.storage.runtime().paused});return original(task,input,options);};
 d.sender.sendItem=async item=>{sendingWhilePaused.push(d.storage.runtime().paused);return send(item);};
 const host=new SerialHost(app,{timers:false});
 try{
  const running=host.start();await started.promise;const id=d.storage.unfinishedTurn()!.id;
  if(continuation)expect(id).toBe(fixture!.id);
  await host.pause();appointment(d,'later');gate.resolve();await running;
  expect(modelSignal?.aborted).not.toBe(true);expect(d.storage.unfinishedTurn()).toBeNull();
  expect(d.storage.runtime().paused).toBe(true);expect(d.storage.all('turns')).toHaveLength(1);
  expect(d.storage.read('turns',id)).toMatchObject({done:true,outputComplete:true,frozenResult:null,completedAt:expect.any(String)});
  if(continuation)expect(d.storage.read('turns',id)!.replyFreshness).toMatchObject({generation:2,state:'sealed'});
  expect(d.models.calls.map(c=>c.name)).toEqual(['narrative','personal_chat','expression','memory']);
  expect(pausedStages).toEqual([{name:'expression',paused:true},{name:'memory',paused:true}]);
  expect(d.sender.sent.map(i=>({seq:i.seq,kind:i.kind,payload:i.payload}))).toEqual([{seq:0,kind:'text',payload:'暂停时继续完成。'},{seq:1,kind:'text',payload:'两段都已发送。'}]);
  expect(sendingWhilePaused).toEqual([true,true]);expect(d.sender.errors).toEqual([]);
  expect(d.storage.outbox(id)).toMatchObject([{seq:0,payload:'暂停时继续完成。',status:'confirmed',confirmedAt:expect.any(String),platformMessageIds:['qq-0']},{seq:1,payload:'两段都已发送。',status:'confirmed',confirmedAt:expect.any(String),platformMessageIds:['qq-1']}]);
  expect(d.storage.messagesByTurn(id).filter(m=>m.direction==='outgoing').map(m=>({content:m.content,platformMessageIds:m.platformMessageIds}))).toEqual([{content:'暂停时继续完成。',platformMessageIds:['qq-0']},{content:'两段都已发送。',platformMessageIds:['qq-1']}]);
  expect(new MemoryStore(d.storage).owner({ownerType:'detail',ownerId:'暂停期间完成的回复'})).toMatchObject({value:'两段都已发送',sourceIds:[`${id}:out:0`]});
  expect(d.storage.read('post_jobs',id)).toMatchObject({turnId:id,result:null});
  if(continuation){expect(d.storage.read('messages','a')!.seenTurnId).toBe(id);expect(d.storage.read('messages','b')!.seenTurnId).toBe(id);}else expect(d.storage.read('tasks','first')!.status).toBe('completed');
  expect(d.storage.read('tasks','later')!.status).toBe('pending');
  await host.resume();expect(d.storage.read('tasks','later')!.status).toBe('completed');
  expect(d.storage.all('turns')).toHaveLength(2);
 }finally{gate.resolve();await host.stop();d.storage.close();}
});

it('pause keeps accepting and batching input without a new model call',async()=>{
 const d=modern(),host=new SerialHost(new HdsiApp(d),{timers:false});
 try{
  await host.pause();await host.start();
  await host.acceptInput({id:'paused-input',content:'保存到恢复后',receivedAt:d.clock.now()});d.clock.advance(15000);await host.wake();
  expect(d.storage.read('messages','paused-input')!.seenTurnId).toBeNull();expect(d.models.calls).toHaveLength(0);
  await host.resume();expect(d.storage.read('messages','paused-input')!.seenTurnId).not.toBeNull();
  expect(d.storage.all('turns')).toHaveLength(1);expect(d.models.calls.filter(c=>c.name==='narrative')).toHaveLength(1);
 }finally{await host.stop();d.storage.close();}
});
