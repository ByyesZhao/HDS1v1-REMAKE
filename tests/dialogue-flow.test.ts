import { it,expect } from 'vitest';
import { HdsiApp } from '../src/app';
import { InputBuffer } from '../src/host/input';
import { DialogueStore } from '../src/dialogue/store';
import { DialogueEpisodes } from '../src/dialogue/episodes';
import { makeSharedFixture,configureSharedModels } from './shared-v3-fixture';
import { Scheduler } from '../src/host/scheduler';
import { SerialHost } from '../src/host/runtime';
import { setup,NOW } from './helpers';
const request={inputMessageIds:['a'],taskIds:[],triggerKinds:['input' as const]};
async function input(d:ReturnType<typeof setup>){await new InputBuffer(d.storage).acceptInput({id:'a',content:'你好',receivedAt:NOW});}
it('segmented_reply_one_episode and generation_over_15_minutes_stays',async()=>{
 const d=setup();try{await input(d);const original=d.storage.read('messages','a')!.dialogueEpisodeId;
 d.models.outputs.narrative=()=>{d.clock.advance(16*60000);return {experiences:[],currentScene:{description:'宿舍',activity:null},energy:{level:'正常',reason:'休息'}};};
 d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'回答',draft:'你好'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'第一段'},{kind:'text',content:'第二段'}]};
 await new HdsiApp(d).runTurn(request);expect(original).toBeTruthy();expect(new Set(d.storage.messages().map(m=>m.dialogueEpisodeId))).toEqual(new Set([original]));expect(d.storage.all('turns')[0].dialogueBinding).toEqual({episodeId:original,holdReply:false});expect(d.storage.all('dialogue_episodes')[0].lastInteractionAt).toBe(d.storage.messages().at(-1)!.receivedAt);
 }finally{d.storage.close();}
});
it('memory_after_output_does_not_hold and metadata timer closes without model calls',async()=>{
 const d=setup();try{await input(d);d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'答',draft:'好'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'好'}]};d.models.outputs.memory=()=>{throw new Error('memory unavailable');};await expect(new HdsiApp(d).runTurn(request)).rejects.toThrow('memory unavailable');const e=d.storage.all('dialogue_episodes')[0];expect(e).toBeTruthy();expect(d.storage.unfinishedTurn()!.dialogueBinding?.holdReply).toBe(false);const count=d.models.calls.length;d.clock.advance(15*60000);const host=new SerialHost(new HdsiApp(d),{timers:false});await host.wake();expect(d.storage.read('dialogue_episodes',e.id)!.status).toBe('closed');expect(d.models.calls).toHaveLength(count);await host.stop();}finally{d.storage.close();}
});
it('incoming_index_failure_rolls_back_message and duplicate/control inputs do not anchor',async()=>{
 const d=setup();try{await input(d);const e=d.storage.all('dialogue_episodes')[0];expect(e).toBeTruthy();d.clock.advance(60000);await new InputBuffer(d.storage).acceptInput({id:'a',content:'重复',receivedAt:d.clock.now()});await new InputBuffer(d.storage).acceptInput({id:'control',content:'【推进】',receivedAt:d.clock.now()});expect(d.storage.all('dialogue_episodes')).toHaveLength(1);expect(d.storage.read('dialogue_episodes',e.id)!.lastInteractionAt).toBe(NOW);
 d.storage.prepare("CREATE TRIGGER reject_episode BEFORE UPDATE ON dialogue_episodes BEGIN SELECT RAISE(ABORT,'index failed'); END").run();await expect(new InputBuffer(d.storage).acceptInput({id:'b',content:'不能半写',receivedAt:d.clock.now()})).rejects.toThrow('index failed');expect(d.storage.read('messages','b')).toBeNull();
 }finally{d.storage.close();}
});
it('confirmation_index_failure_rolls_back_local_receipt while preserving recovery',async()=>{
 const d=setup();try{await input(d);d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'答',draft:'好'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'好'}]};const send=d.sender.sendItem.bind(d.sender);d.sender.sendItem=async item=>{const r=await send(item);d.storage.prepare("CREATE TRIGGER reject_confirm BEFORE UPDATE ON dialogue_episodes BEGIN SELECT RAISE(ABORT,'confirm index failed'); END").run();return r;};await expect(new HdsiApp(d).runTurn(request)).rejects.toThrow('confirm index failed');const t=d.storage.unfinishedTurn()!;expect(d.storage.outbox(t.id)[0].status).toBe('sending');expect(d.storage.messages().filter(m=>m.direction==='outgoing')).toEqual([]);expect(t.dialogueBinding?.holdReply).toBe(true);
 }finally{d.storage.close();}
});

it('shared_silent_gap_continuous and end_anchor_is_confirmation_not_postprocessing',async()=>{
 const d=setup();try{makeSharedFixture(d,{completedSteps:18});configureSharedModels(d);await new InputBuffer(d.storage).acceptInput({id:'a',content:'【动作：准备结束游戏】',receivedAt:NOW});const episodes=new DialogueEpisodes(new DialogueStore(d.storage)),id=d.storage.read('messages','a')!.dialogueEpisodeId!;d.storage.transaction(()=>episodes.recordActivity('activity-a',id,'start',NOW));d.clock.advance(30*60000);const before=d.clock.now();d.models.outputs.narrative_shared={experiences:[],currentScene:{description:'游戏结束',activity:null},energy:{level:'正常',reason:'休息'},publicNarration:'本次游戏结束，大家退出房间。',progress:'结束',outline:{goal:'游戏',openThreads:[],endingCondition:'退出'},simulatedUserActions:[]};d.models.outputs.personal_shared={emotions:[],reply:{decision:'none'},taskChanges:[],sharedChange:{action:'end'}};d.models.outputs.memory=()=>{d.clock.advance(30*60000);return {schemaVersion:3,shortTermChanges:[],longTermChanges:[],detailChanges:[]};};const request=(await new Scheduler(d.storage).collectReady(before))!;await new HdsiApp(d).runTurn(request);expect(d.storage.all('dialogue_episodes')).toHaveLength(1);expect(d.storage.read('dialogue_activity_links','activity-a')?.endedAt).toBe(before);expect(d.storage.read('dialogue_episodes',id)?.closedAt).toBe(new Date(Date.parse(before)+15*60000).toISOString());}finally{d.storage.close();}
});
it('deferred_old_source_not_retimestamped while a new reply opens a new episode',async()=>{
 const d=setup();try{await input(d);const old={...d.storage.read('messages','a')!,seenTurnId:'old'};d.storage.save('messages','a',old);d.clock.advance(20*60000);d.storage.transaction(()=>new DialogueEpisodes(new DialogueStore(d.storage)).closeDue(d.clock.now()));d.storage.save('tasks','defer',{id:'defer',kind:'check_messages',at:d.clock.now(),description:'再答',checkReason:'deferred_reply',messageIds:['a'],status:'pending'});d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'回答旧话',draft:'现在回答'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'现在回答'}]};await new HdsiApp(d).runTurn({inputMessageIds:[],taskIds:['defer'],triggerKinds:['check_messages']});expect(d.storage.read('messages','a')).toEqual(old);expect(d.storage.messages().find(m=>m.direction==='outgoing')!.dialogueEpisodeId).not.toBe(old.dialogueEpisodeId);}finally{d.storage.close();}
});
