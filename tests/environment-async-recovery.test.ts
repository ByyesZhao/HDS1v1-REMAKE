import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {setup,NOW} from './helpers';
import {Storage} from '../src/storage';import {EnvironmentStore} from '../src/environment/store';import {SchoolStore} from '../src/school/store';
import {EnvironmentPreparation} from '../src/environment/preparation';
import {ensureEnvironmentBatch,selectEnvironmentStep,environmentDeadline} from '../src/environment/scheduler';
import {WebSearchStore} from '../src/web/store';import {WebSearchService} from '../src/web/service';
import {ModelClient,ModelRequestError,ModelFormatError} from '../src/model/client';
import {generateEnvironmentStep} from '../src/directors/school';
import {schoolItem,expand} from './world-school-fixture';
import {MemoryStore} from '../src/memory/store';import {MemoryRetrieval} from '../src/memory/retrieval';
import {setImmediate} from 'node:timers/promises';
import {asyncFixture} from './environment-async-fixture';
import {digest} from '../src/environment/digest';
const event={kind:'world' as const,description:'公共事件',startsAt:NOW,endsAt:null,basis:'fiction' as const,sourceUrls:[]};
it('ready file reopen preserves creation ID and never regenerates',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-e4-')),file=join(dir,'test.sqlite');
 try{
 const {d,step}=asyncFixture('world',new Storage(file));d.generateEnvironment=async()=>({stage:'world',changes:[{action:'create',event}]});
 const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);await p.wait();const result=d.environmentStore.step(step.id)!.frozenResult;await p.stop();d.storage.close();
 const reopened=new Storage(file),base=setup();base.storage.close();
 const next={...base,storage:reopened,environmentStore:new EnvironmentStore(reopened),schoolStore:new SchoolStore(reopened),web:new WebSearchService(new WebSearchStore(reopened),undefined,base.clock,{enabled:false}),generateEnvironment:vi.fn()};
 const resumed=new EnvironmentPreparation(next);expect(reopened.read('environment_steps',step.id)).toMatchObject({status:'ready',frozenResult:result,preparationSnapshot:expect.any(Object)});expect(resumed.applyReady(step.id,NOW)).toBe('applied');expect(resumed.applyReady(step.id,NOW)).toBe('none');
 expect(next.generateEnvironment).not.toHaveBeenCalled();expect(reopened.read('environment_steps',step.id)).toMatchObject({inputSnapshot:null,preparationSnapshot:null,frozenResult:null,terminalAudit:{basis:{resultDigest:digest(result)}}});expect(reopened.all('events')).toHaveLength(1);expect(reopened.all('events')[0].id).toBe((result as any).changes[0].id);await resumed.stop();reopened.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('new research progress invalidates group then refreezes after retry with same web identity',async()=>{
 const {d,step}=asyncFixture('school_group');d.generateEnvironment=async()=>({stage:'school_group',planChanges:[],itemChanges:[]});
 const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);await p.wait();
 const ref=d.web.store.openStage('environment',step.id,'generation',step.stage);
 d.storage.save('school_progress','new',{id:'new',taskId:'r',kind:'feedback',experienceId:'e',turnId:'t',happenedAt:NOW,summary:'导师反馈'});
 expect(p.applyReady(step.id,NOW)).toBe('stale');expect(d.environmentStore.step(step.id)).toMatchObject({status:'pending',preparationGeneration:2});
 expect(p.startOne(step.id,NOW)).toBe(false);d.clock.advance(d.config.environmentRetryMs);p.startOne(step.id,d.clock.now());await p.wait();
 expect((d.environmentStore.step(step.id)!.inputSnapshot!.context as any).progress[0].summary).toBe('导师反馈');
 expect(d.web.store.openStage('environment',step.id,'generation',step.stage).runId).toBe(ref.runId);expect(p.applyReady(step.id,d.clock.now())).toBe('applied');await p.stop();d.storage.close();
});
it.each([ModelRequestError,ModelFormatError])('failure retries same snapshot without pausing: %s',async ErrorType=>{
 const {d,step}=asyncFixture();let first=true;d.generateEnvironment=async()=>{if(first){first=false;throw new ErrorType('fixture');}return {stage:'world',changes:[]};};
 const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);await p.wait();const old=d.environmentStore.step(step.id)!;expect(old.status).toBe('pending');expect(d.storage.runtime().paused).toBe(false);
 d.clock.advance(d.config.environmentRetryMs);p.startOne(step.id,d.clock.now());await p.wait();expect(d.environmentStore.step(step.id)).toMatchObject({attempt:2,preparationGeneration:old.preparationGeneration,inputSnapshot:old.inputSnapshot});await p.stop();d.storage.close();
});
it('stop waits for noncooperative transport and discards late result; resume preserves attempt',async()=>{
 const {d,step}=asyncFixture();let finish!:(v:any)=>void,signal:AbortSignal|undefined;
 d.generateEnvironment=async(input,execution)=>{signal=execution?.signal;return new Promise(resolve=>finish=resolve);};
 const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);const stopping=p.stop();expect(signal?.aborted).toBe(true);let stopped=false;void stopping.then(()=>stopped=true);await setImmediate();expect(stopped).toBe(false);
 finish({stage:'world',changes:[{action:'create',event}]});await stopping;expect(d.environmentStore.step(step.id)).toMatchObject({status:'running',attempt:1});expect(d.storage.all('events')).toEqual([]);
 d.generateEnvironment=async()=>({stage:'world',changes:[]});const next=new EnvironmentPreparation(d);next.startOne(step.id,NOW);await next.wait();expect(d.environmentStore.step(step.id)).toMatchObject({status:'ready',attempt:1});await next.stop();d.storage.close();
});
it('midnight cancels while paused; late result never revives terminal; in-flight has no now deadline',async()=>{
 const {d,step,batch}=asyncFixture();let finish!:(v:any)=>void;d.generateEnvironment=async()=>new Promise(resolve=>finish=resolve);
 const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);expect(environmentDeadline(d.storage,NOW,{environmentInFlightStepId:step.id})).not.toBe(NOW);
 d.storage.set('runtime',{...d.storage.runtime(),paused:true});d.clock.advance(86400000);p.reconcile(d.clock.now());expect(d.environmentStore.batch(batch.id)?.status).toBe('superseded');
 finish({stage:'world',changes:[]});await p.wait();expect(d.environmentStore.step(step.id)?.status).toBe('superseded');expect(d.storage.runtime().paused).toBe(true);await p.stop();d.storage.close();
});
it('pending lookup resumes and atomically persists result plus basis; stale reprojects same query',async()=>{
 const {d,step}=asyncFixture();const store=new MemoryStore(d.storage);store.migrate(NOW);
 const owner=store.makeOwner({ownerType:'detail',ownerId:'phone'},{key:'phone',value:'A',aliases:['手机'],content:'手机A',sourceIds:[]},NOW);store.saveOwner(owner);
 const dep={...d,memoryStore:store,retrieval:new MemoryRetrieval(store)};let calls=0;
 const client=new ModelClient({complete:async request=>{calls++;if(!request.lookupResult)return {lookupDetails:'手机'};return {changes:[]};}});
 dep.models=client as any;dep.generateEnvironment=(input,options)=>generateEnvironmentStep(dep,input,options);
 const ref=d.web.store.openStage('environment',step.id,'generation',step.stage);
 d.web.store.saveCheckpoint(ref.runId,{formatVersion:2,input:{},repairCount:1,lookupUsed:true,lookupPending:true,lookupRequest:'手机',pendingOperationId:null,toolResults:[]});
 const p=new EnvironmentPreparation(dep);p.startOne(step.id,NOW);await p.wait();
 expect(calls).toBe(1);expect(d.web.store.snapshot(ref.runId).checkpoint).toMatchObject({lookupPending:false});expect(d.environmentStore.step(step.id)?.preparationSnapshot?.usedBasis?.owners[0].ownerId).toBe('phone');
 store.saveOwner({...owner,value:'B',content:'手机B',revision:2});expect(p.applyReady(step.id,NOW)).toBe('stale');
 expect(d.web.store.snapshot(ref.runId).checkpoint).toMatchObject({lookupUsed:true,lookupPending:true,lookupRequest:'手机'});
 d.clock.advance(d.config.environmentRetryMs);p.startOne(step.id,d.clock.now());await p.wait();expect(calls).toBe(2);
 expect((d.web.store.snapshot(ref.runId).checkpoint!.privateLookupResult as any).details[0].value).toBe('B');
 expect(p.applyReady(step.id,d.clock.now())).toBe('applied');await p.stop();d.storage.close();
});
it('notice lifecycle alone keeps read history; appointment membership invalidates week',async()=>{
 const {d,step}=asyncFixture('school_week');d.storage.save('school_plan_items','meeting',schoolItem());expand(d);
 const notice=d.schoolStore.notices()[0];d.generateEnvironment=async input=>({stage:'school_week',noticeTexts:(input.context as any).requiredNoticeKeys.map((n:any)=>({key:n.id,text:'通知'})),weekNotes:[]});
 const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);await p.wait();d.storage.save('school_notices',notice.id,{...notice,status:'read',readAt:NOW,readTurnId:'t',releasedAt:NOW,nextWakeAt:null});
 expect(p.applyReady(step.id,NOW)).toBe('applied');expect(d.storage.read('school_notices',notice.id)?.status).toBe('read');await p.stop();d.storage.close();
 const other=asyncFixture('school_week');other.d.generateEnvironment=async()=>({stage:'school_week',noticeTexts:[],weekNotes:[]});const next=new EnvironmentPreparation(other.d);next.startOne(other.step.id,NOW);await next.wait();
 other.d.storage.save('tasks','a',{id:'a',kind:'appointment',at:NOW,description:'游戏',status:'pending'});expect(next.applyReady(other.step.id,NOW)).toBe('stale');await next.stop();other.d.storage.close();
});
