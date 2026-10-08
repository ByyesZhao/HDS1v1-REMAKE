import { it,expect } from 'vitest';
import { Storage } from '../src/storage';
import { DialogueStore } from '../src/dialogue/store';
import { DialogueEpisodes } from '../src/dialogue/episodes';
import type { Message,TurnRecord } from '../src/types';
const at=(min:number)=>new Date(Date.UTC(2026,9,8,0,min)).toISOString();
const msg=(id:string,min:number,seen:string|null='seen',direction:'incoming'|'outgoing'='incoming'):Message=>({id,content:id,receivedAt:at(min),seenTurnId:seen,direction,platformMessageIds:[],batchId:null,turnId:null,outboxSeq:null});
const turn=(id:string,inputs:string[]):TurnRecord=>({id,inputMessageIds:inputs,triggerTaskIds:[],triggerKinds:['input'],at:at(0),completedAt:null,frozenResult:null,outputComplete:false,done:false,batchIds:[],entryMode:'chat'});
function setup(){const s=new Storage(':memory:'),store=new DialogueStore(s),d=new DialogueEpisodes(store);return {s,store,d};}
it('four_total_with_or_without_current without a second thirty-message cut',()=>{
 const {s,store,d}=setup();try{for(const [i,id] of ['A','B','C','D','E'].entries()){store.saveEpisode({id,openedAt:at(i*30),lastInteractionAt:at(i*30+1),status:id==='E'?'open':'closed',closedAt:id==='E'?null:at(i*30+16),closeReason:id==='E'?null:'idle'});const count=id==='E'?40:1;for(let j=0;j<count;j++){const m={...msg(`${id}${j}`,i*30),dialogueEpisodeId:id};s.save('messages',m.id,m);}}
 s.set('runtime',{...s.runtime(),activeDialogueEpisodeId:'E'});expect(d.recent('personal',at(125),4).episodeIds).toEqual(['B','C','D','E']);expect(d.recent('personal',at(125),4).messages.filter(m=>m.dialogueEpisodeId==='E')).toHaveLength(40);
 for(const m of s.messages().filter(m=>m.dialogueEpisodeId==='E'))s.save('messages',m.id,{...m,seenTurnId:null});expect(d.recent('narrative',at(125),4).episodeIds).toEqual(['A','B','C','D']);expect(d.recent('narrative',at(125),4).messages.every(m=>m.dialogueEpisodeId!=='E')).toBe(true);
 const m=s.read('messages','E0')!;s.save('messages',m.id,{...m,seenTurnId:'actual'});expect(d.recent('narrative',at(125),4).messages.at(-1)?.id).toBe('E0');
 }finally{s.close();}
});
it('episode_order_last_interaction_then_opened_time_then_id',()=>{
 const {s,store,d}=setup();try{for(const [id,opened,last] of [['A',1,100],['B',2,30],['C',3,40],['D',4,50],['E',5,60]] as const){store.saveEpisode({id,openedAt:at(opened),lastInteractionAt:at(last),status:'closed',closedAt:at(last+15),closeReason:'idle'});s.save('messages',id,{...msg(id,last),dialogueEpisodeId:id});}expect(d.recent('narrative',at(120),4).episodeIds).toEqual(['C','D','E','A']);}finally{s.close();}
});
it('idle_15_minutes_boundary and no_reply_can_close',()=>{
 const {s,d}=setup();try{const a=msg('a',0);s.transaction(()=>d.acceptMessage(a));const t=turn('t',['a']);s.transaction(()=>{t.dialogueBinding=d.bindTurn(t);s.save('turns',t.id,t);});s.transaction(()=>d.closeDue(at(30)));expect(s.runtime().activeDialogueEpisodeId).toBe(a.dialogueEpisodeId);expect(d.nextDeadline(at(30))).toBeNull();s.transaction(()=>d.releaseReply(t.id,at(30)));expect(s.runtime().activeDialogueEpisodeId).toBeNull();const b=msg('b',31);s.transaction(()=>d.acceptMessage(b));expect(b.dialogueEpisodeId).not.toBe(a.dialogueEpisodeId);s.transaction(()=>d.closeDue(at(45)));expect(s.runtime().activeDialogueEpisodeId).toBe(b.dialogueEpisodeId);s.transaction(()=>d.closeDue(at(46)));expect(s.runtime().activeDialogueEpisodeId).toBeNull();}finally{s.close();}
});
it('proactive_output_opens but silent_background_does_not_open',()=>{
 const {s,d}=setup();try{const t=turn('life',[]);expect(d.bindTurn(t)).toEqual({episodeId:null,holdReply:false});expect(s.all('dialogue_episodes')).toHaveLength(0);s.save('turns',t.id,t);const out=msg('out',10,null,'outgoing');s.transaction(()=>d.confirmOutput(t,out));expect(out.dialogueEpisodeId).toBeTruthy();expect(s.all('dialogue_episodes')).toHaveLength(1);expect(s.read('turns',t.id)!.dialogueBinding?.episodeId).toBe(out.dialogueEpisodeId);}finally{s.close();}
});
it('shared active holds through silent gaps and ends from actual confirmation',()=>{
 const {s,d}=setup();try{const m=msg('a',0);s.transaction(()=>{d.acceptMessage(m);d.recordActivity('game',m.dialogueEpisodeId!,'start',at(1));});s.transaction(()=>d.closeDue(at(90)));expect(s.runtime().activeDialogueEpisodeId).toBe(m.dialogueEpisodeId);const b=msg('b',90);b.sharedActivityId='game';s.transaction(()=>d.acceptMessage(b));expect(b.dialogueEpisodeId).toBe(m.dialogueEpisodeId);s.transaction(()=>d.recordActivity('game',b.dialogueEpisodeId!,'end',at(91)));expect(d.nextDeadline(at(100))).toBe(at(106));s.transaction(()=>d.closeDue(at(106)));expect(s.runtime().activeDialogueEpisodeId).toBeNull();}finally{s.close();}
});
