import {it,expect,vi,afterEach} from 'vitest';
import {modern} from './chat-fixture';
import {HdsiApp} from '../src/app';
import {InputBuffer} from '../src/host/input';
import {Scheduler} from '../src/host/scheduler';
import {SerialHost} from '../src/host/runtime';
import {schoolItem,expand} from './world-school-fixture';
import {narrative} from './helpers';
afterEach(()=>vi.useRealTimers());
async function waiting(){const d=modern(),input=new InputBuffer(d.storage),s=new Scheduler(d.storage);await input.acceptInput({id:'a',content:'old',receivedAt:d.clock.now()});d.clock.advance(15000);const request=(await s.collectReady(d.clock.now()))!;await input.acceptInput({id:'b',content:'new',receivedAt:d.clock.now()});const app=new HdsiApp(d);await app.runTurn(request);return {d,app,input,s,id:d.storage.unfinishedTurn()!.id};}
it('waiting_timer_rearms_on_new_input_without_models',async()=>{
 vi.useFakeTimers();const {d,app,id}=await waiting(),h=new SerialHost(app);await h.start();expect(await h.status()).toContain('等待新消息合批');d.clock.advance(10000);await vi.advanceTimersByTimeAsync(10000);await h.acceptInput({id:'c',content:'latest',receivedAt:d.clock.now()});await h.wake();d.clock.advance(5000);await vi.advanceTimersByTimeAsync(5000);expect(d.models.calls).toEqual([]);d.clock.advance(9999);await vi.advanceTimersByTimeAsync(9999);expect(d.models.calls).toEqual([]);d.clock.advance(1);await vi.advanceTimersByTimeAsync(1);await h.wake();expect(d.models.calls.map(c=>c.name)).toEqual(['narrative','personal_chat','memory']);expect(d.storage.read('turns',id)!.replyFreshness).toMatchObject({generation:2,state:'sealed'});await h.stop();d.storage.close();
});
it('waiting_yields_to_appointment_without_consuming_chat',async()=>{
 const {d,app,id}=await waiting();d.storage.save('tasks','check',{id:'check',kind:'check_messages',checkReason:'unread',at:d.clock.now(),description:'check',status:'pending'});d.storage.save('tasks','event',{id:'event',kind:'appointment',at:d.clock.now(),description:'event',status:'pending'});const h=new SerialHost(app,{timers:false});await h.start();const t=d.storage.read('turns',id)!;expect(t).toMatchObject({inputMessageIds:[],batchIds:[],triggerTaskIds:['event'],done:true,replyFreshness:{scope:'event',generation:2}});expect(d.storage.read('messages','a')!.seenTurnId).toBeNull();expect(d.storage.read('tasks','check')!.status).toBe('pending');d.clock.advance(15000);await h.wake();expect(d.storage.read('messages','a')!.seenTurnId).not.toBeNull();expect(d.storage.read('tasks','event')!.status).toBe('completed');await h.stop();d.storage.close();
});
it('waiting_crosses_sleep_and_wake_preserves_stashed_inputs',async()=>{
 const {d,app,id}=await waiting();const start=d.clock.now(),wake=new Date(Date.parse(start)+60000).toISOString();d.storage.set('character',{...d.storage.character(),sleep:{sleepAt:start,wakeAt:wake}});const h=new SerialHost(app,{timers:false});await h.start();expect(d.models.calls).toEqual([]);expect(d.storage.runtime().pendingBatchIds).toEqual([]);d.clock.advance(60000);await h.wake();expect(d.storage.read('turns',id)!.replyFreshness?.scope).toBe('event');expect(d.storage.read('messages','a')!.seenTurnId).not.toBeNull();expect(d.storage.read('messages','b')!.seenTurnId).not.toBeNull();await h.stop();d.storage.close();
});
it('event_makes_phone_unreadable_then_end_restores_inputs',async()=>{
 const {d,app,id}=await waiting();const end=new Date(Date.parse(d.clock.now())+60000).toISOString();d.storage.save('tasks','event',{id:'event',kind:'appointment',at:d.clock.now(),description:'swim',status:'pending'});d.models.outputs.narrative={...narrative,currentScene:{description:'swim',activity:{description:'swim',startsAt:d.clock.now(),expectedEndAt:end,phoneAccess:false}}};const h=new SerialHost(app,{timers:false});await h.start();expect(d.storage.read('turns',id)!.done).toBe(true);expect(d.storage.read('messages','a')!.seenTurnId).toBeNull();d.clock.advance(15000);await h.wake();expect(d.models.calls.filter(c=>c.name==='personal_chat')).toHaveLength(1);expect(Date.parse((await new Scheduler(d.storage).nextDeadline(d.clock.now()))!)).toBe(Date.parse(end));d.clock.time=end;d.models.outputs.narrative=narrative;await h.wake();expect(d.storage.read('messages','a')!.seenTurnId).not.toBeNull();await h.stop();d.storage.close();
});

it('waiting_yields_to_school_notice_and_does_not_consume_check',async()=>{
 const {d,app,id}=await waiting();d.storage.save('school_plan_items','meeting',schoolItem());expand(d);d.storage.save('tasks','check',{id:'check',kind:'check_messages',checkReason:'unread',at:d.clock.now(),description:'check',status:'pending'});
 const h=new SerialHost(app,{timers:false});await h.start();expect(d.storage.read('turns',id)!).toMatchObject({done:true,inputMessageIds:[],batchIds:[],triggerTaskIds:[],triggerKinds:['school_notification'],replyFreshness:{scope:'event',generation:2}});expect(d.storage.read('turns',id)!.schoolNoticeRefs).toHaveLength(1);expect(d.storage.read('tasks','check')!.status).toBe('pending');expect(d.storage.read('messages','a')!.seenTurnId).toBeNull();await h.stop();d.storage.close();
});
it('waiting_trace_records_selection_rebind_and_stages_without_bodies',async()=>{
 const {d,app,id}=await waiting();d.clock.advance(15000);const h=new SerialHost(app,{timers:false});await h.start();const t=d.storage.read('turns',id)!;expect(t.replyTrace?.map(e=>e.event)).toEqual(expect.arrayContaining(['selected','waiting','rebound','stage_completed']));expect(t.replyTrace?.find(e=>e.stage==='personal_chat')?.elapsedMs).toBeTypeOf('number');expect(JSON.stringify(t.replyTrace)).not.toContain('latest');await h.stop();d.storage.close();
});
