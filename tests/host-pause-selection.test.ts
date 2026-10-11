import {expect,it} from 'vitest';
import {HdsiApp} from '../src/app';
import {InputBuffer} from '../src/host/input';
import {Scheduler} from '../src/host/scheduler';
import {SerialHost} from '../src/host/runtime';
import {modern} from './chat-fixture';

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
 const started=deferred(),gate=deferred(),original=d.models.runModel.bind(d.models);let modelSignal:AbortSignal|undefined;
 d.models.runModel=async(task,input,options)=>{if(task.name==='narrative'){modelSignal=options?.signal;started.resolve();await gate.promise;}return original(task,input,options);};
 const host=new SerialHost(app,{timers:false});
 try{
  const running=host.start();await started.promise;await host.pause();appointment(d,'later');gate.resolve();await running;
  expect(modelSignal?.aborted).not.toBe(true);expect(d.storage.unfinishedTurn()).toBeNull();
  expect(d.storage.all('turns')).toHaveLength(1);expect(d.storage.all('turns')[0].done).toBe(true);
  expect(d.storage.read('tasks','later')!.status).toBe('pending');
  expect(d.models.calls.filter(c=>c.name==='narrative')).toHaveLength(1);
  expect(d.models.calls.some(c=>c.name==='personal_chat')).toBe(true);
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
