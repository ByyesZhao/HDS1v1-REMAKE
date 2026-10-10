import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {HdsiApp} from '../src/app';
import {InputBuffer} from '../src/host/input';
import {Scheduler} from '../src/host/scheduler';
import {Storage} from '../src/storage';
import {EnvironmentStore} from '../src/environment/store';
import {SchoolStore} from '../src/school/store';
import {initialCharacter} from '../src/config';
import {modern} from './chat-fixture';
import {NOW,narrative} from './helpers';
import {makeSharedFixture,configureSharedModels} from './shared-v3-fixture';
const END='2026-10-07T10:15:00+08:00',LATER='2026-10-07T10:30:00+08:00';
const activity=(description:string,phoneAccess:boolean,expectedEndAt:string|null)=>({...narrative,currentScene:{description,activity:{description,startsAt:NOW,phoneAccess,expectedEndAt}}});
async function input(d:ReturnType<typeof modern>,id='a',content='忙的话晚点聊'){
 await new InputBuffer(d.storage).acceptInput({id,content,receivedAt:d.clock.now()});d.clock.advance(15000);
 return new Scheduler(d.storage).collectReady(d.clock.now());
}
it.each(['上课','文献整理','一般实验'])('readable focus %s allows a seen silent decision in protocol 2',async description=>{
 const d=modern();try{d.models.outputs.narrative=activity(description,true,null);const ready=await input(d);
 await new HdsiApp(d).runTurn(ready!);
 expect(d.storage.runtime().dialogueContextVersion).toBe(2);expect(d.storage.read('messages','a')!.seenTurnId).toBeTruthy();
 expect(d.models.calls.map(c=>c.name)).toEqual(['narrative','personal_chat','memory']);expect(d.sender.sent).toEqual([]);
 expect(d.storage.all('tasks').filter(t=>t.status==='pending')).toEqual([]);
 }finally{d.storage.close();}
});
it.each(['now','later'] as const)('readable focus preserves personal reply=%s in protocol 2',async decision=>{
 const d=modern();try{d.models.outputs.narrative=activity('文献整理',true,null);
 d.models.outputs.personal_chat={emotions:[],taskChanges:[],reply:decision==='now'?{decision,intention:'回应',draft:'稍等呀'}:{decision,intention:'休息时再考虑',reconsiderAt:END}};
 d.models.outputs.expression={parts:[{kind:'text',content:'稍等呀'}]};await new HdsiApp(d).runTurn((await input(d))!);
 expect(d.storage.read('messages','a')!.seenTurnId).toBeTruthy();expect(d.sender.sent.length).toBe(decision==='now'?1:0);
 const checks=d.storage.all('tasks').filter(t=>t.status==='pending'&&t.checkReason==='deferred_reply');expect(checks.length).toBe(decision==='later'?1:0);
 if(decision==='later'){expect(checks[0].at).toBe(END);d.clock.time=END;d.models.outputs.personal_chat={emotions:[],reply:{decision:'none'},taskChanges:[]};await new HdsiApp(d).runTurn((await new Scheduler(d.storage).collectReady(END))!);expect(d.sender.sent).toEqual([]);expect(d.storage.read('tasks',checks[0].id)!.status).toBe('completed');}
 }finally{d.storage.close();}
});
it.each(['洗澡','游泳'])('inaccessible %s keeps input private and reuses one finite check in protocol 2',async description=>{
 const d=modern();const prepared:string[][]=[];const media={prepareForTurn:async(_turn:string,ids:string[])=>{prepared.push(ids);},readConfirmedForMessages:()=>[],readFrozenForTurn:()=>[]} as any;
 try{d.models.outputs.narrative=activity(description,false,END);await new HdsiApp({...d,incomingMedia:media}).runTurn((await input(d,'a','尚未看到的秘密'))!);
 const check=d.storage.all('tasks').find(t=>t.status==='pending'&&t.checkReason==='unread')!;expect(check.at).toBe(END);
 expect(d.storage.read('messages','a')!.seenTurnId).toBeNull();expect(d.models.calls.map(c=>c.name)).toEqual(['narrative']);expect(JSON.stringify(d.models.calls)).not.toContain('尚未看到的秘密');expect(prepared).toEqual([[]]);
 expect(await input(d,'b','另一条秘密')).toBeNull();expect(d.storage.all('tasks').filter(t=>t.status==='pending')).toHaveLength(1);expect(d.storage.read('tasks',check.id)!.messageIds).toEqual(['a','b']);
 d.clock.time=END;d.models.outputs.narrative=activity(description,false,LATER);await new HdsiApp(d).runTurn((await new Scheduler(d.storage).collectReady(END))!);
 expect(d.storage.read('tasks',check.id)!.at).toBe(LATER);expect(d.storage.read('messages','b')!.seenTurnId).toBeNull();
 d.clock.time=LATER;d.models.outputs.narrative=narrative;await new HdsiApp(d).runTurn((await new Scheduler(d.storage).collectReady(LATER))!);
 expect(d.storage.read('messages','a')!.seenTurnId).toBeTruthy();expect(d.storage.read('messages','b')!.seenTurnId).toBeTruthy();expect(d.models.calls.filter(c=>c.name==='personal_chat')).toHaveLength(1);
 }finally{d.storage.close();}
});
it('sleep still waits for wakeAt before reading protocol 2 input',async()=>{
 const d=modern();try{const c=d.storage.character();d.storage.set('character',{...c,sleep:{sleepAt:NOW,wakeAt:END}});
 expect(await input(d)).toBeNull();expect(d.models.calls).toEqual([]);expect(d.storage.read('messages','a')!.seenTurnId).toBeNull();d.clock.time=END;
 await new HdsiApp(d).runTurn((await new Scheduler(d.storage).collectReady(END))!);expect(d.storage.read('messages','a')!.seenTurnId).toBeTruthy();
 }finally{d.storage.close();}
});
it('shared offline input stays visible despite a finite phone restriction in protocol 2',async()=>{
 const d=modern();try{makeSharedFixture(d,{completedSteps:0});configureSharedModels(d);const c=d.storage.character();c.scene.mode='shared_offline';d.storage.set('character',c);const r=d.storage.runtime();r.sharedClock!.mode='shared_offline';d.storage.set('runtime',r);
 const original=d.models.outputs.narrative_shared;d.models.outputs.narrative_shared=(view:any)=>({...original(view),currentScene:activity('共同游泳',false,END).currentScene});
 await new InputBuffer(d.storage).acceptInput({id:'a',content:'【动作：走向泳池】',receivedAt:NOW});await new HdsiApp(d).runTurn((await new Scheduler(d.storage).collectReady(NOW))!);
 expect(d.models.calls.find(c=>c.name==='personal_shared')!.input.roles.visibleIds).toContain('a');expect(d.storage.read('messages','a')!.seenTurnId).toBeTruthy();expect(d.storage.all('turns')[0].sharedMeta!.allowSimulatedUserActions).toBe(false);
 }finally{d.storage.close();}
});
it('disk restart keeps a finite unread check, skips confirmed bubbles and retries unknown sending in protocol 2',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-phone-access-')),file=join(root,'test.sqlite'),base=modern();base.storage.close();
 let storage=new Storage(file);const d={...base,storage,chat:undefined,dialogue:undefined,environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage)};
 const reopen=()=>{storage.close();storage=new Storage(file);Object.assign(d,{storage,chat:undefined,dialogue:undefined,environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage)});};
 try{storage.set('character',initialCharacter(NOW));storage.set('runtime',{...storage.runtime(),nextEnvironmentAt:'2099-01-01T00:00:00Z'});
 await new InputBuffer(storage).acceptInput({id:'a',content:'回来时看看',receivedAt:NOW});d.clock.advance(15000);d.models.outputs.narrative=activity('游泳',false,END);
 await new HdsiApp(d).runTurn((await new Scheduler(storage).collectReady(d.clock.now()))!);const check=storage.all('tasks')[0];
 reopen();expect(storage.read('messages','a')!.seenTurnId).toBeNull();expect(storage.read('tasks',check.id)!.at).toBe(END);expect(storage.all('tasks')).toHaveLength(1);
 d.clock.time=END;d.models.outputs.narrative=narrative;d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'回应',draft:'两段'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'第一段'},{kind:'text',content:'第二段'}]};
 const send=d.sender.sendItem.bind(d.sender);let fail=true;d.sender.sendItem=async item=>{if(item.seq===1&&fail){fail=false;throw Error('unknown send result');}return send(item);};
 await expect(new HdsiApp(d).runTurn((await new Scheduler(storage).collectReady(END))!)).rejects.toThrow('unknown send result');const turn=storage.unfinishedTurn()!;
 expect(storage.outbox(turn.id).map(i=>i.status)).toEqual(['confirmed','retry']);storage.saveOutbox({...storage.outbox(turn.id)[1],status:'sending'});
 reopen();await new HdsiApp(d).resumeUnfinishedTurn();expect(d.sender.sent.map(i=>i.payload)).toEqual(['第一段','第二段']);expect(d.models.calls.filter(c=>c.name==='expression')).toHaveLength(1);
 expect(storage.unfinishedTurn()).toBeNull();expect(storage.read('messages','a')!.seenTurnId).toBeTruthy();expect(storage.read('tasks',check.id)!.status).toBe('cancelled');
 }finally{storage.close();expect(dirname(root)).toBe(tmpdir());rmSync(root,{recursive:true,force:true});}
});
