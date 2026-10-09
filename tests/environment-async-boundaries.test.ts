import {it,expect,vi} from 'vitest';
import {asyncFixture} from './environment-async-fixture';
import {NOW} from './helpers';
import {EnvironmentPreparation} from '../src/environment/preparation';
import {environmentBusinessBasis,freezeEnvironmentSnapshot,lookupFrozenEnvironment} from '../src/environment/snapshot';
import {ensureEnvironmentBatch,selectEnvironmentStepMetadata} from '../src/environment/scheduler';
import {schoolPlan,schoolItem,expand} from './world-school-fixture';
import {MemoryStore} from '../src/memory/store';import {MemoryRetrieval} from '../src/memory/retrieval';
import {ModelClient} from '../src/model/client';import {generateEnvironmentStep} from '../src/directors/school';
import {setImmediate} from 'node:timers/promises';
it('unrelated new chat does not stale group; known membership does stale week',async()=>{
 const {d,step}=asyncFixture('school_group');d.generateEnvironment=async()=>({stage:'school_group',planChanges:[],itemChanges:[]});const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);await p.wait();
 d.storage.save('messages','unrelated',{id:'unrelated',content:'你好',receivedAt:NOW,direction:'incoming',platformMessageIds:[],seenTurnId:'t',turnId:null,outboxSeq:null,batchId:null});expect(p.applyReady(step.id,NOW)).toBe('applied');await p.stop();d.storage.close();
 const other=asyncFixture('school_week');other.d.generateEnvironment=async()=>({stage:'school_week',noticeTexts:[],weekNotes:[]});const next=new EnvironmentPreparation(other.d);next.startOne(other.step.id,NOW);await next.wait();
 const item=schoolItem();other.d.storage.save('school_knowledge','k',{id:'k',entityKind:'plan_item',entityId:item.id,revision:1,snapshot:{entityKind:'plan_item',entityId:item.id,revision:1,value:item},acquiredAt:NOW,experienceId:'e',turnId:'t',via:'notice'});expect(next.applyReady(other.step.id,NOW)).toBe('stale');await next.stop();other.d.storage.close();
});
it('freeze before issue, commit after issue cannot hide a published item in the future',async()=>{
 const {d,step}=asyncFixture('school_campus');d.clock.time='2026-10-07T09:59:00+08:00';const item=schoolItem({issuedAt:NOW});d.storage.save('school_plans',schoolPlan.id,schoolPlan);d.storage.save('school_plan_items',item.id,item);
 d.generateEnvironment=async()=>({stage:'school_campus',planChanges:[],itemChanges:[{action:'update',id:item.id,expectedRevision:1,item:{issuedAt:'2026-10-07T12:00:00+08:00'}}]});
 const p=new EnvironmentPreparation(d);p.startOne(step.id,d.clock.now());await p.wait();expect(d.environmentStore.step(step.id)?.status).toBe('ready');d.clock.advance(120000);
 expect(p.applyReady(step.id,d.clock.now())).toBe('stale');expect(d.storage.read('school_plan_items',item.id)?.issuedAt).toBe(NOW);await p.stop();d.storage.close();
});
it('frozen candidates/vectors and recent remain independent of live mutations and use no remote vector when uncalibrated',async()=>{
 const {d,step}=asyncFixture();const store=new MemoryStore(d.storage);store.migrate(NOW);
 const row=store.makeOwner({ownerType:'detail',ownerId:'phone'},{key:'phone',aliases:['手机'],value:'旧手机',content:'旧手机',sourceIds:[]},NOW);store.saveOwner(row);
 const index:any={configSignature:'fixture',dimensions:2,query:vi.fn(),stats:{}};d.storage.set('memory_embedding_signature','fixture');store.saveVector(row,'fixture',Float32Array.from([1,0]));
 const retrieval=new MemoryRetrieval(store,index),snapshot=freezeEnvironmentSnapshot({...d,retrieval,memoryStore:store},step,NOW),roundtrip=JSON.parse(JSON.stringify(snapshot));
 store.saveOwner({...row,value:'新手机',revision:2});const result=await lookupFrozenEnvironment(roundtrip,'手机',retrieval);expect(result.context.details[0].value).toBe('旧手机');expect(roundtrip.retrieval.candidates[0].normalizedVector).toEqual([1,0]);expect(index.query).not.toHaveBeenCalled();
 expect((await lookupFrozenEnvironment(roundtrip,'不存在',retrieval)).context.details).toEqual([]);d.storage.close();
});
it('lookup abort while pending is resumable and late results cannot overwrite checkpoint',async()=>{
 const {d,step}=asyncFixture();const store=new MemoryStore(d.storage);store.migrate(NOW);const row=store.makeOwner({ownerType:'detail',ownerId:'x'},{key:'x',value:'X',content:'X',sourceIds:[]},NOW);store.saveOwner(row);
 const retrieval=new MemoryRetrieval(store);let finish!:(v:any)=>void;const original=retrieval.buildFrozen.bind(retrieval);vi.spyOn(retrieval,'buildFrozen').mockImplementationOnce(async(...args)=>{await new Promise(resolve=>finish=resolve);return original(...args);});
 const dep={...d,memoryStore:store,retrieval};let calls=0;dep.models=new ModelClient({complete:async request=>{calls++;return request.lookupResult?{changes:[]}:{lookupDetails:'x'};}}) as any;dep.generateEnvironment=(input,options)=>generateEnvironmentStep(dep,input,options);
 const p=new EnvironmentPreparation(dep);p.startOne(step.id,NOW);await setImmediate();const ref=d.web.store.openStage('environment',step.id,'generation',step.stage);expect(d.web.store.snapshot(ref.runId).checkpoint).toMatchObject({lookupPending:true,lookupRequest:'x'});const stopping=p.stop();finish(null);await stopping;
 expect(d.web.store.snapshot(ref.runId).checkpoint!.privateLookupResult).toBeUndefined();expect(d.environmentStore.step(step.id)?.preparationSnapshot?.usedBasis).toBeNull();
 const resumed=new EnvironmentPreparation(dep);resumed.startOne(step.id,NOW);await resumed.wait();expect(calls).toBe(2);expect(d.web.store.snapshot(ref.runId).checkpoint!.lookupPending).toBe(false);expect(d.environmentStore.step(step.id)?.attempt).toBe(1);await resumed.stop();d.storage.close();
});
it('pause at midnight after ready callback still supersedes old batch',async()=>{
 const {d,step,batch}=asyncFixture();let finish!:(v:any)=>void;d.generateEnvironment=async()=>new Promise(resolve=>finish=resolve);const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);
 d.clock.advance(86400000);d.storage.set('runtime',{...d.storage.runtime(),paused:true});finish({stage:'world',changes:[]});await p.wait();p.reconcile(d.clock.now());expect(d.environmentStore.batch(batch.id)?.status).toBe('superseded');await p.stop();d.storage.close();
});
it('timezone switch and return never reopen terminal identity and do not publish late errors',async()=>{
 const {d,step,batch}=asyncFixture();let reject!:(e:any)=>void;d.generateEnvironment=async()=>new Promise((_,fail)=>reject=fail);const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);
 d.config.timezone='UTC';p.reconcile(NOW);expect(d.environmentStore.batch(batch.id)?.status).toBe('superseded');reject(Error('late error'));await p.wait();expect(p.takeError()).toBeUndefined();
 d.config.timezone='Asia/Shanghai';ensureEnvironmentBatch(d.storage,d.config,NOW);expect(d.environmentStore.batch(batch.id)?.status).toBe('superseded');await p.stop();d.storage.close();
});
