import {ActivityContextError} from './errors';
import type {Storage} from '../storage';
import {auditWindowSnapshot,checkWindowConsistency} from './window-consistency';
import {DialogueStore} from './store';
import type {ActiveWindowScope,WindowConsistencyReport} from './types';
import type {Message,TurnRecord} from '../types';
export type WindowOptions={idleMinutes:number;recentSegments:number};
const checked=new WeakMap<Storage,WindowOptions>();
const empty:ActiveWindowScope={touchedMessageIds:[],requiredMessageIds:[],sourceIds:[],touchedEpisodeIds:[]};
export function windowOptions(storage:Storage):WindowOptions{return checked.get(storage)??{idleMinutes:storage.read('chat_index_metadata','chat-index')?.idleMinutes??15,recentSegments:4};}
export function checkActiveWindowConsistency(storage:Storage,options:WindowOptions,scope:ActiveWindowScope,metadataOnly=false):WindowConsistencyReport{
 const store=new DialogueStore(storage),inflight=storage.unfinishedTurns(),episodes=new Map(store.openChatEpisodes().map(e=>[e.id,e]));
 const messages=new Map<string,Message>(),required=new Set(scope.requiredMessageIds),sources=new Set(scope.sourceIds);
 const add=(rows:Message[])=>rows.forEach(m=>messages.set(m.id,m));
 add(storage.unseenIncomingMessages());
 for(const e of episodes.values())add(storage.messagesByChatEpisode(e.id));
 const clock=storage.runtime().sharedClock;if(clock?.status==='active')add(storage.messagesByActivity(clock.activityId));
 for(const row of storage.prepare("SELECT data FROM tasks WHERE json_extract(data,'$.status')='pending' ORDER BY rowid").all())for(const id of JSON.parse(String(row.data)).messageIds??[])sources.add(id);
 for(const t of inflight){
 for(const id of [...t.inputMessageIds,...t.activityContext?.messageIds??[],...t.frozenResult?.visibleMessageIds??[],...t.frozenResult?.reconsiderMessageIds??[]])required.add(id);
 add(storage.messagesByTurn(t.id));
 const result=storage.read('post_jobs',t.id)?.result;for(const change of [...result?.shortTermChanges??[],...result?.longTermChanges??[],...result?.detailChanges??[]])for(const id of change.sourceIds??[])sources.add(id);
 if(t.chatBinding?.episodeId){const e=store.chatEpisode(t.chatBinding.episodeId);if(e)episodes.set(e.id,e);}
 }
 add(metadataOnly?storage.messageMetadataByIds([...required,...sources,...scope.touchedMessageIds]):storage.messagesByIds([...required,...sources,...scope.touchedMessageIds]));
 for(const id of [...scope.touchedEpisodeIds,...[...messages.values()].flatMap(m=>m.chatEpisodeId?[m.chatEpisodeId]:[])])if(!episodes.has(id)){const e=store.chatEpisode(id);if(e)episodes.set(id,e);}
 const turns=new Map(inflight.map(t=>[t.id,t])),legacyIds=new Set<string>();
 for(const t of inflight)if(t.dialogueBinding?.episodeId&&store.episode(t.dialogueBinding.episodeId))legacyIds.add(t.dialogueBinding.episodeId);
 for(const m of messages.values())for(const id of [m.turnId,m.seenTurnId])if(id&&!turns.has(id)){const t=storage.read('turns',id);if(t)turns.set(id,t);}
 const report=auditWindowSnapshot(storage,options,{messages:[...messages.values()],episodes:[...episodes.values()],turns:[...turns.values()],legacyIds,protectedSourceIds:[...sources,...required,...scope.touchedMessageIds],active:true});
 for(const id of required)if(!messages.has(id)&&!report.blockingIssues.some(s=>s.includes('message '+id+' missing')))report.blockingIssues.push('required message '+id+' missing');
 return report;
}
function assertReport(report:WindowConsistencyReport):void{if(report.blockingIssues.length){if(report.activityErrors.length)throw new ActivityContextError('activity context: '+report.blockingIssues.join('; '));throw Error('chat 对话段索引不一致: '+report.blockingIssues.join('; '));}}
export function assertActiveWindow(storage:Storage,scope:Partial<ActiveWindowScope>={},options=windowOptions(storage)):void{
 if(storage.runtime().dialogueContextVersion!==2)return;assertReport(checkActiveWindowConsistency(storage,options,{...empty,...scope}));
}
export function assertFullWindow(storage:Storage,options=windowOptions(storage)):WindowConsistencyReport{
 const report=checkWindowConsistency(storage,options);assertReport(report);checked.set(storage,{...options});return report;
}
export function assertRoutineWindow(storage:Storage,options:WindowOptions):void{
 const old=checked.get(storage);if(!old||old.idleMinutes!==options.idleMinutes||old.recentSegments!==options.recentSegments)assertFullWindow(storage,options);else assertActiveWindow(storage,{},options);
}

export function assertMessageSources(storage:Storage,ids:readonly string[]):void{
 if(storage.runtime().dialogueContextVersion!==2||!ids.length)return;
 const actual=storage.messagesByIds(ids);if(actual.length)assertActiveWindow(storage,{sourceIds:actual.map(m=>m.id)});
}

// The same audit kernel checks provenance associations without loading historical bodies.
export function captureMessageSourceValidity(storage:Storage,ids:readonly string[]):string[]{
 if(storage.runtime().dialogueContextVersion!==2||!ids.length)return [];
 const actual=storage.messageMetadataByIds(ids);if(!actual.length)return [];
 const report=checkActiveWindowConsistency(storage,windowOptions(storage),{...empty,sourceIds:actual.map(m=>m.id)},true);
 const bad=actual.filter(m=>report.blockingIssues.some(reason=>reason.includes('message '+m.id+':'))).map(m=>m.id);
 const global=report.blockingIssues.some(reason=>!bad.some(id=>reason.includes('message '+id+':')));
 return global?actual.map(m=>m.id):bad;
}
