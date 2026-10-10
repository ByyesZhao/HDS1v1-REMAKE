import {it,expect} from 'vitest';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {modern} from './chat-fixture';
import {NOW,narrative} from './helpers';
import {InputBuffer} from '../src/host/input';
import {Scheduler} from '../src/host/scheduler';
import {HdsiApp} from '../src/app';
const filename=resolve('docs/v0.5/records/phone-access-20261010/repair-state.cjs');
const repair:((s:any,o:any)=>any)=existsSync(filename)?createRequire(filename)(filename).repairKnownPhoneAccess:()=>({status:'not_implemented'});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const expectedActivity={startsAt:NOW,descriptionHash:hash('文献整理')};
function scene(d:ReturnType<typeof modern>){const c=d.storage.character();c.scene.activity={description:'文献整理',startsAt:NOW,expectedEndAt:null,phoneAccess:false};d.storage.set('character',c);}
const options={at:NOW,stopped:true,expectedActivity,apply:true};
it('stopped known-state repair only changes access and schedules ordinary unread in the same transaction',async()=>{
 const d=modern();try{scene(d);const buffer=new InputBuffer(d.storage);for(const id of ['a','b','c'])await buffer.acceptInput({id,content:id,receivedAt:NOW});d.clock.advance(15000);buffer.closeReady(d.clock.now());
 const old=d.storage.character(),messages=d.storage.messages();const result=repair(d.storage,{...options,at:d.clock.now()});
 expect(result.status).toBe('applied');expect(d.storage.character()).toEqual({...old,scene:{...old.scene,activity:{...old.scene.activity!,phoneAccess:true}}});expect(d.storage.messages()).toEqual(messages);
 const checks=d.storage.all('tasks');expect(checks).toHaveLength(1);expect(checks[0]).toMatchObject({kind:'check_messages',checkReason:'unread',messageIds:['a','b','c'],status:'pending'});
 expect(Date.parse(checks[0].at)).toBe(Date.parse(d.clock.now())+1000);d.clock.advance(1000);d.models.outputs.narrative=narrative;await new HdsiApp(d).runTurn((await new Scheduler(d.storage).collectReady(d.clock.now()))!);
 expect(d.models.calls.some(c=>c.name==='personal_chat')).toBe(true);expect(d.storage.messages().every(m=>m.seenTurnId!==null)).toBe(true);
 }finally{d.storage.close();}
});
it('repair reuses existing pending unread check and excludes open batches and activity-only input',async()=>{
 const d=modern();try{scene(d);const buffer=new InputBuffer(d.storage);await buffer.acceptInput({id:'old',content:'旧普通消息',receivedAt:NOW});d.clock.advance(15000);buffer.closeReady(d.clock.now());
 const m=d.storage.read('messages','old')!;d.storage.save('messages','shared',{...m,id:'shared',batchId:null,sharedActivityId:'ended-activity',chatEpisodeId:null});await buffer.acceptInput({id:'open',content:'开放批次',receivedAt:d.clock.now()});
 d.storage.save('tasks','existing',{id:'existing',kind:'check_messages',checkReason:'unread',at:'2026-10-07T11:00:00+08:00',description:'旧检查',messageIds:['old'],status:'pending'});
 expect(repair(d.storage,{...options,at:d.clock.now()}).status).toBe('applied');expect(d.storage.all('tasks')).toHaveLength(1);expect(d.storage.read('tasks','existing')!.messageIds).toEqual(['old']);
 expect(d.storage.read('messages','open')!.seenTurnId).toBeNull();expect(d.storage.read('messages','shared')!.seenTurnId).toBeNull();
 }finally{d.storage.close();}
});
it('read-only inspection and already-readable states do not write',()=>{
 const d=modern();try{scene(d);const before=d.storage.character();expect(repair(d.storage,{...options,apply:false,stopped:false}).status).toBe('eligible');expect(d.storage.character()).toEqual(before);expect(d.storage.all('tasks')).toEqual([]);
 const c=d.storage.character();c.scene.activity!.phoneAccess=true;d.storage.set('character',c);expect(repair(d.storage,options).status).toBe('unchanged');expect(d.storage.all('tasks')).toEqual([]);
 }finally{d.storage.close();}
});
it('does not apply to a changed scene or a finite restriction',()=>{
 const d=modern();try{scene(d);expect(repair(d.storage,{...options,expectedActivity:{...expectedActivity,descriptionHash:hash('其他场景')}}).status).toBe('scene_changed');expect(d.storage.character().scene.activity!.phoneAccess).toBe(false);
 const c=d.storage.character();c.scene.activity!.expectedEndAt='2026-10-07T10:30:00+08:00';d.storage.set('character',c);expect(repair(d.storage,options).status).toBe('unchanged');
 }finally{d.storage.close();}
});
it('cannot repair without declared stop or while a turn is unfinished',()=>{
 const d=modern();try{scene(d);expect(()=>repair(d.storage,{...options,stopped:false})).toThrow(/stopped/);
 d.storage.save('turns','pending',{id:'pending',at:NOW,completedAt:null,done:false,outputComplete:false,frozenResult:null,inputMessageIds:[],triggerTaskIds:[],triggerKinds:['input'],batchIds:[],entryMode:'chat'});
 expect(repair(d.storage,options).status).toBe('unfinished_turn');expect(d.storage.character().scene.activity!.phoneAccess).toBe(false);expect(d.storage.all('tasks')).toEqual([]);
 }finally{d.storage.close();}
});
it('rolls back access change if scheduling the unread check fails',async()=>{
 const d=modern();try{scene(d);const buffer=new InputBuffer(d.storage);await buffer.acceptInput({id:'a',content:'未读',receivedAt:NOW});d.clock.advance(15000);buffer.closeReady(d.clock.now());
 d.storage.prepare("CREATE TRIGGER reject_phone_check BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'check task failed'); END").run();
 expect(()=>repair(d.storage,{...options,at:d.clock.now()})).toThrow('check task failed');expect(d.storage.character().scene.activity!.phoneAccess).toBe(false);expect(d.storage.read('messages','a')!.seenTurnId).toBeNull();
 }finally{d.storage.close();}
});
