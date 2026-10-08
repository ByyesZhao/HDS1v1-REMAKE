import {expect,it} from 'vitest';
import {fixture,at} from './memory-capacity-fixture';
import {MemoryIdle} from '../src/memory/idle';
import {InputBuffer} from '../src/host/input';
import {HdsiApp} from '../src/app';
const minute=(n:number)=>new Date(Date.parse(at)+n*60000).toISOString();
it('same_id_duplicate_not_new_idle',async()=>{
 const d=fixture(),idle=new MemoryIdle(d.storage,15,true),input=new InputBuffer(d.storage,idle);
 await input.acceptInput({id:'same',content:'你好',receivedAt:at});const runtime=d.storage.runtime();
 await input.acceptInput({id:'same',content:'重复投递',receivedAt:minute(10)});expect(d.storage.runtime()).toEqual(runtime);expect(d.storage.read('messages','same')?.content).toBe('你好');
 await input.acceptInput({id:'advance',content:'【推进】',receivedAt:minute(11)});expect(d.storage.runtime().memoryIdle?.lastInputAt).toBe(minute(11));
});
it('restart_preserves_ready_at and real silent story refreshes',async()=>{
 const d=fixture(),idle=new MemoryIdle(d.storage,15,true);idle.record('story',at);d.clock.time=minute(16);
 const restarted=new MemoryIdle(d.storage,15,true);expect(restarted.eligibility(d.clock.now()).allowed).toBe(true);
 await new HdsiApp({...d,memoryIdle:restarted}).runTurn({inputMessageIds:[],taskIds:[],triggerKinds:['autonomous']});
 expect(restarted.eligibility(minute(17))).toMatchObject({allowed:false,readyAt:minute(31)});
});
it('environment_and_maintenance_do_not_refresh',()=>{
 const d=fixture(),idle=new MemoryIdle(d.storage,15,true);idle.record('story',at);const before=d.storage.runtime().memoryIdle;
 d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:minute(3),nextMaintenanceAt:minute(5)});
 expect(d.storage.runtime().memoryIdle).toEqual(before);expect(idle.eligibility(minute(16)).allowed).toBe(true);
});
