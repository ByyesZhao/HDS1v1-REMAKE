import {it,expect,vi} from 'vitest';
import {asyncFixture} from './environment-async-fixture';
import {EnvironmentPreparation} from '../src/environment/preparation';
import {selectEnvironmentStep} from '../src/environment/scheduler';
import {environmentStages as stages} from '../src/environment/types';
import {generateEnvironmentStep} from '../src/directors/school';
import {ModelClient,ModelRequestError} from '../src/model/client';
import {schoolPlan,schoolItem} from './world-school-fixture';
import {NOW,narrative} from './helpers';
import {SerialHost} from '../src/host/runtime';import {HdsiApp} from '../src/app';import {setImmediate} from 'node:timers/promises';
import {digest} from '../src/environment/digest';
it('all four nonempty stages freeze only after predecessor commits',async()=>{
 const {d,batch}=asyncFixture();let calls=0;
 const {id,revision,...plan}=schoolPlan;const {id:itemId,revision:ir,deliveryRevision,...item}=schoolItem();
 const outputs:any={world:{changes:[{action:'create',event:{kind:'world',description:'公共新闻',startsAt:NOW,endsAt:null,basis:'fiction',sourceUrls:[]}}]},
 school_campus:{stage:'school_campus',planChanges:[{action:'create',clientRef:'campus',plan}],itemChanges:[{action:'create',clientRef:'c',item:{...item,planId:'campus'}}]},
 school_group:{stage:'school_group',planChanges:[{action:'create',clientRef:'group',plan:{...plan,owner:'group',kind:'group'}}],itemChanges:[{action:'create',clientRef:'g',item:{...item,planId:'group',owner:'group',kind:'research',title:'科研计划'}}]}};
 const dep={...d,models:new ModelClient({complete:async request=>{calls++;const stage=request.task.name;if(stage==='school_week'){const input:any=request.input;return {stage,noticeTexts:input.context.notices.map((n:any)=>({key:n.key,text:'学校通知 '+n.key})),weekNotes:[]};}return outputs[stage];}})};
 dep.generateEnvironment=(input,options)=>generateEnvironmentStep(dep,input,options);
 const p=new EnvironmentPreparation(dep);
 for(let i=0;i<stages.length;i++){
 const step=selectEnvironmentStep(d.storage,NOW)!;expect(step.stage).toBe(stages[i]);p.startOne(step.id,NOW);
 if(i<3){const next=d.environmentStore.steps(batch.id).find(s=>s.stage===stages[i+1])!;expect(p.startOne(next.id,NOW)).toBe(false);expect(next.preparationSnapshot).toBeUndefined();}
 await p.wait();expect(d.environmentStore.step(step.id)?.status).toBe('ready');
 if(i===1)expect((d.environmentStore.step(step.id)!.inputSnapshot!.context as any).events).toHaveLength(1);
 if(i===2)expect((d.environmentStore.step(step.id)!.inputSnapshot!.context as any).campusTiming).toHaveLength(1);
 const ready=d.environmentStore.step(step.id)!;
 if(i===3)expect((ready.inputSnapshot!.context as any).sourceItems).toHaveLength(2);
 expect(p.applyReady(step.id,NOW)).toBe('applied');
 expect(d.environmentStore.step(step.id)).toMatchObject({inputSnapshot:null,preparationSnapshot:null,frozenResult:null,terminalAudit:{version:1,input:{modelContractVersion:1},basis:{inputDigest:digest(ready.inputSnapshot),resultDigest:digest(ready.frozenResult)},result:{stage:stages[i]}}});
 }
 expect(calls).toBe(4);expect(d.environmentStore.batch(batch.id)?.status).toBe('committed');expect(d.storage.all('events')).toHaveLength(1);expect(d.schoolStore.plans()).toHaveLength(2);expect(d.schoolStore.items()).toHaveLength(2);expect(d.schoolStore.instances().length).toBeGreaterThan(0);expect(d.schoolStore.notices().length).toBeGreaterThan(0);await p.stop();d.storage.close();
});
it('ready waits behind unresolved foreground and open input batch',async()=>{
 const {d,step}=asyncFixture();let finishEnv!:(v:any)=>void,finishChat!:(v:any)=>void;
 d.generateEnvironment=async input=>input.stage==='world'?new Promise(resolve=>finishEnv=resolve):Promise.reject(new ModelRequestError('later'));
 const original=d.models.runModel.bind(d.models);vi.spyOn(d.models,'runModel').mockImplementation(async(task,input,options)=>task.name==='narrative'?new Promise(resolve=>finishChat=resolve):original(task,input,options));
 const host=new SerialHost(new HdsiApp(d),{timers:false});await host.start();
 await host.acceptInput({id:'one',receivedAt:NOW,content:'你好',platformMessageIds:[]});d.clock.advance(16000);const foreground=host.wake();await setImmediate();
 finishEnv({stage:'world',changes:[{action:'create',event:{kind:'world',description:'新闻',startsAt:NOW,endsAt:null,basis:'fiction',sourceUrls:[]}}]});await setImmediate();expect(d.environmentStore.step(step.id)?.status).toBe('ready');expect(d.storage.all('events')).toHaveLength(0);
 await host.acceptInput({id:'two',receivedAt:d.clock.now(),content:'还有',platformMessageIds:[]});finishChat(narrative);await foreground;expect(d.environmentStore.step(step.id)?.status).toBe('ready');expect(d.storage.all('events')).toHaveLength(0);
 d.clock.advance(16000);const second=host.wake();await setImmediate();finishChat(narrative);await second;expect(d.environmentStore.step(step.id)?.status).toBe('committed');expect(d.storage.all('events')).toHaveLength(1);await host.stop();d.storage.close();
});
it('ready application rollback keeps result and reuses it',async()=>{
 const {d,step}=asyncFixture();const generator=vi.fn(async()=>({stage:'world' as const,changes:[]}));d.generateEnvironment=generator;
 const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);await p.wait();const frozen=d.environmentStore.step(step.id)!.frozenResult;
 const save=d.environmentStore.saveStep.bind(d.environmentStore);vi.spyOn(d.environmentStore,'saveStep').mockImplementationOnce(()=>{throw Error('storage fault');});
 expect(()=>p.applyReady(step.id,NOW)).toThrow('storage fault');expect(d.environmentStore.step(step.id)).toMatchObject({status:'ready',frozenResult:frozen});
 d.environmentStore.saveStep=save;expect(p.applyReady(step.id,NOW)).toBe('applied');expect(generator).toHaveBeenCalledTimes(1);await p.stop();d.storage.close();
});
