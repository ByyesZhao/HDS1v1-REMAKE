import {recentChatSnapshot} from './dialogue/chat-sql';
import type {ChatWindowQuery,ChatWindowSnapshot} from './dialogue/types';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { nextDaily } from './time';
import type { EnvironmentBatch,EnvironmentStep } from './environment/types';
import type { SchoolPlan,SchoolPlanItem,SchoolInstance,SchoolNotice,SchoolKnowledge,SchoolProgress,SchoolWeek } from './school/types';
import type { CharacterState, ControlRequest, Detail, DetailHistory, EnvironmentEvent, Experience, Memory, Message, OutboxItem, PostJob, Runtime, ScheduledTask, Sticker, TurnRecord } from './types';

interface Tables {
  dialogue_episodes:import('./dialogue/types').DialogueEpisode;dialogue_activity_links:import('./dialogue/types').DialogueActivityLink;
  chat_episodes:import('./dialogue/types').ChatEpisode;chat_index_metadata:import('./dialogue/types').ChatIndexMetadata;
  messages: Message; turns: TurnRecord; outbox: OutboxItem; post_jobs: PostJob;
  tasks: ScheduledTask; details: Detail; detail_history: DetailHistory; memories: Memory;
  events: EnvironmentEvent; experiences: Experience; stickers: Sticker;
  control_requests: ControlRequest;
  environment_batches:EnvironmentBatch;environment_steps:EnvironmentStep;
  school_plans:SchoolPlan;school_plan_items:SchoolPlanItem;school_instances:SchoolInstance;school_notices:SchoolNotice;school_knowledge:SchoolKnowledge;school_progress:SchoolProgress;school_weeks:SchoolWeek;
}
const tables: Array<keyof Tables> = ['messages', 'turns', 'outbox', 'post_jobs', 'tasks', 'details', 'detail_history', 'memories', 'events', 'experiences', 'stickers', 'control_requests'];
export const isUnfinishedTurn=(t:TurnRecord)=>!t.done&&t.legacyDisposition!=='superseded';
export const environmentTables = ['environment_batches','environment_steps','school_plans','school_plan_items','school_instances','school_notices','school_knowledge','school_progress','school_weeks'] as const;
tables.push(...environmentTables,'dialogue_episodes','dialogue_activity_links','chat_episodes','chat_index_metadata');
export class Storage {
  private readonly db: DatabaseSync;
  constructor(path: string,options:{readOnly?:boolean;dialogueIdleMinutes?:number}={}) {
    if (!options.readOnly&&path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path,{readOnly:options.readOnly??false});
    this.db.function('hdsi_epoch_ms',{deterministic:true},value=>{const n=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(n)?n:null;});
    if(options.readOnly)return;
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    this.db.exec('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, data TEXT NOT NULL)');
    for (const table of tables) this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS message_batch ON messages(json_extract(data, '$.batchId'));
      CREATE INDEX IF NOT EXISTS message_unread ON messages(json_extract(data, '$.direction'), json_extract(data, '$.seenTurnId'), json_extract(data, '$.receivedAt'));
      CREATE INDEX IF NOT EXISTS task_due ON tasks(json_extract(data, '$.status'), json_extract(data, '$.at'));
      CREATE INDEX IF NOT EXISTS turn_unfinished ON turns(json_extract(data, '$.done'));
      CREATE INDEX IF NOT EXISTS memory_time ON memories(json_extract(data, '$.kind'), json_extract(data, '$.createdAt'));
      CREATE UNIQUE INDEX IF NOT EXISTS outbox_sequence ON outbox(json_extract(data, '$.turnId'), json_extract(data, '$.seq'));
      CREATE INDEX IF NOT EXISTS turn_active_work ON turns(COALESCE(json_extract(data,'$.done'),0)) WHERE COALESCE(json_extract(data,'$.done'),0)=0 AND COALESCE(json_extract(data,'$.legacyDisposition'),'')!='superseded';
      CREATE INDEX IF NOT EXISTS message_turn ON messages(json_extract(data,'$.turnId'));
      CREATE INDEX IF NOT EXISTS message_chat ON messages(json_extract(data,'$.chatEpisodeId'));
      CREATE INDEX IF NOT EXISTS message_chat_rank ON messages(json_extract(data,'$.chatEpisodeId'),json_extract(data,'$.receivedAt')) WHERE COALESCE(json_extract(data,'$.sharedActivityId'),'')='' AND COALESCE(json_extract(data,'$.chatEpisodeId'),'')!='' AND (json_extract(data,'$.direction')='outgoing' OR COALESCE(json_type(data,'$.seenTurnId'),'missing')!='null');
      CREATE INDEX IF NOT EXISTS message_activity ON messages(json_extract(data,'$.sharedActivityId'));
      CREATE INDEX IF NOT EXISTS chat_open ON chat_episodes(json_extract(data,'$.status'));
      CREATE UNIQUE INDEX IF NOT EXISTS post_turn ON post_jobs(json_extract(data, '$.turnId'));
    `);
    if (!this.get('runtime')) {this.save('chat_index_metadata','chat-index',{id:'chat-index',idleMinutes:options.dialogueIdleMinutes??15});this.set('runtime', {
      openBatch: null, pendingBatchIds: [], paused: false, contactMisses: 0, stickerMisses: 0,
      nextWorldAt: null, nextSchoolAt: null, nextMaintenanceAt: nextDaily(new Date().toISOString(), ['04:30'], 'Asia/Shanghai'), lastError: null,
      dialogueContextVersion:2,activeDialogueEpisodeId:null,activeChatEpisodeId:null,
      sharedActivityVersion: 1, sharedClock: null,
      environmentPlanningVersion:1,nextEnvironmentAt:null,
    } satisfies Runtime);}

  }
  close(): void { this.db.close(); }
  prepare(sql: string) { return this.db.prepare(sql); }
  pragmas(): { journalMode: string; synchronous: number } {
    return { journalMode: String(this.db.prepare('PRAGMA journal_mode').get()!.journal_mode), synchronous: Number(this.db.prepare('PRAGMA synchronous').get()!.synchronous) };
  }
  transaction<T>(fn: () => T extends Promise<unknown> ? never : T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result as T; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get<T>(key: string): T | null {
    const row = this.db.prepare('SELECT data FROM state WHERE key = ?').get(key);
    return row ? JSON.parse(String(row.data)) as T : null;
  }
  set(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO state(key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data').run(key, JSON.stringify(value));
  }
  read<K extends keyof Tables>(table: K, id: string): Tables[K] | null {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id);
    return row ? JSON.parse(String(row.data)) as Tables[K] : null;
  }
  all<K extends keyof Tables>(table: K): Tables[K][] {
    return this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(String(row.data)) as Tables[K]);
  }
  save<K extends keyof Tables>(table: K, id: string, value: Tables[K]): void {
    this.db.prepare(`INSERT INTO ${table}(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`).run(id, JSON.stringify(value));
  }
  remove<K extends keyof Tables>(table: K, id: string): void { this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id); }
  runtime(): Runtime { const r = this.get<Runtime>('runtime')!; return { ...r, dialogueContextVersion:r.dialogueContextVersion??null,activeDialogueEpisodeId:r.activeDialogueEpisodeId??null,activeChatEpisodeId:r.activeChatEpisodeId??null, sharedActivityVersion: r.sharedActivityVersion ?? null, sharedClock: r.sharedClock ?? null,environmentPlanningVersion:r.environmentPlanningVersion??null,nextEnvironmentAt:r.nextEnvironmentAt??null,memoryCapacityVersion:r.memoryCapacityVersion??null,memoryIdle:r.memoryIdle??null }; }
  character(): CharacterState { return this.get<CharacterState>('character')!; }
  messages(): Message[] { return this.all('messages').sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)); }
  private messageQuery(where:string,args:readonly any[]=[]):Message[]{return this.db.prepare('SELECT data FROM messages WHERE '+where+' ORDER BY rowid').all(...args).map(r=>JSON.parse(String(r.data)) as Message).sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt));}
  unseenIncomingMessages():Message[]{return this.messageQuery("json_extract(data,'$.direction')='incoming' AND json_type(data,'$.seenTurnId')='null' AND json_extract(data,'$.seenTurnId') IS NULL");}
  unreadActivityMessages(activityId:string):Message[]{return this.messageQuery("json_extract(data,'$.direction')='incoming' AND json_type(data,'$.seenTurnId')='null' AND json_extract(data,'$.seenTurnId') IS NULL AND json_type(data,'$.batchId')='null' AND json_extract(data,'$.sharedActivityId')=?",[activityId]);}
  messagesByTurn(id:string):Message[]{return this.messageQuery("json_extract(data,'$.turnId')=?",[id]);}
  messagesByChatEpisode(id:string):Message[]{return this.messageQuery("json_extract(data,'$.chatEpisodeId')=?",[id]);}
  messagesByActivity(id:string):Message[]{return this.messageQuery("json_extract(data,'$.sharedActivityId')=?",[id]);}
  messagesByIds(ids:readonly string[]):Message[]{
    const unique=[...new Set(ids)],rows:Array<Record<string,any>>=[];
    for(let i=0;i<unique.length;i+=500){const chunk=unique.slice(i,i+500);rows.push(...this.db.prepare('SELECT rowid,data FROM messages WHERE id IN ('+chunk.map(()=>'?').join(',')+')').all(...chunk));}
    return rows.sort((a,b)=>Number(a.rowid)-Number(b.rowid)).map(r=>JSON.parse(String(r.data)) as Message).sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt));
  }
  recentChatSnapshot(options:ChatWindowQuery):ChatWindowSnapshot{return recentChatSnapshot(this,options);}
  unreadMessages(): Message[] {
    const open=this.runtime().openBatch?.id;
    return this.messageQuery("json_extract(data,'$.direction')='incoming' AND json_type(data,'$.seenTurnId')='null' AND json_extract(data,'$.seenTurnId') IS NULL AND NOT (COALESCE(json_extract(data,'$.sharedActivityId'),'')!='' AND COALESCE(json_type(data,'$.batchId')='null',0)) AND "+(open===undefined?"json_type(data,'$.batchId') IS NOT NULL":"json_extract(data,'$.batchId') IS NOT ?"),open===undefined?[]:[open]);
  }
  unfinishedTurns():TurnRecord[]{return this.db.prepare("SELECT data FROM turns WHERE COALESCE(json_extract(data,'$.done'),0)=0 AND COALESCE(json_extract(data,'$.legacyDisposition'),'')!='superseded' ORDER BY rowid").all().map(r=>JSON.parse(String(r.data)));}
  unfinishedTurn():TurnRecord|null{const row=this.db.prepare("SELECT data FROM turns WHERE COALESCE(json_extract(data,'$.done'),0)=0 AND COALESCE(json_extract(data,'$.legacyDisposition'),'')!='superseded' ORDER BY rowid LIMIT 1").get();return row?JSON.parse(String(row.data)):null;}

  outbox(turnId:string):OutboxItem[]{return this.db.prepare("SELECT data FROM outbox WHERE json_extract(data,'$.turnId')=? ORDER BY json_extract(data,'$.seq'),rowid").all(turnId).map(r=>JSON.parse(String(r.data)));}
  saveOutbox(item: OutboxItem): void { this.save('outbox', `${item.turnId}:${item.seq}`, item); }
}
