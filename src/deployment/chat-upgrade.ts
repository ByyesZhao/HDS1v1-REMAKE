import type {DatabaseSync} from 'node:sqlite';
import {isUnfinishedTurn} from '../storage';
import type {Message,TurnRecord} from '../types';
import type {ChatEpisode,ChatTurnBinding} from '../dialogue/types';
import type {MigrationPlan,DialogueUpgradeParameters} from './dialogue-upgrade';
export function chatUpgradePlan(db:DatabaseSync,base:MigrationPlan,parameters:DialogueUpgradeParameters,now?:string):MigrationPlan {
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
 const rows=<T>(table:string):T[]=>tables.has(table)?db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(r=>JSON.parse(String(r.data)) as T):[];
 const currentVersion=base.runtime?.dialogueContextVersion??null;
 const metadata=rows<{id:string;idleMinutes:number}>('chat_index_metadata').find(row=>row.id==='chat-index');
 const recorded=typeof metadata?.idleMinutes==='number'&&Number.isFinite(metadata.idleMinutes)&&metadata.idleMinutes>0?metadata.idleMinutes:null;
 const rebuilding=currentVersion===2&&parameters.rebuildChatIndex===true&&recorded!==null&&recorded!==parameters.idleMinutes;
 if(currentVersion===2&&!rebuilding){const mismatch=recorded!==parameters.idleMinutes;return {...base,chatEpisodes:[],report:{...base.report,targetVersion:2,idleMinutes:parameters.idleMinutes,recordedIdleMinutes:recorded,rebuildPlanned:false,chatEpisodeCount:rows('chat_episodes').length,ordinaryMessageCount:base.messages.filter(m=>!m.sharedActivityId).length,activityMessageCount:base.messages.filter(m=>!!m.sharedActivityId).length,canApply:!mismatch,ambiguousBoundaries:mismatch?[recorded===null?'普通索引元数据缺失或参数无效；不能用重建标记绕过':'普通索引参数变化；不自动回建']:[]}};}
 const messages=structuredClone(base.messages),turns=structuredClone(base.turns),ambiguities=[...base.report.ambiguousBoundaries],proof=new Map<string,string>(),originalById=new Map(base.messages.map(m=>[m.id,m]));
 if(rebuilding){for(const t of turns.filter(isUnfinishedTurn))ambiguities.push(`unfinished turn ${t.id}: 未完成故事轮，先恢复原参数完成`);const character=tables.has('state')?db.prepare("SELECT data FROM state WHERE key='character'").get():null;const active=base.runtime?.sharedClock?.status==='active'?base.runtime.sharedClock.activityId:character?JSON.parse(String(character.data)).scene?.shared?.activityId:null;if(active)ambiguities.push(`active activity ${active}: 进行中共同活动不允许重建`);}
 const record=(messageId:string,activityId:string)=>{const old=proof.get(messageId);if(old&&old!==activityId)ambiguities.push(`message ${messageId}: conflicting activity 关联`);else proof.set(messageId,activityId);};
 for(const m of messages)if(m.sharedActivityId)record(m.id,m.sharedActivityId);
 for(const t of turns){const activityId=t.sharedMeta?.activityId;const outgoingActivity=activityId??t.frozenResult?.nextState.scene.shared?.activityId;
  if(activityId)for(const id of t.inputMessageIds)record(id,activityId);
  if(outgoingActivity)for(const m of messages.filter(m=>m.direction==='outgoing'&&m.turnId===t.id))record(m.id,outgoingActivity);
 }
 const oldLinks=base.links.length?base.links:rows<import('../dialogue/types').DialogueActivityLink>('dialogue_activity_links');
 const effectiveAt=now??messages.at(-1)?.receivedAt;
 const uncertainWithin=(m:Message)=>oldLinks.find(l=>[[l.evidenceFrom,l.evidenceTo],[l.startedAt,l.endedAt??(l.status==='active'?effectiveAt:null)]].some(([from,to])=>from&&to&&Date.parse(m.receivedAt)>=Date.parse(from)&&Date.parse(m.receivedAt)<=Date.parse(to)));
 for(const m of messages){const activity=proof.get(m.id);if(activity){
   if(m.sharedActivityId!==undefined&&m.sharedActivityId!==activity||rebuilding&&m.sharedActivityId!==activity)ambiguities.push(`message ${m.id}: conflicting explicit activity 关联，不能覆盖显式归属`);
   else {if(!rebuilding)m.sharedActivityId=activity;m.chatEpisodeId=null;}
  }else if(m.sharedActivityId===undefined){const link=uncertainWithin(m);if(link)ambiguities.push(`message ${m.id}: 活动 ${link.id} 跨度内缺可靠归属`);}
 }
 if(base.runtime?.sharedClock?.status==='active'&&!messages.some(m=>m.sharedActivityId===base.runtime!.sharedClock!.activityId))ambiguities.push(`active activity ${base.runtime.sharedClock.activityId}: 无可靠消息关联`);
 const episodes:ChatEpisode[]=[],idleMs=parameters.idleMinutes*60000;let current:ChatEpisode|undefined;
 const ordinaryTurn=(t:TurnRecord)=>!t.sharedMeta&&t.entryMode==='chat'&&!messages.some(m=>m.turnId===t.id&&!!m.sharedActivityId);
 const heldOldIds=new Set(turns.filter(t=>isUnfinishedTurn(t)&&ordinaryTurn(t)&&!t.outputComplete&&t.dialogueBinding?.holdReply).map(t=>t.dialogueBinding!.episodeId).filter((id):id is string=>!!id));
 const chatByOldId=new Map<string,ChatEpisode>();
 const episodeByInput=new Map<string,ChatEpisode>();
 const bindingKey=rebuilding?'chatEpisodeId':'dialogueEpisodeId';
 // Confirmed replies prove the original generation/send hold interval, even after the turn completes.
 const replyHolds:Array<{sourceId:string;inputId:string;from:number;to:number}>=[];
 for(const t of turns.filter(t=>t.entryMode==='chat'&&!t.sharedMeta)){
  const outputs=base.messages.filter(m=>m.direction==='outgoing'&&m.turnId===t.id&&!m.sharedActivityId&&m[bindingKey]);
  for(const sourceId of new Set(outputs.map(m=>m[bindingKey]!))){
   const inputs=t.inputMessageIds.map(id=>originalById.get(id)).filter((m):m is Message=>!!m&&!m.sharedActivityId&&m[bindingKey]===sourceId).sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt));
   const anchor=inputs.at(-1);
   if(anchor)replyHolds.push({sourceId,inputId:anchor.id,from:Math.max(Date.parse(t.at),Date.parse(anchor.receivedAt)),to:Math.max(...outputs.filter(m=>m[bindingKey]===sourceId).map(m=>Date.parse(m.receivedAt)))});
  }
 }
 for(const m of messages.filter(m=>!m.sharedActivityId)){
  const at=Date.parse(m.receivedAt),t=m.direction==='outgoing'&&m.turnId?turns.find(t=>t.id===m.turnId):undefined;
  // Only reliable old ordinary reply bindings bridge generation/segmented send gaps.
  const boundInput=t&&!t.sharedMeta?t.inputMessageIds.map(id=>originalById.get(id)).find(i=>i&&!i.sharedActivityId&&i[bindingKey]&&i[bindingKey]===originalById.get(m.id)?.[bindingKey]):undefined;
  const heldEpisode=boundInput?episodeByInput.get(boundInput.id):undefined;
  const oldHold=m.dialogueEpisodeId&&heldOldIds.has(m.dialogueEpisodeId)?chatByOldId.get(m.dialogueEpisodeId):undefined;
  const heldInterval=current&&replyHolds.some(h=>h.sourceId===originalById.get(m.id)?.[bindingKey]&&at>=h.from&&at<=h.to&&episodeByInput.get(h.inputId)===current);
  if(heldEpisode&&heldEpisode===current||oldHold&&oldHold===current||heldInterval){/* preserve the current ordinary reply hold */}
  else if(!current||at-Date.parse(current.lastInteractionAt)>=idleMs){if(current){current.status='closed';current.closedAt=new Date(Date.parse(current.lastInteractionAt)+idleMs).toISOString();current.closeReason='migration';}current={id:`chat:legacy:${m.id}`,openedAt:m.receivedAt,lastInteractionAt:m.receivedAt,status:'open',closedAt:null,closeReason:null};episodes.push(current);}
  current!.lastInteractionAt=m.receivedAt;m.chatEpisodeId=current!.id;episodeByInput.set(m.id,current!);if(m.dialogueEpisodeId)chatByOldId.set(m.dialogueEpisodeId,current!);
 }
 const oldEpisodeIds=new Set((base.episodes.length?base.episodes:rows<ChatEpisode>('dialogue_episodes')).map(e=>e.id));
 const inflightBindings:Array<{turnId:string;binding:ChatTurnBinding|null}>=[];
 for(const t of turns.filter(isUnfinishedTurn)){
  if(t.inputMessageIds.some(id=>!messages.some(m=>m.id===id)))ambiguities.push(`turn ${t.id}: missing input 关联`);
  if(!t.dialogueBinding||t.dialogueBinding.episodeId&&!oldEpisodeIds.has(t.dialogueBinding.episodeId))ambiguities.push(`turn ${t.id}: invalid legacy binding 关联`);
  const ordinary=ordinaryTurn(t);
  const evidence=ordinary?messages.filter(m=>!m.sharedActivityId&&(m.turnId===t.id||t.inputMessageIds.includes(m.id))).at(-1):undefined;
  const episode=evidence?episodes.find(e=>e.id===evidence.chatEpisodeId):undefined;
  const holdReply=!!episode&&!t.outputComplete&&!!t.dialogueBinding?.holdReply;
  if(holdReply&&episode.status!=='open')ambiguities.push(`turn ${t.id}: 普通保持映射到已关闭段，关联不明确`);
  t.chatBinding={episodeId:episode?.id??null,holdReply};inflightBindings.push({turnId:t.id,binding:t.chatBinding});
 }
 if(current&&now&&Date.parse(now)>=Date.parse(current.lastInteractionAt)+idleMs&&!inflightBindings.some(b=>b.binding?.episodeId===current!.id&&b.binding.holdReply)){current.status='closed';current.closedAt=new Date(Date.parse(current.lastInteractionAt)+idleMs).toISOString();current.closeReason='migration';}
 const runtime=base.runtime?{...base.runtime,dialogueContextVersion:2 as const,activeChatEpisodeId:episodes.find(e=>e.status==='open')?.id??null}:null;
 return {...base,messages,turns,chatEpisodes:episodes,runtime,report:{...base.report,targetVersion:2,idleMinutes:parameters.idleMinutes,recordedIdleMinutes:recorded,rebuildPlanned:rebuilding,chatEpisodeCount:episodes.length,ordinaryMessageCount:messages.filter(m=>!m.sharedActivityId).length,activityMessageCount:messages.filter(m=>!!m.sharedActivityId).length,inflightBindings,ambiguousBoundaries:[...new Set(ambiguities)],canApply:!!runtime&&(currentVersion===null?base.report.canApply:currentVersion===1||rebuilding)&&ambiguities.length===0}};
}
