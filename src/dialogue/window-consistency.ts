import {isUnfinishedTurn,type Storage} from '../storage';
import {ChatEpisodes} from './chat-episodes';
import {DialogueStore} from './store';
import type {WindowConsistencyReport} from './types';
import type {Message} from '../types';
export function checkWindowConsistency(storage:Storage,options:{idleMinutes:number;recentSegments:number}):WindowConsistencyReport {
 const r=storage.runtime(),store=new DialogueStore(storage),chat=new ChatEpisodes(store,options.idleMinutes),episodes=store.chatEpisodes(),episodeIds=new Set(episodes.map(e=>e.id)),messages=storage.messages(),turns=storage.all('turns'),inflight=turns.filter(isUnfinishedTurn);
 const report:WindowConsistencyReport={version:r.dialogueContextVersion??null,ordinaryAssociationErrors:[],activityErrors:[],legacyInflightErrors:[],blockingIssues:[],historicalWarnings:[],protectedMessageIds:[]};
 const block=(reason:string)=>report.blockingIssues.push(reason),protectedIds=new Set<string>();
 if(report.version!==2)block('chat version requires explicit migration');
 if(storage.read('chat_index_metadata','chat-index')?.idleMinutes!==options.idleMinutes)block('chat idle parameter requires explicit migration');
 const open=episodes.filter(e=>e.status==='open');
 if(open.length>1||open.length===1&&open[0].id!==r.activeChatEpisodeId||r.activeChatEpisodeId&&!open.some(e=>e.id===r.activeChatEpisodeId)){report.ordinaryAssociationErrors.push('activeChatEpisodeId');block('active chat episode conflict');}
 const visibleIds=[...new Set(inflight.flatMap(t=>t.inputMessageIds)),...messages.filter(m=>m.direction==='incoming'&&m.seenTurnId===null).map(m=>m.id)];
 const windows=['narrative','narrative_shared','personal','expression','memory'].map(phase=>chat.recent(phase,new Date().toISOString(),options.recentSegments,visibleIds));
 windows.flatMap(w=>w.messages).forEach(m=>protectedIds.add(m.id));
 messages.filter(m=>m.direction==='incoming'&&m.seenTurnId===null||r.sharedClock?.status==='active'&&m.sharedActivityId===r.sharedClock.activityId).forEach(m=>protectedIds.add(m.id));
 for(const task of storage.all('tasks').filter(t=>t.status==='pending'))for(const id of task.messageIds??[])protectedIds.add(id);
 for(const table of ['memories','details','learned_background'] as const)if(storage.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))for(const row of storage.prepare(`SELECT data FROM ${table}`).all()){const memory=JSON.parse(String(row.data));for(const id of memory.sourceIds??[])protectedIds.add(id);}
 const legacyIds=new Set(store.episodes().map(e=>e.id));
 for(const t of inflight){
  for(const id of [...t.inputMessageIds,...t.activityContext?.messageIds??[],...t.frozenResult?.visibleMessageIds??[],...t.frozenResult?.reconsiderMessageIds??[]]){protectedIds.add(id);if(!storage.read('messages',id))block(`turn ${t.id}: message ${id} missing`);}
  for(const m of messages.filter(m=>m.turnId===t.id))protectedIds.add(m.id);
  const result=storage.read('post_jobs',t.id)?.result;for(const change of [...result?.shortTermChanges??[],...result?.longTermChanges??[],...result?.detailChanges??[]])for(const id of change.sourceIds??[])protectedIds.add(id);
  if((t.dialogueWindowVersion??1)===1){const b=t.dialogueBinding;if(!b||b.episodeId&&!legacyIds.has(b.episodeId)||b.holdReply&&!b.episodeId){report.legacyInflightErrors.push(t.id);block(`turn ${t.id}: invalid legacy binding`);}}
  else {
   const b=t.chatBinding;if(!b||b.episodeId&&!episodeIds.has(b.episodeId)||b.holdReply&&(!b.episodeId||store.chatEpisode(b.episodeId)?.status!=='open')||t.outputComplete&&b.holdReply){report.ordinaryAssociationErrors.push(t.id);block(`turn ${t.id}: invalid chat binding`);}
   if(t.activityContext){if(b?.episodeId||b?.holdReply){report.activityErrors.push(t.id);block(`turn ${t.id}: activity holds ordinary chat`);}for(const id of t.activityContext.messageIds)if(storage.read('messages',id)?.sharedActivityId!==t.activityContext.activityId){report.activityErrors.push(id);block(`activity message ${id}: invalid frozen identity`);}}
  }
 }
 const state=storage.get<import('../types').CharacterState>('character');if(r.sharedClock?.status==='active'&&state?.scene.shared?.activityId!==r.sharedClock.activityId){report.activityErrors.push(r.sharedClock.activityId);block('active shared activity identity conflict');}
 const modern=(m:Message)=>[m.turnId,m.seenTurnId].some(id=>id&&storage.read('turns',id)?.dialogueWindowVersion===2);
 const safelyOutside=(m:Message)=>!protectedIds.has(m.id)&&!modern(m)&&m.chatEpisodeId===undefined&&!!m.dialogueEpisodeId&&legacyIds.has(m.dialogueEpisodeId)&&!!(m.direction==='incoming'?m.seenTurnId&&storage.read('turns',m.seenTurnId)?.done:m.turnId&&storage.read('turns',m.turnId)?.done)&&windows.every(w=>w.episodeIds.length>=options.recentSegments&&w.episodeIds.every(id=>Date.parse(store.chatEpisode(id)!.openedAt)>Date.parse(m.receivedAt)));
 for(const m of messages){
  if(m.sharedActivityId){if(m.chatEpisodeId!==null){report.activityErrors.push(m.id);block(`activity message ${m.id}: chat association must be null`);}continue;}
  if(m.chatEpisodeId&&episodeIds.has(m.chatEpisodeId))continue;
  report.ordinaryAssociationErrors.push(m.id);const reason=`message ${m.id}: missing chat association`;
  if(safelyOutside(m))report.historicalWarnings.push(reason);else block(reason);
 }
 report.protectedMessageIds=[...protectedIds].sort();return report;
}
