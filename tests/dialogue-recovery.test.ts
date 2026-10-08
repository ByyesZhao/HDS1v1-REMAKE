import { Storage } from '../src/storage';
import { it,expect } from 'vitest';
import { setup,NOW,saveInput } from './helpers';
import { DialogueStore } from '../src/dialogue/store';
import { DialogueEpisodes } from '../src/dialogue/episodes';
import { InputBuffer } from '../src/host/input';
import { HdsiApp } from '../src/app';
import { SerialHost } from '../src/host/runtime';
it('restart_preserves_binding and close_and_new_input_recheck',async()=>{
 const d=setup();try{await new InputBuffer(d.storage).acceptInput({id:'a',content:'a',receivedAt:NOW});const episodes=new DialogueEpisodes(new DialogueStore(d.storage));d.models.outputs.narrative=()=>{throw new Error('interrupted');};await expect(new HdsiApp(d).runTurn({inputMessageIds:['a'],taskIds:[],triggerKinds:['input']})).rejects.toThrow('interrupted');const t=d.storage.unfinishedTurn()!,id=d.storage.read('messages','a')!.dialogueEpisodeId;expect(t.dialogueBinding).toEqual({episodeId:id,holdReply:true});d.clock.advance(20*60000);d.storage.transaction(()=>episodes.closeDue(d.clock.now()));expect(d.storage.runtime().activeDialogueEpisodeId).toBe(id);d.models.outputs.narrative={experiences:[],currentScene:{description:'宿舍',activity:null},energy:{level:'正常',reason:'休息'}};await new HdsiApp(d).resumeUnfinishedTurn();expect(d.storage.read('messages','a')!.dialogueEpisodeId).toBe(id);d.clock.advance(60000);await new InputBuffer(d.storage).acceptInput({id:'b',content:'new',receivedAt:d.clock.now()});d.storage.transaction(()=>episodes.closeDue(d.clock.now()));expect(d.storage.runtime().activeDialogueEpisodeId).toBe(d.storage.read('messages','b')!.dialogueEpisodeId);}finally{d.storage.close();}
});
it('inconsistent_index_errors_without_merge and orphan_unread_or_reconsider_blocks',async()=>{
 const d=setup();try{d.storage.save('messages','orphan',{id:'orphan',content:'x',receivedAt:NOW,platformMessageIds:[],direction:'incoming',batchId:'b',seenTurnId:null,turnId:null,outboxSeq:null});const host=new SerialHost(new HdsiApp(d),{timers:false});await expect(host.start()).rejects.toThrow(/dialogue|段/i);expect(d.storage.read('messages','orphan')!.dialogueEpisodeId).toBeUndefined();expect(d.models.calls).toEqual([]);await host.stop();}finally{d.storage.close();}
});
it('irrelevant_completed_history_warning_only but unknown recent associations block',()=>{
 const d=setup();try{const store=new DialogueStore(d.storage),episodes=new DialogueEpisodes(store);for(let i=0;i<5;i++){const at=new Date(Date.parse(NOW)+i*30*60000).toISOString();store.saveEpisode({id:String(i),openedAt:at,lastInteractionAt:at,status:'closed',closedAt:at,closeReason:'idle'});}d.storage.save('messages','old',{id:'old',content:'x',receivedAt:new Date(Date.parse(NOW)-86400000).toISOString(),platformMessageIds:[],direction:'incoming',batchId:null,seenTurnId:'old',turnId:null,outboxSeq:null});let r=episodes.checkConsistency();expect(r.blockingIssues).toEqual([]);expect(r.historicalWarnings).toHaveLength(1);d.storage.save('tasks','check',{id:'check',kind:'check_messages',checkReason:'deferred_reply',messageIds:['old'],at:NOW,description:'重谈',status:'pending'});r=episodes.checkConsistency();expect(r.blockingIssues).toHaveLength(1);}finally{d.storage.close();}
});

it('resume_checks_current_index_before_unpausing_or_accepting_recovery',async()=>{const storage=new Storage(':memory:');try{const d=new DialogueEpisodes(new DialogueStore(storage));d.acceptMessage({id:'current-corrupt',content:'input',direction:'incoming',receivedAt:'2026-10-08T10:00:00+08:00',seenTurnId:null,turnId:null,outboxSeq:null,batchId:null,platformMessageIds:[]});storage.save('messages','current-corrupt',{...storage.read('messages','current-corrupt')!,dialogueEpisodeId:'missing'});storage.set('runtime',{...storage.runtime(),paused:true});const deps=setup();deps.storage.close();const host=new SerialHost(new HdsiApp({...deps,storage,dialogue:d}),{timers:false});await expect(host.resume()).rejects.toThrow(/索引不一致/);expect(storage.runtime().paused).toBe(true);await host.stop();}finally{storage.close();}});

it('late_read_closed_episode_with_null_binding_can_resume_after_model_failure',async()=>{
 const d=setup(),app=new HdsiApp(d),episodes=app.dependencies.dialogue!;try{
 await new InputBuffer(d.storage).acceptInput({id:'late',content:'晚些看也可以',receivedAt:NOW});const old=d.storage.read('messages','late')!.dialogueEpisodeId;
 d.clock.advance(20*60000);d.storage.transaction(()=>episodes.closeDue(d.clock.now()));d.models.outputs.narrative=()=>{throw Error('temporary model failure');};
 await expect(app.runTurn({inputMessageIds:['late'],taskIds:[],triggerKinds:['input']})).rejects.toThrow('temporary');expect(d.storage.unfinishedTurn()!.dialogueBinding).toEqual({episodeId:null,holdReply:false});
 expect(episodes.checkConsistency().blockingIssues).toEqual([]);d.storage.set('runtime',{...d.storage.runtime(),paused:true});
 d.models.outputs.narrative={experiences:[],currentScene:{description:'宿舍',activity:null},energy:{level:'正常',reason:'休息'}};
 const host=new SerialHost(app,{timers:false});await host.resume();expect(d.storage.unfinishedTurn()).toBeNull();expect(d.storage.read('messages','late')!.dialogueEpisodeId).toBe(old);await host.stop();
 }finally{d.storage.close();}
});

it('historical_warning_is_logged_without_private_body_and_does_not_block_start',async()=>{
 const d=setup(),app=new HdsiApp(d),store=new DialogueStore(d.storage),warnings:string[]=[];try{
 for(let i=0;i<5;i++){const at=new Date(Date.parse(NOW)+i*30*60000).toISOString();store.saveEpisode({id:`warn:${i}`,openedAt:at,lastInteractionAt:at,status:'closed',closedAt:at,closeReason:'idle'});}
 d.storage.save('messages','old-warning',{id:'old-warning',content:'PRIVATE BODY',receivedAt:new Date(Date.parse(NOW)-86400000).toISOString(),direction:'incoming',seenTurnId:'completed',turnId:null,outboxSeq:null,batchId:null,platformMessageIds:[]});
 d.storage.set('runtime',{...d.storage.runtime(),paused:true});const host=new SerialHost(app,{timers:false,onWarning:warning=>warnings.push(warning)});await host.start();expect(warnings.join()).toContain('old-warning');expect(warnings.join()).not.toContain('PRIVATE BODY');await host.stop();
 }finally{d.storage.close();}
});
