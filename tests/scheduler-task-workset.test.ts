import {it,expect,vi} from 'vitest';
import {Scheduler} from '../src/host/scheduler';
import {HdsiApp} from '../src/app';
import {SerialHost} from '../src/host/runtime';
import {InputBuffer} from '../src/host/input';
import {environmentInput} from '../src/environment/runtime';
import {environmentBusinessBasis} from '../src/environment/snapshot';
import {asyncFixture} from './environment-async-fixture';
import {setup,saveInput,NOW,fixtureModelInput} from './helpers';
import {modern} from './chat-fixture';
import {makeSharedFixture} from './shared-v3-fixture';
import {schoolItem,expand} from './world-school-fixture';
const later='2026-10-07T03:00:00Z',earlier='2026-10-07T10:00:00+08:00';
function history(d:ReturnType<typeof setup>,n:number){d.storage.transaction(()=>{for(let i=0;i<n;i++)d.storage.save('tasks','h'+i,{id:'h'+i,kind:'appointment',at:NOW,description:'past',status:i%2?'completed':'cancelled'});});}
function budget(d:ReturnType<typeof setup>){return {all:vi.spyOn(d.storage,'all'),pending:vi.spyOn(d.storage,'pendingTasks')};}
function bounded(spies:ReturnType<typeof budget>,limit=1){expect(spies.all.mock.calls.filter(c=>c[0]==='tasks')).toHaveLength(0);expect(spies.pending.mock.calls.length).toBeLessThanOrEqual(limit);}
for(const h of [0,1000,10000])for(const p of [0,3])it(`idle H=${h} P=${p} only materializes pending once per public evaluation`,async()=>{
 const d=setup();try{history(d,h);for(let i=0;i<p;i++)d.storage.save('tasks','p'+i,{id:'p'+i,kind:'appointment',at:later,description:'future',status:'pending'});
 const s=new Scheduler(d.storage),spies=budget(d);
 expect(await s.collectReady(NOW)).toBeNull();bounded(spies);expect(spies.pending.mock.results.flatMap(r=>r.value??[])).toHaveLength(p);
 spies.pending.mockClear();spies.all.mockClear();expect(Date.parse((await s.nextDeadline(NOW))!)).toBe(Date.parse(p?later:d.storage.runtime().nextEnvironmentAt!));bounded(spies);expect(spies.pending.mock.results.flatMap(r=>r.value??[])).toHaveLength(p);
 }finally{d.storage.close();}
});
it('deadline and due selection compare epochs and preserve ties in insertion order',async()=>{
 const d=setup();try{for(const [id,at] of [['future',later],['offset',earlier],['utc','2026-10-07T02:00:00Z']])d.storage.save('tasks',id,{id,kind:'appointment',at,description:id,status:'pending'});
 const s=new Scheduler(d.storage),spies=budget(d);expect(await s.collectReady(NOW)).toMatchObject({taskIds:['offset','utc'],triggerKinds:['appointment']});bounded(spies);
 spies.pending.mockClear();expect(Date.parse((await s.nextDeadline('2026-10-07T01:59:59Z'))!)).toBe(Date.parse(earlier));bounded(spies);
 }finally{d.storage.close();}
});
it('input and sleep keep foreground priority and task history is never read',async()=>{
 const d=setup();try{saveInput(d.storage,'a','hello');d.storage.set('character',{...d.storage.character(),nextAutonomousAt:NOW});const s=new Scheduler(d.storage),spies=budget(d);
 expect(await s.collectReady(NOW)).toMatchObject({inputMessageIds:['a'],triggerKinds:['input']});bounded(spies);
 d.storage.set('character',{...d.storage.character(),sleep:{sleepAt:NOW,wakeAt:later}});spies.pending.mockClear();expect(await s.collectReady(NOW)).toBeNull();bounded(spies);
 expect(Date.parse((await s.nextDeadline(NOW))!)).toBe(Date.parse(later));
 }finally{d.storage.close();}
});
it('stash write invalidates its evaluation and subsequent deadlines see the new check',async()=>{
 const d=setup();try{saveInput(d.storage,'a','hello');d.storage.set('runtime',{...d.storage.runtime(),pendingBatchIds:['batch-a']});d.storage.set('character',{...d.storage.character(),scene:{...d.storage.character().scene,activity:{description:'bath',startsAt:NOW,expectedEndAt:later,phoneAccess:false}}});
 const s=new Scheduler(d.storage),spies=budget(d);expect(await s.collectReady(NOW)).toBeNull();bounded(spies,2);expect(d.storage.pendingTasks()).toMatchObject([{kind:'check_messages',at:later,messageIds:['a']}]);
 spies.pending.mockClear();expect(Date.parse((await s.nextDeadline(NOW))!)).toBe(Date.parse(later));bounded(spies);
 }finally{d.storage.close();}
});
it('shared refresh replaces stale scenes once and the evaluation sees the replacement',async()=>{
 const d=setup();try{makeSharedFixture(d);d.storage.save('tasks','scene:activity-a',{id:'scene:activity-a',kind:'scene_step',at:NOW,description:'stale',status:'pending'});
 const save=vi.spyOn(d.storage,'save'),spies=budget(d),s=new Scheduler(d.storage);
 expect(await s.collectReady(NOW)).toBeNull();expect(save.mock.calls.filter(c=>c[0]==='tasks')).toHaveLength(1);bounded(spies,2);
 expect(d.storage.read('tasks','scene:activity-a')!.at).toBe('2026-10-07T02:01:00.000Z');
 spies.pending.mockClear();save.mockClear();expect(Date.parse((await s.nextDeadline(NOW))!)).toBe(Date.parse('2026-10-07T02:01:00Z'));expect(save.mock.calls.filter(c=>c[0]==='tasks')).toHaveLength(1);bounded(spies,2);
 }finally{d.storage.close();}
});
async function waiting(){const d=modern(),b=new InputBuffer(d.storage),s=new Scheduler(d.storage);await b.acceptInput({id:'a',content:'old',receivedAt:NOW});d.clock.advance(15000);const request=(await s.collectReady(d.clock.now()))!;await b.acceptInput({id:'b',content:'new',receivedAt:d.clock.now()});await new HdsiApp(d).runTurn(request);return {d,s,id:d.storage.unfinishedTurn()!.id};}
it('quiet waiting reuses tasks and a write between public calls is visible',async()=>{
 const {d,s,id}=await waiting();try{const spies=budget(d);expect(await s.collectWaitingContinuation(id,d.clock.now())).toEqual({kind:'wait',deadline:'2026-10-07T02:00:30.000Z'});bounded(spies);
 d.storage.save('tasks','event',{id:'event',kind:'appointment',at:d.clock.now(),description:'event',status:'pending'});spies.pending.mockClear();expect(await s.collectWaitingContinuation(id,d.clock.now())).toMatchObject({kind:'run',scope:'event',request:{taskIds:['event'],inputMessageIds:[]}});bounded(spies);
 }finally{d.storage.close();}
});
it('waiting events-only evaluation does not refresh a shared clock early',async()=>{
 const {d,s,id}=await waiting();try{makeSharedFixture(d);const save=vi.spyOn(d.storage,'save'),spies=budget(d);expect(await s.collectWaitingContinuation(id,d.clock.now())).toEqual({kind:'wait',deadline:'2026-10-07T02:00:30.000Z'});expect(save.mock.calls.filter(c=>c[0]==='tasks')).toHaveLength(0);bounded(spies);
 }finally{d.storage.close();}
});
it('school notice and true Host dispatch preserve notification selection',async()=>{
 const d=setup();try{d.storage.save('school_plan_items','meeting',schoolItem());expand(d);history(d,1000);const s=new Scheduler(d.storage),spies=budget(d);expect(await s.collectReady(NOW)).toMatchObject({taskIds:[],triggerKinds:['school_notification'],schoolNoticeRefs:[{noticeId:expect.any(String)}]});bounded(spies);
 const host=new SerialHost(new HdsiApp(d),{timers:false});await host.start();await host.stop();expect(d.storage.all('turns').some(t=>t.triggerKinds.includes('school_notification'))).toBe(true);expect(spies.all.mock.calls.filter(c=>c[0]==='tasks')).toHaveLength(0);
 }finally{d.storage.close();}
});
it('stash invalidation makes a reused internal evaluation observe the new check',()=>{
 const d=setup();try{saveInput(d.storage,'a','hello');d.storage.set('character',{...d.storage.character(),scene:{...d.storage.character().scene,activity:{description:'bath',startsAt:NOW,expectedEndAt:later,phoneAccess:false}}});const s=new Scheduler(d.storage),spies=budget(d),evaluation=(s as any).taskEvaluation();expect(evaluation.pending()).toEqual([]);(s as any).stashPending(NOW,evaluation);expect(evaluation.pending()).toMatchObject([{kind:'check_messages',at:later,messageIds:['a']}]);bounded(spies,2);expect(spies.pending).toHaveBeenCalledTimes(2);
 }finally{d.storage.close();}
});
it('waiting event read is invalidated when ordinary shared selection refreshes its scene',async()=>{
 const {d,s,id}=await waiting();try{d.clock.advance(15000);makeSharedFixture(d);d.storage.save('tasks','scene:activity-a',{id:'scene:activity-a',kind:'scene_step',at:later,description:'stale',status:'pending'});const spies=budget(d),save=vi.spyOn(d.storage,'save');await s.collectWaitingContinuation(id,d.clock.now());expect(spies.pending.mock.results.map(r=>r.value[0].at)).toEqual([later,'2026-10-07T02:01:00.000Z']);expect(save.mock.calls.filter(c=>c[0]==='tasks')).toHaveLength(1);bounded(spies,2);
 }finally{d.storage.close();}
});
it('personal director receives all pending future appointments',async()=>{
 const d=setup();try{saveInput(d.storage,'a','hello');history(d,1000);d.storage.save('tasks','future',{id:'future',kind:'appointment',at:later,description:'future',status:'pending'});const spies=budget(d);await new HdsiApp(d).runTurn({inputMessageIds:['a'],taskIds:[],triggerKinds:['input']});expect(fixtureModelInput(d.models.calls.find(c=>c.name==='personal_chat')!.input).tasks.map((t:any)=>t.id)).toEqual(['future']);expect(spies.all.mock.calls.filter(c=>c[0]==='tasks')).toHaveLength(0);
 }finally{d.storage.close();}
});
it('week input remains frozen while business basis independently detects appointment changes',()=>{
 const {d,step}=asyncFixture('school_week');try{history(d,1000);d.storage.save('tasks','future',{id:'future',kind:'appointment',at:later,description:'future',status:'pending'});const spies=budget(d),input=environmentInput(d,step),basis=environmentBusinessBasis(d,'school_week');d.storage.save('tasks','future',{...d.storage.read('tasks','future')!,at:'2026-10-07T04:00:00Z'});expect((input.context as any).appointments[0].at).toBe(later);expect(environmentBusinessBasis(d,'school_week')).not.toBe(basis);bounded(spies,3);expect(spies.pending).toHaveBeenCalledTimes(3);
 }finally{d.storage.close();}
});
