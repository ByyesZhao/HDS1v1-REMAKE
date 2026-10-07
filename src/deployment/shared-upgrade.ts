import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Storage } from '../storage';
import type { CharacterState, Runtime, TurnRecord, ScheduledTask } from '../types';

export interface SharedUpgradeReport {
  version: number | null; mode: string | null; activeLegacyShared: boolean;
  unfinishedSharedTurnIds: string[]; oldSceneTaskIds: string[]; committedSharedTurnCount: number;
  canInitialize: boolean; requiresUserDecision: boolean; backupPath: string | null;
}
export function inspectSharedUpgrade(databasePath: string): SharedUpgradeReport {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => String(r.name)));
    const state = <T>(key: string): T | null => {
      if (!tables.has('state')) return null;
      const row = db.prepare('SELECT data FROM state WHERE key=?').get(key);
      return row ? JSON.parse(String(row.data)) as T : null;
    };
    const rows = <T>(table: 'turns' | 'tasks'): T[] => tables.has(table) ? db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(r => JSON.parse(String(r.data)) as T) : [];
    const runtime = state<Runtime>('runtime'), character = state<CharacterState>('character');
    const version = runtime?.sharedActivityVersion ?? null, turns = rows<TurnRecord>('turns');
    const activeLegacyShared = version !== 1 && !!character && character.scene.mode !== 'chat';
    const unfinishedSharedTurnIds = turns.filter(t => version !== 1 && !t.done && !t.sharedMeta && (t.entryMode !== 'chat'
      || t.frozenResult?.nextState.scene.mode !== undefined && t.frozenResult.nextState.scene.mode !== 'chat'
      || t.triggerKinds.includes('scene_step'))).map(t => t.id);
    const oldSceneTaskIds = rows<ScheduledTask>('tasks').filter(t => t.kind === 'scene_step' && !t.sharedActivityId).map(t => t.id);
    const requiresUserDecision = activeLegacyShared || unfinishedSharedTurnIds.length > 0;
    return { version, mode: character?.scene.mode ?? null, activeLegacyShared, unfinishedSharedTurnIds, oldSceneTaskIds,
      committedSharedTurnCount: turns.filter(t => t.done && t.entryMode !== 'chat').length,
      canInitialize: version === null && !requiresUserDecision, requiresUserDecision, backupPath: null };
  } finally { db.close(); }
}

export function upgradeSharedActivity(databasePath: string, now: string, options: { stopped: boolean; backupDirectory: string }): SharedUpgradeReport {
  if (!options.stopped) throw new Error('Stop HDSI and supply --stopped before upgrading shared activities.');
  const before = inspectSharedUpgrade(databasePath);
  if (before.requiresUserDecision) throw new Error(`旧共同活动需要确认接续（legacy shared）；未完成轮：${before.unfinishedSharedTurnIds.join(',') || '无'}。请先使用 --check 查看报告。`);
  if (before.version === 1) return before;
  if (!before.canInitialize) throw new Error(`Unsupported shared activity version: ${before.version}`);
  const backupPath = join(options.backupDirectory, `shared-${now.replace(/[^\d]/g, '')}-${randomUUID()}`);
  mkdirSync(backupPath, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(databasePath + suffix)) copyFileSync(databasePath + suffix, join(backupPath, basename(databasePath) + suffix));
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('CREATE TABLE IF NOT EXISTS control_requests (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
      const row = db.prepare("SELECT data FROM state WHERE key='runtime'").get();
      if (!row) throw new Error('No existing Runtime to initialize; create a fresh story database through the normal entry.');
      const runtime = JSON.parse(String(row.data));
      db.prepare("UPDATE state SET data=? WHERE key='runtime'").run(JSON.stringify({ ...runtime, sharedActivityVersion: 1, sharedClock: null }));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
  return { ...inspectSharedUpgrade(databasePath), backupPath };
}

export function ensureSharedActivityVersion(storage: Storage): void {
  if (storage.runtime().sharedActivityVersion !== 1) throw new Error('Stop HDSI and run npm run shared:migrate -- --database <path> --check, then --apply --stopped --backup-dir <path> before starting this existing database.');
}
