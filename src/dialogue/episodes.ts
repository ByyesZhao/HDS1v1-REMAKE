import { randomUUID } from 'node:crypto';
import { DialogueStore } from './store';
import type { DialogueEpisode,DialogueTurnBinding,DialogueRecent,DialogueConsistencyReport } from './types';
import type { Message,TurnRecord } from '../types';
import { isUnfinishedTurn } from '../storage';
const time=(at:string)=>Date.parse(at);
const literal=(a:string,b:string)=>a<b?-1:a>b?1:0;
export class DialogueEpisodes {
 constructor(readonly store:DialogueStore,readonly idleMinutes=15){}
 private held(id:string):boolean{return this.store.storage.all('turns').some(t=>isUnfinishedTurn(t)&&!t.outputComplete&&t.dialogueBinding?.holdReply&&t.dialogueBinding.episodeId===id);}
 private active(id:string):boolean{return this.store.links().some(l=>l.episodeId===id&&l.status==='active');}
 private deadline(e:DialogueEpisode):string{const end=this.store.links().filter(l=>l.episodeId===e.id&&l.endedAt).map(l=>time(l.endedAt!));return new Date(Math.max(time(e.lastInteractionAt),...end)+this.idleMinutes*60000).toISOString();}
 acceptMessage(message:Message):string {
  this.closeDue(message.receivedAt);
  const s=this.store.storage,r=s.runtime(),linked=message.sharedActivityId?this.store.link(message.sharedActivityId):null;
  let episode=linked?.status==='active'?this.store.episode(linked.episodeId):r.activeDialogueEpisodeId?this.store.episode(r.activeDialogueEpisodeId):null;
  if(!episode||episode.status==='closed'){episode={id:`dialogue:${randomUUID()}`,openedAt:message.receivedAt,lastInteractionAt:message.receivedAt,status:'open',closedAt:null,closeReason:null};}
  if(time(message.receivedAt)>time(episode.lastInteractionAt))episode.lastInteractionAt=message.receivedAt;
  message.dialogueEpisodeId=episode.id;this.store.saveEpisode(episode);s.save('messages',message.id,message);s.set('runtime',{...s.runtime(),activeDialogueEpisodeId:episode.id});return episode.id;
 }
 bindTurn(turn:TurnRecord):DialogueTurnBinding {
  const linked=turn.sharedMeta?this.store.link(turn.sharedMeta.activityId):null;
  const inputEpisodes=turn.inputMessageIds.map(id=>this.store.storage.read('messages',id)?.dialogueEpisodeId).filter((id):id is string=>!!id);
  const input=this.store.episode(inputEpisodes.at(-1)??'');
  const episodeId=linked?.status==='active'?linked.episodeId:input?.status==='open'?input.id:null;
  return {episodeId,holdReply:episodeId!==null&&!turn.outputComplete};
 }
 confirmOutput(turn:TurnRecord,message:Message):string {
  const current=this.store.storage.read('turns',turn.id)??turn,binding=current.dialogueBinding;
  const held=binding?.holdReply&&binding.episodeId?this.store.episode(binding.episodeId):null;
  if(held&&held.status==='open'){message.dialogueEpisodeId=held.id;held.lastInteractionAt=time(message.receivedAt)>time(held.lastInteractionAt)?message.receivedAt:held.lastInteractionAt;this.store.saveEpisode(held);this.store.storage.save('messages',message.id,message);}
  else this.acceptMessage(message);
  const updated={...current,dialogueBinding:{episodeId:message.dialogueEpisodeId!,holdReply:true}};this.store.storage.save('turns',turn.id,updated);turn.dialogueBinding=updated.dialogueBinding;return message.dialogueEpisodeId!;
 }
 releaseReply(turnId:string,at:string):void {const s=this.store.storage,t=s.read('turns',turnId);if(t?.dialogueBinding)s.save('turns',turnId,{...t,dialogueBinding:{...t.dialogueBinding,holdReply:false}});this.closeDue(at);}
 recordActivity(activityId:string,episodeId:string,event:'start'|'end',at:string):void {
  const old=this.store.link(activityId);if(event==='end'&&old?.status==='ended')return;
  this.store.saveLink({id:activityId,episodeId,status:event==='start'?'active':'ended',startedAt:old?.startedAt??(event==='start'?at:null),endedAt:event==='end'?at:old?.endedAt??null,evidenceFrom:old?.evidenceFrom??null,evidenceTo:old?.evidenceTo??null});
 }
 closeDue(at:string):void {
  const s=this.store.storage;
  for(const e of this.store.episodes().filter(e=>e.status==='open'))if(!this.held(e.id)&&!this.active(e.id)&&time(at)>=time(this.deadline(e))){e.status='closed';e.closedAt=this.deadline(e);e.closeReason='idle';this.store.saveEpisode(e);const r=s.runtime();if(r.activeDialogueEpisodeId===e.id)s.set('runtime',{...r,activeDialogueEpisodeId:null});}
 }
 nextDeadline(_at:string):string|null {return this.store.episodes().filter(e=>e.status==='open'&&!this.held(e.id)&&!this.active(e.id)).map(e=>this.deadline(e)).sort((a,b)=>time(a)-time(b))[0]??null;}
 recent(phase:string,_at:string,count:number,visibleIds:string[]=[]):DialogueRecent {
  const s=this.store.storage,allowed=new Set(phase==='narrative'?[]:visibleIds);
  const messages=s.messages().filter(m=>m.direction==='outgoing'||m.seenTurnId!==null||allowed.has(m.id));
  const present=new Set(messages.map(m=>m.dialogueEpisodeId));
  const episodeIds=this.store.episodes().filter(e=>present.has(e.id)).sort((a,b)=>time(a.lastInteractionAt)-time(b.lastInteractionAt)||time(a.openedAt)-time(b.openedAt)||literal(a.id,b.id)).slice(-count).map(e=>e.id);
  const ranks=new Map(episodeIds.map((id,i)=>[id,i]));
  return {episodeIds,messages:messages.filter(m=>m.dialogueEpisodeId&&ranks.has(m.dialogueEpisodeId)).sort((a,b)=>ranks.get(a.dialogueEpisodeId!)!-ranks.get(b.dialogueEpisodeId!)!||time(a.receivedAt)-time(b.receivedAt)||(a.turnId===b.turnId&&a.outboxSeq!==null&&b.outboxSeq!==null?a.outboxSeq-b.outboxSeq:literal(a.id,b.id)))};
 }
 checkConsistency():DialogueConsistencyReport {
  const s=this.store.storage,episodes=this.store.episodes(),ids=new Set(episodes.map(e=>e.id)),messages=s.messages(),r=s.runtime();
  const report:DialogueConsistencyReport={version:r.dialogueContextVersion??null,orphanMessageIds:[],invalidAssociationIds:[],currentConflict:false,unfinishedTurnIds:[],activityErrors:[],blockingIssues:[],historicalWarnings:[]};
  if(report.version!==1)report.blockingIssues.push('dialogue version requires explicit migration');
  const current=r.activeDialogueEpisodeId?this.store.episode(r.activeDialogueEpisodeId):null,open=episodes.filter(e=>e.status==='open');
  report.currentConflict=!!r.activeDialogueEpisodeId&&current?.status!=='open'||open.length>1||open.length===1&&current?.id!==open[0].id;
  if(report.currentConflict)report.blockingIssues.push('active dialogue episode conflict');
  const recentEpisodes=episodes.sort((a,b)=>time(b.lastInteractionAt)-time(a.lastInteractionAt)).slice(0,4),cutoff=Math.min(...recentEpisodes.map(e=>time(e.openedAt)));
  const protectedMessages=new Set(s.all('turns').filter(isUnfinishedTurn).flatMap(t=>t.inputMessageIds));
  for(const task of s.all('tasks').filter(t=>t.status==='pending'))for(const id of task.messageIds??[])protectedMessages.add(id);
  for(const memory of s.all('memories'))for(const id of memory.sourceIds??[])protectedMessages.add(id);
  const historical=(m:Message)=>m.direction==='outgoing'||m.seenTurnId!==null;
  for(const m of messages){if(m.dialogueEpisodeId&&ids.has(m.dialogueEpisodeId))continue;
   (m.dialogueEpisodeId?report.invalidAssociationIds:report.orphanMessageIds).push(m.id);
   const completed=m.turnId?s.read('turns',m.turnId)?.done===true:m.seenTurnId!==null;
   const safe=historical(m)&&completed&&time(m.receivedAt)<cutoff&&!protectedMessages.has(m.id)&&!m.sharedActivityId;
   (safe?report.historicalWarnings:report.blockingIssues).push(`message ${m.id}: missing dialogue association`);
  }
  for(const t of s.all('turns').filter(isUnfinishedTurn)){const b=t.dialogueBinding,needs=t.inputMessageIds.length>0||!!t.sharedMeta||s.outbox(t.id).some(o=>o.status==='confirmed');if(!b||b.episodeId&&!ids.has(b.episodeId)||needs&&!b.episodeId&&!t.outputComplete){report.unfinishedTurnIds.push(t.id);report.blockingIssues.push(`turn ${t.id}: missing dialogue binding`);}}
  for(const l of this.store.links()){if(!ids.has(l.episodeId)||l.status==='active'&&r.sharedClock?.activityId!==l.id){report.activityErrors.push(l.id);report.blockingIssues.push(`activity ${l.id}: invalid dialogue link`);}}
  if(r.sharedClock?.status==='active'&&!this.store.link(r.sharedClock.activityId)){report.activityErrors.push(r.sharedClock.activityId);report.blockingIssues.push('active shared activity missing dialogue link');}
  return report;
 }
}
