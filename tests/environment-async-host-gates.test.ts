import {it,expect} from 'vitest';
import {asyncFixture} from './environment-async-fixture';
import {NOW} from './helpers';
import {EnvironmentPreparation} from '../src/environment/preparation';
import {SerialHost} from '../src/host/runtime';
import {HdsiApp} from '../src/app';
import {ModelRequestError} from '../src/model/client';

const cases=(['ready','pending'] as const).flatMap(initial=>(['pause','input','stop'] as const).map(gate=>({initial,gate})));
it.each(cases)('$initial rechecks $gate after candidate selection and reuses work after reopening',async({initial,gate})=>{
 const {d,step}=asyncFixture();let worldCalls=0;
 d.generateEnvironment=async input=>{
  if(input.stage!=='world')throw new ModelRequestError('offline later stage');
  worldCalls++;
  return {stage:'world',changes:[{action:'create',event:{kind:'world',description:'offline gate event',startsAt:NOW,endsAt:null,basis:'fiction',sourceUrls:[]}}]};
 };
 if(initial==='ready'){
  const prep=new EnvironmentPreparation(d);
  try{expect(prep.startOne(step.id,NOW)).toBe(true);await prep.wait();}
  finally{await prep.stop();}
  expect(d.environmentStore.step(step.id)!.status).toBe('ready');
 }
 const original=d.environmentStore.step(step.id)!,frozen=structuredClone(original.frozenResult);
 const creation=frozen?.stage==='world'?frozen.changes.find(c=>c.action==='create'):undefined;
 const expectedId=creation?.action==='create'?creation.id:undefined;
 let host=new SerialHost(new HdsiApp(d),{timers:false});
 try{
  const starting=host.start();
  const gating=gate==='pause'?host.pause():gate==='stop'?host.stop():host.acceptInput({id:'gate-input',content:'你好',receivedAt:NOW,platformMessageIds:[]});
  await Promise.all([starting,gating]);
  const blocked=d.environmentStore.step(step.id)!;
  expect(blocked.status).toBe(initial);expect(d.storage.all('events')).toHaveLength(0);
  expect(blocked.frozenResult).toEqual(frozen);expect(blocked.preparationGeneration).toBe(original.preparationGeneration);
  expect(worldCalls).toBe(initial==='ready'?1:0);
  if(initial==='pending'){expect(blocked.attempt).toBe(0);expect(blocked.inputSnapshot).toBeNull();expect(blocked.preparationSnapshot).toBeUndefined();}
  if(gate==='pause')expect(d.storage.runtime().paused).toBe(true);
  if(gate==='input')expect(d.storage.runtime().openBatch).not.toBeNull();
  await host.wake();await host.wake();
  expect(d.environmentStore.step(step.id)!.status).toBe(initial);
  expect(worldCalls).toBe(initial==='ready'?1:0);
  if(gate==='stop'){await host.stop();host=new SerialHost(new HdsiApp(d),{timers:false});await host.start();}
  else if(gate==='pause')await host.resume();
  else{
   d.clock.advance(16000);await host.wake();
   expect(d.storage.all('turns').some(t=>t.done&&t.inputMessageIds.includes('gate-input'))).toBe(true);
  }
  // A completed background preparation wakes the Host independently.
  await new Promise<void>(resolve=>setImmediate(resolve));await host.wake();
  expect(d.environmentStore.step(step.id)!.status).toBe('committed');
  expect(d.storage.all('events')).toHaveLength(1);expect(worldCalls).toBe(1);
  if(initial==='ready')expect(d.storage.all('events')[0].id).toBe(expectedId);
  await host.wake();expect(d.storage.all('events')).toHaveLength(1);expect(worldCalls).toBe(1);
 }finally{await host.stop();d.storage.close();}
});
