import {it,expect} from 'vitest';
import {Storage} from '../src/storage';
import {DialogueStore} from '../src/dialogue/store';
import {ChatEpisodes} from '../src/dialogue/chat-episodes';
import type {Message,TurnRecord} from '../src/types';
const at=(min:number)=>new Date(Date.UTC(2026,9,8,12,min)).toISOString();
const msg=(id:string,min:number,seen:string|null='seen',direction:Message['direction']='incoming'):Message=>({id,content:id,receivedAt:at(min),seenTurnId:seen,direction,platformMessageIds:[],batchId:null,turnId:null,outboxSeq:null});
const turn=(id:string,inputs:string[]):TurnRecord=>({id,inputMessageIds:inputs,triggerTaskIds:[],triggerKinds:['input'],at:at(0),completedAt:null,frozenResult:null,outputComplete:false,done:false,batchIds:[],entryMode:'chat'});
function fixture(){const s=new Storage(':memory:'),store=new DialogueStore(s),chat=new ChatEpisodes(store);return {s,store,chat};}
it('activity_never_anchors_or_holds_chat; closed_chat_still_eligible_until_four_newer',()=>{
 const {s,store,chat}=fixture();try{const a=msg('a',0);chat.acceptMessage(a);const activity={...msg('act',5),sharedActivityId:'game'};chat.acceptMessage(activity);expect(activity.chatEpisodeId).toBeNull();expect(chat.nextDeadline(at(5))).toBe(at(15));chat.closeDue(at(40));expect(store.chatEpisode(a.chatEpisodeId!)?.closedAt).toBe(at(15));expect(chat.recent('narrative',at(40),4).messages.map(m=>m.id)).toEqual(['a']);const b=msg('b',41);chat.acceptMessage(b);expect(b.chatEpisodeId).not.toBe(a.chatEpisodeId);for(let i=0;i<3;i++)chat.acceptMessage(msg(`later${i}`,60+i*20));expect(chat.recent('narrative',at(120),4).messages.map(m=>m.id)).toEqual(['b','later0','later1','later2']);}finally{s.close();}
});
it('short_activity_can_continue_chat_before_idle',()=>{const {s,chat}=fixture();try{const a=msg('a',0);chat.acceptMessage(a);chat.acceptMessage({...msg('act',5),sharedActivityId:'game'});const b=msg('b',10);chat.acceptMessage(b);expect(a.chatEpisodeId).toBe(b.chatEpisodeId);expect(chat.nextDeadline(at(10))).toBe(at(25));}finally{s.close();}});
it('silent_life_has_no_chat_episode; ordinary_proactive_confirm_opens_chat',()=>{const {s,store,chat}=fixture();try{const t=turn('life',[]);t.chatBinding=chat.bindTurn(t);s.save('turns',t.id,t);expect(t.chatBinding).toEqual({episodeId:null,holdReply:false});expect(store.chatEpisodes()).toHaveLength(0);const out=msg('out',10,null,'outgoing');chat.confirmOutput(t,out);expect(out.chatEpisodeId).toBeTruthy();expect(store.chatEpisodes()).toHaveLength(1);chat.releaseReply(t.id,at(30));expect(store.chatEpisode(out.chatEpisodeId!)?.status).toBe('closed');}finally{s.close();}});
it('ordinary_generation_hold_and_failed_sending_not_timed_out',()=>{const {s,chat}=fixture();try{const a=msg('a',0);chat.acceptMessage(a);const t=turn('t',['a']);t.chatBinding=chat.bindTurn(t);s.save('turns','t',t);chat.closeDue(at(30));expect(s.runtime().activeChatEpisodeId).toBe(a.chatEpisodeId);expect(chat.nextDeadline(at(30))).toBeNull();chat.releaseReply('t',at(30));expect(s.runtime().activeChatEpisodeId).toBeNull();}finally{s.close();}});
it('visible_interaction_orders_mixed_seen_unread_episode; invisible_current_does_not_take_fourth_slot; forty_messages_in_chat_not_trimmed',()=>{
 const {s,store,chat}=fixture();try{for(const [i,id] of ['A','B','C','D','E'].entries()){store.saveChatEpisode({id,openedAt:at(i*30),lastInteractionAt:at(i*30),status:'closed',closedAt:at(i*30+15),closeReason:'idle'});const m={...msg(id,i*30),chatEpisodeId:id};s.save('messages',id,m);}
 const hidden={...msg('hidden',200,null),chatEpisodeId:'A'};s.save('messages',hidden.id,hidden);store.saveChatEpisode({...store.chatEpisode('A')!,lastInteractionAt:at(200)});expect(chat.recent('narrative',at(220),4).episodeIds).toEqual(['B','C','D','E']);expect(store.chatEpisode('A')?.lastInteractionAt).toBe(at(200));
 s.save('messages','E',{...s.read('messages','E')!,seenTurnId:null});expect(chat.recent('narrative',at(220),4).episodeIds).toEqual(['A','B','C','D']);expect(chat.recent('personal',at(220),4,['hidden']).episodeIds).toEqual(['B','C','D','A']);
 for(let i=0;i<40;i++)s.save('messages',`x${i}`,{...msg(`x${i}`,210),chatEpisodeId:'D'});expect(chat.recent('narrative',at(220),4).messages.filter(m=>m.chatEpisodeId==='D')).toHaveLength(41);
 }finally{s.close();}
});
