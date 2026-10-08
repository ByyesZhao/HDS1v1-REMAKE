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
