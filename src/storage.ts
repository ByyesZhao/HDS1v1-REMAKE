import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { nextDaily } from './time';
import type { CharacterState, Detail, DetailHistory, EnvironmentEvent, Experience, Memory, Message, OutboxItem, PostJob, Runtime, ScheduledTask, Sticker, TurnRecord } from './types';

interface Tables {
  messages: Message; turns: TurnRecord; outbox: OutboxItem; post_jobs: PostJob;
  tasks: ScheduledTask; details: Detail; detail_history: DetailHistory; memories: Memory;
  events: EnvironmentEvent; experiences: Experience; stickers: Sticker;
}
const tables: Array<keyof Tables> = ['messages', 'turns', 'outbox', 'post_jobs', 'tasks', 'details', 'detail_history', 'memories', 'events', 'experiences', 'stickers'];
export class Storage {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
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
      CREATE UNIQUE INDEX IF NOT EXISTS post_turn ON post_jobs(json_extract(data, '$.turnId'));
    `);
    if (!this.get('runtime')) this.set('runtime', {
      openBatch: null, pendingBatchIds: [], paused: false, contactMisses: 0, stickerMisses: 0,
      nextWorldAt: null, nextSchoolAt: null, nextMaintenanceAt: nextDaily(new Date().toISOString(), ['04:30'], 'Asia/Shanghai'), lastError: null,
    } satisfies Runtime);
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
  runtime(): Runtime { return this.get<Runtime>('runtime')!; }
  character(): CharacterState { return this.get<CharacterState>('character')!; }
  messages(): Message[] { return this.all('messages').sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)); }
  unreadMessages(): Message[] {
    const open = this.runtime().openBatch?.id;
    return this.messages().filter(m => m.direction === 'incoming' && m.seenTurnId === null && m.batchId !== open);
  }
  unfinishedTurn(): TurnRecord | null { return this.all('turns').find(t => !t.done) ?? null; }
  outbox(turnId: string): OutboxItem[] { return this.all('outbox').filter(i => i.turnId === turnId).sort((a, b) => a.seq - b.seq); }
  saveOutbox(item: OutboxItem): void { this.save('outbox', `${item.turnId}:${item.seq}`, item); }
}
