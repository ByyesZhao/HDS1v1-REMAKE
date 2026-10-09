import {assertActiveWindow,assertFullWindow} from './active-consistency';
import {recentFromSnapshot} from './chat-window';
import {randomUUID} from 'node:crypto';
import {isUnfinishedTurn} from '../storage';
import {DialogueStore} from './store';
import type {ChatEpisode,ChatTurnBinding,ChatRecent} from './types';
import type {Message,TurnRecord} from '../types';
const time=(at:string)=>Date.parse(at);
const literal=(a:string,b:string)=>a<b?-1:a>b?1:0;
export class ChatEpisodes {
 constructor(readonly store:DialogueStore,readonly idleMinutes=15){}
 private held(id:string):boolean{return this.store.storage.unfinishedTurns().some(t=>!t.outputComplete&&t.chatBinding?.holdReply&&t.chatBinding.episodeId===id);}
 private deadline(e:ChatEpisode):string{return new Date(time(e.lastInteractionAt)+this.idleMinutes*60000).toISOString();}
 acceptMessage(message:Message):string|null {
  const s=this.store.storage;this.closeDue(message.receivedAt);
  if(message.sharedActivityId){const previous=message.chatEpisodeId??s.read('messages',message.id)?.chatEpisodeId;message.chatEpisodeId=null;s.save('messages',message.id,message);if(previous)this.reconcile(previous,message.receivedAt);assertActiveWindow(s,{requiredMessageIds:[message.id]});return null;}
  const r=s.runtime();let episode=r.activeChatEpisodeId?this.store.chatEpisode(r.activeChatEpisodeId):null;
  if(!episode||episode.status==='closed')episode={id:`chat:${randomUUID()}`,openedAt:message.receivedAt,lastInteractionAt:message.receivedAt,status:'open',closedAt:null,closeReason:null};
  if(time(message.receivedAt)>time(episode.lastInteractionAt))episode.lastInteractionAt=message.receivedAt;
  message.chatEpisodeId=episode.id;this.store.saveChatEpisode(episode);s.save('messages',message.id,message);s.set('runtime',{...s.runtime(),activeChatEpisodeId:episode.id});assertActiveWindow(s,{requiredMessageIds:[message.id]});return episode.id;
 }
 private reconcile(id:string,at:string):void {
  const s=this.store.storage,e=this.store.chatEpisode(id);if(!e)return;
  const rows=s.messagesByChatEpisode(id).filter(m=>!m.sharedActivityId);
  if(!rows.length){s.remove('chat_episodes',id);if(s.runtime().activeChatEpisodeId===id)s.set('runtime',{...s.runtime(),activeChatEpisodeId:null});for(const t of s.unfinishedTurns().filter(t=>t.chatBinding?.episodeId===id))s.save('turns',t.id,{...t,chatBinding:{episodeId:null,holdReply:false}});assertFullWindow(s);return;}
  e.openedAt=rows[0].receivedAt;e.lastInteractionAt=rows.at(-1)!.receivedAt;if(e.status==='closed')e.closedAt=this.deadline(e);this.store.saveChatEpisode(e);this.closeDue(at);assertFullWindow(s);
 }
 bindTurn(turn:TurnRecord):ChatTurnBinding {
  if(turn.sharedMeta||turn.entryMode!=='chat')return {episodeId:null,holdReply:false};
  const s=this.store.storage,ids=turn.inputMessageIds.map(id=>s.read('messages',id)).filter((m):m is Message=>!!m&&!m.sharedActivityId&&!!m.chatEpisodeId);
  const episode=this.store.chatEpisode(ids.at(-1)?.chatEpisodeId??'');
  return {episodeId:episode?.status==='open'?episode.id:null,holdReply:episode?.status==='open'&&!turn.outputComplete};
 }
 confirmOutput(turn:TurnRecord,message:Message):string|null {
  const s=this.store.storage,current=s.read('turns',turn.id)??turn;
  if(message.sharedActivityId){this.acceptMessage(message);s.save('turns',turn.id,{...current,chatBinding:{episodeId:null,holdReply:false}});turn.chatBinding={episodeId:null,holdReply:false};this.closeDue(message.receivedAt);return null;}
  const binding=current.chatBinding,e=binding?.holdReply&&binding.episodeId?this.store.chatEpisode(binding.episodeId):null;
  if(e?.status==='open'){message.chatEpisodeId=e.id;if(time(message.receivedAt)>time(e.lastInteractionAt))e.lastInteractionAt=message.receivedAt;this.store.saveChatEpisode(e);s.save('messages',message.id,message);}else this.acceptMessage(message);
  const chatBinding={episodeId:message.chatEpisodeId!,holdReply:true};s.save('turns',turn.id,{...current,chatBinding});turn.chatBinding=chatBinding;assertActiveWindow(s,{requiredMessageIds:[message.id]});return message.chatEpisodeId!;
 }
 releaseReply(turnId:string,at:string):void{const s=this.store.storage,t=s.read('turns',turnId);if(t?.chatBinding)s.save('turns',t.id,{...t,chatBinding:{...t.chatBinding,holdReply:false}});this.closeDue(at);assertActiveWindow(s);}
 closeDue(at:string):void{const s=this.store.storage;for(const e of this.store.openChatEpisodes())if(!this.held(e.id)&&time(at)>=time(this.deadline(e))){this.store.saveChatEpisode({...e,status:'closed',closedAt:this.deadline(e),closeReason:'idle'});if(s.runtime().activeChatEpisodeId===e.id)s.set('runtime',{...s.runtime(),activeChatEpisodeId:null});}}
 nextDeadline(_at:string):string|null{return this.store.openChatEpisodes().filter(e=>!this.held(e.id)).map(e=>this.deadline(e)).sort((a,b)=>time(a)-time(b))[0]??null;}
 recent(phase:string,_at:string,count:number,visibleIds:string[]=[]):ChatRecent {
  const eligibility=phase==='narrative'?'ordinary_narrative' as const:'with_visible_inputs' as const;
  const selected=recentFromSnapshot(this.store.storage.recentChatSnapshot({eligibility,count,visibleIds}),{eligibility,count,visibleIds:new Set(visibleIds)});assertActiveWindow(this.store.storage,{requiredMessageIds:selected.messages.map(m=>m.id),touchedEpisodeIds:selected.episodeIds});return selected;
 }
}
