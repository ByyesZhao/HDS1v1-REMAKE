import { DatabaseSync } from 'node:sqlite';
import {chatUpgradePlan} from './chat-upgrade';
import { copyFileSync,existsSync,mkdirSync } from 'node:fs';
import { basename,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Storage,isUnfinishedTurn } from '../storage';
import type { Message,Runtime,TurnRecord } from '../types';
import type { DialogueEpisode,DialogueActivityLink,DialogueTurnBinding } from '../dialogue/types';
export interface DialogueUpgradeParameters {idleMinutes:number;targetVersion:1|2;configSource?:string}
export interface DialogueUpgradeReport {targetVersion?:1|2;idleMinutes?:number;configSource?:string;chatEpisodeCount?:number;ordinaryMessageCount?:number;activityMessageCount?:number;version:number|null;messageCount:number;episodeCount:number;activityCount:number;ambiguousBoundaries:string[];inflightBindings:Array<{turnId:string;binding:DialogueTurnBinding|null}>;canApply:boolean;backupPath:string|null}
export interface MigrationPlan {chatEpisodes?:import('../dialogue/types').ChatEpisode[];report:DialogueUpgradeReport;messages:Message[];episodes:DialogueEpisode[];links:DialogueActivityLink[];turns:TurnRecord[];runtime:Runtime|null}
function legacyPlan(db:DatabaseSync,now?:string,idleMinutes=15):MigrationPlan {
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
 const rows=<T>(table:string):T[]=>tables.has(table)?db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(r=>JSON.parse(String(r.data)) as T):[];
 const row=tables.has('state')?db.prepare("SELECT data FROM state WHERE key='runtime'").get():null;
 const runtime=row?JSON.parse(String(row.data)) as Runtime:null,version=runtime?.dialogueContextVersion??null;
 const messages=rows<Message>('messages').sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt)||(a.id<b.id?-1:a.id>b.id?1:0)),turns=rows<TurnRecord>('turns');
 if(version===1||version===2)return {report:{version,messageCount:messages.length,episodeCount:rows('dialogue_episodes').length,activityCount:rows('dialogue_activity_links').length,ambiguousBoundaries:[],inflightBindings:turns.filter(isUnfinishedTurn).map(t=>({turnId:t.id,binding:t.dialogueBinding??null})),canApply:true,backupPath:null},messages,episodes:[],links:[],turns,runtime};
 const activity=new Map<string,string>();
 for(const t of turns){const id=t.sharedMeta?.activityId??t.frozenResult?.nextState.scene.shared?.activityId;if(id){for(const mid of t.inputMessageIds)activity.set(mid,id);for(const m of messages)if(m.turnId===t.id)activity.set(m.id,id);}}
 const spans=new Map<string,{from:number;to:number}>();
 for(const m of messages){const id=m.sharedActivityId??activity.get(m.id);if(id){const at=Date.parse(m.receivedAt),span=spans.get(id);spans.set(id,{from:Math.min(span?.from??at,at),to:Math.max(span?.to??at,at)});}}
 const episodes:DialogueEpisode[]=[],links:DialogueActivityLink[]=[],ambiguities:string[]=[];let current:DialogueEpisode|undefined;
 const idleMs=idleMinutes*60000;
 for(const m of messages){const at=Date.parse(m.receivedAt),previous=current?Date.parse(current.lastInteractionAt):at;const spansGap=[...spans.values()].some(s=>s.from<=previous&&s.to>=at);
  if(!current||at-previous>=idleMs&&!spansGap){if(current){current.status='closed';current.closeReason='migration';current.closedAt=new Date(previous+idleMs).toISOString();}current={id:`dialogue:legacy:${m.id}`,openedAt:m.receivedAt,lastInteractionAt:m.receivedAt,status:'open',closedAt:null,closeReason:null};episodes.push(current);}
  m.dialogueEpisodeId=current.id;current.lastInteractionAt=m.receivedAt;
 }
 for(const [id,span] of spans){const sample=messages.find(m=>(m.sharedActivityId??activity.get(m.id))===id)!;const active=runtime?.sharedClock?.status==='active'&&runtime.sharedClock.activityId===id;links.push({id,episodeId:sample.dialogueEpisodeId!,status:active?'active':'legacy_span',startedAt:active?runtime!.sharedClock!.startedAt:null,endedAt:null,evidenceFrom:new Date(span.from).toISOString(),evidenceTo:new Date(span.to).toISOString()});}
 if(runtime?.sharedClock?.status==='active'&&!links.some(l=>l.id===runtime.sharedClock!.activityId))ambiguities.push(`active activity ${runtime.sharedClock.activityId}: 无可靠消息关联`);
 const inflightBindings=turns.filter(isUnfinishedTurn).map(t=>{const ids=new Set(t.inputMessageIds.map(id=>messages.find(m=>m.id===id)?.dialogueEpisodeId));const activityId=t.sharedMeta?.activityId;const activeLink=activityId?links.find(l=>l.id===activityId):undefined;const outgoing=messages.filter(m=>m.turnId===t.id).at(-1);
  let episodeId=activeLink?.episodeId??outgoing?.dialogueEpisodeId??(ids.size===1?[...ids][0]:undefined)??null;
  const needs=t.inputMessageIds.length>0||!!activityId;
  if(needs&&(!episodeId||t.inputMessageIds.some(id=>!messages.some(m=>m.id===id)))){ambiguities.push(`turn ${t.id}: 无法可靠绑定段关联`);return {turnId:t.id,binding:null};}
  const binding={episodeId,holdReply:!t.outputComplete&&episodeId!==null};t.dialogueBinding=binding;return {turnId:t.id,binding};
 });
 if(current&&now&&Date.parse(now)>=Date.parse(current.lastInteractionAt)+idleMs&&!inflightBindings.some(b=>b.binding?.episodeId===current!.id&&b.binding.holdReply)&&!links.some(l=>l.episodeId===current!.id&&l.status==='active')){current.status='closed';current.closedAt=new Date(Date.parse(current.lastInteractionAt)+idleMs).toISOString();current.closeReason='migration';}
 return {report:{version,messageCount:messages.length,episodeCount:episodes.length,activityCount:links.length,ambiguousBoundaries:ambiguities,inflightBindings,canApply:version===null&&!!runtime&&ambiguities.length===0,backupPath:null},messages,episodes,links,turns,runtime};
}
function plan(db:DatabaseSync,now:string|undefined,parameters:DialogueUpgradeParameters):MigrationPlan {
 if(!Number.isFinite(parameters.idleMinutes)||parameters.idleMinutes<=0)throw new Error('idleMinutes must be positive');
 const base=legacyPlan(db,now,parameters.idleMinutes);
 if(base.report.version===null&&base.runtime)base.runtime={...base.runtime,activeDialogueEpisodeId:base.episodes.find(e=>e.status==='open')?.id??null};
 const result=parameters.targetVersion===2?chatUpgradePlan(db,base,parameters,now):base;
 result.report={...result.report,targetVersion:parameters.targetVersion,idleMinutes:parameters.idleMinutes,configSource:parameters.configSource??'explicit',ordinaryMessageCount:result.report.ordinaryMessageCount??result.messages.filter(m=>!m.sharedActivityId).length,activityMessageCount:result.report.activityMessageCount??result.messages.filter(m=>!!m.sharedActivityId).length};
 if(parameters.targetVersion===1&&result.report.version===2){result.report.canApply=false;result.report.ambiguousBoundaries=['version2 cannot downgrade'];}
 return result;
}
export function inspectDialogueUpgrade(path:string,parameters:DialogueUpgradeParameters={idleMinutes:15,targetVersion:1}):DialogueUpgradeReport {const db=new DatabaseSync(path,{readOnly:true});try{return plan(db,undefined,parameters).report;}finally{db.close();}}
export function upgradeDialogue(path:string,now:string,options:{stopped:boolean;backupDirectory:string;idleMinutes?:number;targetVersion?:1|2;configSource?:string}):DialogueUpgradeReport {
 if(!options.stopped)throw new Error('Stop HDSI and SnowLuma before --apply; supply --stopped.');
 const parameters:DialogueUpgradeParameters={idleMinutes:options.idleMinutes??15,targetVersion:options.targetVersion??1,configSource:options.configSource};
 const before=inspectDialogueUpgrade(path,parameters);if(!before.canApply)throw new Error(`dialogue binding 关联不明确: ${before.ambiguousBoundaries.join('; ')}`);
 if(before.version===parameters.targetVersion)return before;
 const backupPath=join(options.backupDirectory,`dialogue-${now.replace(/[^\d]/g,'')}-${randomUUID()}`);mkdirSync(backupPath,{recursive:true});for(const suffix of ['','-wal','-shm'])if(existsSync(path+suffix))copyFileSync(path+suffix,join(backupPath,basename(path)+suffix));
 const db=new DatabaseSync(path);try{db.exec('BEGIN IMMEDIATE');try{const p=plan(db,now,parameters);if(!p.report.canApply)throw new Error('dialogue changed: ambiguous binding');for(const table of ['dialogue_episodes','dialogue_activity_links','chat_episodes','chat_index_metadata'])db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`);
 const save=(table:string,id:string,row:unknown)=>db.prepare(`INSERT INTO ${table}(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(id,JSON.stringify(row));
 for(const m of p.messages)save('messages',m.id,m);for(const e of p.episodes)save('dialogue_episodes',e.id,e);for(const l of p.links)save('dialogue_activity_links',l.id,l);for(const t of p.turns.filter(isUnfinishedTurn))save('turns',t.id,t);
 if(parameters.targetVersion===2){for(const e of p.chatEpisodes??[])save('chat_episodes',e.id,e);save('chat_index_metadata','chat-index',{id:'chat-index',idleMinutes:parameters.idleMinutes});}
 db.prepare("UPDATE state SET data=? WHERE key='runtime'").run(JSON.stringify({...p.runtime,dialogueContextVersion:parameters.targetVersion}));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}finally{db.close();}
 return {...inspectDialogueUpgrade(path,parameters),backupPath};
}
export function ensureDialogueVersion(storage:Storage):void {if(storage.runtime().dialogueContextVersion!==1)throw new Error('Stop HDSI; run npm run dialogue:migrate -- --database <path> --check, then --apply --stopped --backup-dir <path>.');}
