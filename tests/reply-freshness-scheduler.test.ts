import {it,expect} from 'vitest';
import {modern} from './chat-fixture';
import {Scheduler} from '../src/host/scheduler';
import {InputBuffer} from '../src/host/input';
import {saveInput} from './helpers';
it('ordinary_14999_waits_15000_selects_all',async()=>{
 const d=modern(),b=new InputBuffer(d.storage),s=new Scheduler(d.storage);
 await b.acceptInput({id:'a',content:'old',receivedAt:d.clock.now()});d.clock.advance(15000);b.closeReady(d.clock.now());
 await b.acceptInput({id:'b',content:'new',receivedAt:d.clock.now()});
 expect(await s.collectReady(d.clock.now())).toBeNull();expect(await s.nextDeadline(d.clock.now())).toBe(d.storage.runtime().openBatch!.readyAt);
 d.clock.advance(14999);expect(await s.collectReady(d.clock.now())).toBeNull();d.clock.advance(1);
 const r=await s.collectReady(d.clock.now());expect(r!.inputMessageIds).toEqual(['a','b']);expect(r!.batchIds).toHaveLength(2);expect(r).toHaveProperty('replyInputRevision',2);d.storage.close();
});
it('duplicate_control_do_not_advance_revision',async()=>{
 const d=modern(),b=new InputBuffer(d.storage),m={id:'a',content:'hello',receivedAt:d.clock.now()};await b.acceptInput(m);d.clock.advance(1000);await b.acceptInput({...m,receivedAt:d.clock.now()});
 await b.acceptInput({id:'ctrl',content:'【推进】',receivedAt:d.clock.now()});expect(d.storage.runtime()).toHaveProperty('ordinaryInputRevision',1);d.storage.close();
});
it('stashed_unread_is_selected_when_readable',async()=>{
 const d=modern();saveInput(d.storage,'a','hello');d.storage.set('runtime',{...d.storage.runtime(),pendingBatchIds:[]});
 const r=await new Scheduler(d.storage).collectReady(d.clock.now());expect(r!.inputMessageIds).toEqual(['a']);expect(r).toHaveProperty('replyInputRevision',0);d.storage.close();
});
it('open_batch_defers_due_check_without_blocking_appointment',async()=>{
 const d=modern(),b=new InputBuffer(d.storage),s=new Scheduler(d.storage);await b.acceptInput({id:'a',content:'hello',receivedAt:d.clock.now()});
 d.storage.save('tasks','check',{id:'check',kind:'check_messages',checkReason:'unread',at:d.clock.now(),description:'check',status:'pending'});
 expect(await s.collectReady(d.clock.now())).toBeNull();
 d.storage.save('tasks','event',{id:'event',kind:'appointment',at:d.clock.now(),description:'event',status:'pending'});
 const r=await s.collectReady(d.clock.now());expect(r!.triggerKinds).toEqual(['appointment']);expect(r!.inputMessageIds).toEqual([]);expect(r!.taskIds).toEqual(['event']);d.storage.close();
});
