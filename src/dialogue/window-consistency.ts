import {isUnfinishedTurn,type Storage} from '../storage';
import {recentFromSnapshot} from './chat-window';
import {DialogueStore} from './store';
import type {WindowConsistencyReport} from './types';
import type {Message} from '../types';
export interface WindowAuditSnapshot {messages:Message[];episodes:import('./types').ChatEpisode[];turns:import('../types').TurnRecord[];legacyIds:Set<string>;protectedSourceIds:string[];active?:boolean}
export function checkWindowConsistency(storage:Storage,options:{idleMinutes:number;recentSegments:number}):WindowConsistencyReport {
 const store=new DialogueStore(storage),protectedSourceIds:string[]=[];
 for(const task of storage.all('tasks').filter(t=>t.status==='pending'))protectedSourceIds.push(...task.messageIds??[]);
 for(const table of ['memories','details','learned_background'] as const)if(storage.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))for(const row of storage.prepare(`SELECT data FROM ${table}`).all())protectedSourceIds.push(...JSON.parse(String(row.data)).sourceIds??[]);
 return auditWindowSnapshot(storage,options,{messages:storage.messages(),episodes:store.chatEpisodes(),turns:storage.all('turns'),legacyIds:new Set(store.episodes().map(e=>e.id)),protectedSourceIds});
}
export function auditWindowSnapshot(storage:Storage,options:{idleMinutes:number;recentSegments:number},snapshot:WindowAuditSnapshot):WindowConsistencyReport {
 const r=storage.runtime(),{messages,episodes,turns,legacyIds}=snapshot,episodeIds=new Set(episodes.map(e=>e.id)),inflight=turns.filter(isUnfinishedTurn);
 const messageById=new Map(messages.map(m=>[m.id,m])),turnById=new Map(turns.map(t=>[t.id,t])),episodeById=new Map(episodes.map(e=>[e.id,e]));
 const report:WindowConsistencyReport={version:r.dialogueContextVersion??null,ordinaryAssociationErrors:[],activityErrors:[],legacyInflightErrors:[],blockingIssues:[],historicalWarnings:[],protectedMessageIds:[]};
 const block=(reason:string)=>report.blockingIssues.push(reason),protectedIds=new Set<string>(snapshot.protectedSourceIds);
 if(snapshot.active)messages.forEach(m=>protectedIds.add(m.id));
 if(report.version!==2)block('chat version requires explicit migration');
 if(storage.read('chat_index_metadata','chat-index')?.idleMinutes!==options.idleMinutes)block('chat idle parameter requires explicit migration');
 const open=episodes.filter(e=>e.status==='open');
 if(open.length>1||open.length===1&&open[0].id!==r.activeChatEpisodeId||r.activeChatEpisodeId&&!open.some(e=>e.id===r.activeChatEpisodeId)){report.ordinaryAssociationErrors.push('activeChatEpisodeId');block('active chat episode conflict');}
 const visibleIds=[...new Set(inflight.flatMap(t=>t.inputMessageIds)),...messages.filter(m=>m.direction==='incoming'&&m.seenTurnId===null).map(m=>m.id)];
 const windows=snapshot.active?[]:(['ordinary_narrative','with_visible_inputs'] as const).map(eligibility=>recentFromSnapshot({messages,episodes},{eligibility,count:options.recentSegments,visibleIds:new Set(visibleIds)}));
 windows.flatMap(w=>w.messages).forEach(m=>protectedIds.add(m.id));
 messages.filter(m=>m.direction==='incoming'&&m.seenTurnId===null||r.sharedClock?.status==='active'&&m.sharedActivityId===r.sharedClock.activityId).forEach(m=>protectedIds.add(m.id));
 for(const t of inflight){
  for(const id of [...t.inputMessageIds,...t.activityContext?.messageIds??[],...t.frozenResult?.visibleMessageIds??[],...t.frozenResult?.reconsiderMessageIds??[]]){protectedIds.add(id);if(!messageById.get(id))block(`turn ${t.id}: message ${id} missing`);}
  for(const m of messages.filter(m=>m.turnId===t.id))protectedIds.add(m.id);
  const result=storage.read('post_jobs',t.id)?.result;for(const change of [...result?.shortTermChanges??[],...result?.longTermChanges??[],...result?.detailChanges??[]])for(const id of change.sourceIds??[])protectedIds.add(id);
  if((t.dialogueWindowVersion??1)===1){const b=t.dialogueBinding;if(!b||b.episodeId&&!legacyIds.has(b.episodeId)||b.holdReply&&!b.episodeId){report.legacyInflightErrors.push(t.id);block(`turn ${t.id}: invalid legacy binding`);}}
  else {
   const b=t.chatBinding;if(!b||b.episodeId&&!episodeIds.has(b.episodeId)||b.holdReply&&(!b.episodeId||episodeById.get(b.episodeId)?.status!=='open')||t.outputComplete&&b.holdReply){report.ordinaryAssociationErrors.push(t.id);block(`turn ${t.id}: invalid chat binding`);}
   if(t.activityContext){if(b?.episodeId||b?.holdReply){report.activityErrors.push(t.id);block(`turn ${t.id}: activity holds ordinary chat`);}for(const id of t.activityContext.messageIds)if(messageById.get(id)?.sharedActivityId!==t.activityContext.activityId){report.activityErrors.push(id);block(`activity message ${id}: invalid frozen identity`);}}
  }
 }
 const state=storage.get<import('../types').CharacterState>('character');
 // Opening confirmation precedes committing the candidate character state.
 const confirmedOpening=inflight.some(t=>t.frozenResult?.personal?.sharedChange?.action==='start'&&t.frozenResult.nextState.scene.shared?.activityId===r.sharedClock?.activityId&&storage.outbox(t.id).some(o=>o.seq===0&&o.kind==='narration'&&o.status==='confirmed')&&messageById.get(`${t.id}:out:0`)?.sharedActivityId===r.sharedClock?.activityId);
 if(r.sharedClock?.status==='active'&&state?.scene.shared?.activityId!==r.sharedClock.activityId&&!confirmedOpening){report.activityErrors.push(r.sharedClock.activityId);block('active shared activity identity conflict');}
 const modern=(m:Message)=>[m.turnId,m.seenTurnId].some(id=>id&&turnById.get(id)?.dialogueWindowVersion===2);
 const safelyOutside=(m:Message)=>!protectedIds.has(m.id)&&!modern(m)&&m.chatEpisodeId===undefined&&!!m.dialogueEpisodeId&&legacyIds.has(m.dialogueEpisodeId)&&!!(m.direction==='incoming'?m.seenTurnId&&turnById.get(m.seenTurnId)?.done:m.turnId&&turnById.get(m.turnId)?.done)&&windows.every(w=>w.episodeIds.length>=options.recentSegments&&w.episodeIds.every(id=>Date.parse(episodeById.get(id)!.openedAt)>Date.parse(m.receivedAt)));
 for(const m of messages){
  if(m.sharedActivityId){if(m.chatEpisodeId!==null){report.activityErrors.push(m.id);block(`activity message ${m.id}: chat association must be null`);}continue;}
  if(m.chatEpisodeId&&episodeIds.has(m.chatEpisodeId))continue;
  report.ordinaryAssociationErrors.push(m.id);const reason=`message ${m.id}: missing chat association`;
  if(safelyOutside(m))report.historicalWarnings.push(reason);else block(reason);
 }
 report.protectedMessageIds=[...protectedIds].sort();return report;
}
