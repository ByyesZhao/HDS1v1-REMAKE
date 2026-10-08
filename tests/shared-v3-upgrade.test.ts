import { it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';
import { initialCharacter } from '../src/config';
import { loadSettings, appConfig } from '../src/settings';
import { apply } from '../src/index';
import { NOW, setup, saveInput, silent } from './helpers';
import { generateTurn } from '../src/app';
import { freezeTurn } from '../src/recovery';
import { makeSharedFixture } from './shared-v3-fixture';
import type { TurnRequest, TurnRecord } from '../src/types';
// Load Koishi through its native CJS entry; transforming its loader's inheritance in Vitest is incompatible.
vi.mock('koishi', async () => (await import('node:module')).createRequire(`${process.cwd()}/package.json`)('koishi'));

function legacy(path: string, shared = false) {
  const db = new Storage(path), state = initialCharacter(NOW);
  db.set('character', shared ? { ...state, scene: { ...state.scene, mode: 'shared_online', shared: { title: '旧游戏', progress: '中途', lastPublicNode: '公开旧节点', nextStepAt: NOW } } } : state);
  new MemoryStore(db).migrate(NOW);
  const runtime = db.runtime() as any; delete runtime.sharedActivityVersion; delete runtime.sharedClock; db.set('runtime', runtime);
  db.prepare('DROP TABLE control_requests').run();
  db.save('messages', 'm', { id: 'm', content: '需保留的普通消息', direction: 'incoming', receivedAt: NOW, platformMessageIds: ['p'], batchId: 'b', seenTurnId: null, turnId: null, outboxSeq: null });
  db.save('tasks', 't', { id: 't', kind: 'appointment', at: NOW, description: '普通预约', status: 'pending' });
  db.save('turns', 'old', { id: 'old', at: NOW, inputMessageIds: ['m'], triggerTaskIds: [], triggerKinds: [shared ? 'scene_step' : 'input'], batchIds: ['b'], entryMode: shared ? 'shared_online' : 'chat', frozenResult: null, completedAt: null, outputComplete: false, done: false });
  return db;
}
function schema(path: string) { const db = new DatabaseSync(path, { readOnly: true }); try { return db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(); } finally { db.close(); } }
it.each(['preparation', 'environment'] as const)('version_one_unfinished_%s_is_not_legacy: readonly check and repeated apply preserve valid unfinished work', async kind => {
  const root = mkdtempSync(join(tmpdir(), 'shared-current-')), path = join(root, 'state.sqlite');
  const d = setup(); d.storage.close(); d.storage = new Storage(path); d.storage.set('character', initialCharacter(NOW)); new MemoryStore(d.storage).migrate(NOW);
  let closed = false;
  try {
    let request: TurnRequest;
    if (kind === 'preparation') {
      saveInput(d.storage, 'input', '开始共同活动');
      d.models.outputs.personal_chat = { ...silent, sharedChange: { action: 'start', mode: 'shared_online', title: '游戏' } };
      request = { inputMessageIds: ['input'], taskIds: [], triggerKinds: ['input'] };
    } else {
      makeSharedFixture(d); d.models.outputs.world = { changes: [] };
      request = { inputMessageIds: [], taskIds: [], triggerKinds: ['environment'], environmentKind: 'world' };
    }
    const turn: TurnRecord = { id: 'current', at: NOW, inputMessageIds: request.inputMessageIds, triggerTaskIds: [], triggerKinds: request.triggerKinds,
      batchIds: [], entryMode: d.storage.character().scene.mode, sharedMeta: null, completedAt: null, frozenResult: null, outputComplete: false, done: false, environmentKind: request.environmentKind };
    const generated = kind==='environment'?{candidate:{visibleMessageIds:[],reconsiderMessageIds:[],narrative:null,personal:null,expression:null,experiences:[],nextState:d.storage.character(),taskChanges:[],completedTaskIds:[],probability:{contactMisses:0,stickerMisses:0},autonomousIntervalMinutes:null,environmentChanges:[]},items:[]}:await generateTurn(d, request, turn.id); freezeTurn(d, turn, generated.candidate, generated.items); d.storage.close(); closed = true;
    const before = readFileSync(path), tables = schema(path);
    const { inspectSharedUpgrade, upgradeSharedActivity } = await import('../src/deployment/shared-upgrade.js');
    expect(inspectSharedUpgrade(path)).toMatchObject({ version: 1, activeLegacyShared: false, unfinishedSharedTurnIds: [], canInitialize: false, requiresUserDecision: false });
    expect(upgradeSharedActivity(path, NOW, { stopped: true, backupDirectory: join(root, 'backup') })).toMatchObject({ version: 1, requiresUserDecision: false, backupPath: null });
    expect(readFileSync(path)).toEqual(before); expect(schema(path)).toEqual(tables); expect(existsSync(join(root, 'backup'))).toBe(false);
  } finally { if (!closed) d.storage.close(); rmSync(root, { recursive: true, force: true }); }
});
it('readonly_check_does_not_initialize: check neither edits the file nor adds schema', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-check-')), path = join(root, 'state.sqlite');
  try {
    legacy(path).close(); const before = readFileSync(path), tables = schema(path);
    const { inspectSharedUpgrade } = await import('../src/deployment/shared-upgrade.js');
    expect(inspectSharedUpgrade(path)).toMatchObject({ version: null, mode: 'chat', canInitialize: true, requiresUserDecision: false, backupPath: null });
    expect(readFileSync(path)).toEqual(before); expect(schema(path)).toEqual(tables);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('stopped_backup_then_upgrade: preserves ordinary state and creates a readable backup before initializing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-upgrade-')), path = join(root, 'state.sqlite');
  try {
    const original = legacy(path); const state = original.character(), runtime = original.runtime(), turn = original.read('turns', 'old'); original.close();
    const { upgradeSharedActivity, inspectSharedUpgrade } = await import('../src/deployment/shared-upgrade.js');
    expect(() => upgradeSharedActivity(path, NOW, { stopped: false, backupDirectory: join(root, 'backup') })).toThrow(/stopped/);
    const report = upgradeSharedActivity(path, NOW, { stopped: true, backupDirectory: join(root, 'backup') });
    expect(report.version).toBe(1); expect(report.backupPath).toBeTruthy(); expect(existsSync(join(report.backupPath!, 'state.sqlite'))).toBe(true);
    expect(inspectSharedUpgrade(join(report.backupPath!, 'state.sqlite')).version).toBeNull();
    const upgraded = new Storage(path); expect(upgraded.character()).toEqual(state); expect(upgraded.read('turns', 'old')).toEqual(turn);
    expect(upgraded.runtime()).toEqual({ ...runtime, sharedActivityVersion: 1, sharedClock: null });
    expect(upgraded.read('messages', 'm')!.content).toBe('需保留的普通消息'); expect(upgraded.read('tasks', 't')!.status).toBe('pending'); expect(upgraded.all('control_requests')).toEqual([]); upgraded.close();
    const bytes = readFileSync(path); expect(upgradeSharedActivity(path, NOW, { stopped: true, backupDirectory: join(root, 'backup') }).version).toBe(1); expect(readFileSync(path)).toEqual(bytes);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('legacy_shared_is_not_reset: reports actual IDs and refuses guesses even when there are no memories', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-legacy-')), path = join(root, 'state.sqlite');
  try {
    const db = legacy(path, true);
    db.save('tasks', 'old-scene', { id: 'old-scene', kind: 'scene_step', at: NOW, description: '旧节点', status: 'pending' });
    for (let n = 1; n <= 3; n++) db.save('turns', `done${n}`, { ...db.read('turns', 'old')!, id: `done${n}`, done: true, completedAt: NOW });
    db.saveOutbox({ turnId: 'old', seq: 0, kind: 'narration', payload: '旧公开节点', status: 'confirmed', confirmedAt: NOW, platformMessageIds: ['q'], notBefore: NOW }); db.close();
    const before = readFileSync(path), { inspectSharedUpgrade, upgradeSharedActivity } = await import('../src/deployment/shared-upgrade.js');
    expect(inspectSharedUpgrade(path)).toMatchObject({ activeLegacyShared: true, unfinishedSharedTurnIds: ['old'], oldSceneTaskIds: ['old-scene'], committedSharedTurnCount: 3, canInitialize: false, requiresUserDecision: true });
    expect(() => upgradeSharedActivity(path, NOW, { stopped: true, backupDirectory: join(root, 'backup') })).toThrow(/旧共同活动|legacy shared/);
    expect(readFileSync(path)).toEqual(before); expect(schema(path).some(row => row.name === 'control_requests')).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('entry_checks_before_host_start: existing missing-version database never registers a story host', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-entry-')), path = join(root, 'state.sqlite'); const events: string[] = [];
  let dispose: (() => Promise<void>) | undefined;
  vi.stubEnv('DEEPSEEK_API_KEY', 'fixture-only'); vi.stubEnv('QWEN_API_KEY', 'fixture-only');
  try {
    legacy(path).close(); writeFileSync(join(root, 'story.json'), readFileSync('examples/story.sample.json'));
    const ctx = { baseDir: root, on: (name: string, fn: () => Promise<void>) => { events.push(name); if (name === 'dispose') dispose = fn; }, middleware() {}, command: () => ({ action() {} }), logger: () => ({ error() {} }), bots: [] };
    expect(() => apply(ctx as any, { botId: 'b', userId: 'u', databasePath: 'state.sqlite', storyConfigPath: 'story.json' })).toThrow(/shared:migrate/);
    expect(events).toEqual([]);
    const { ensureSharedActivityVersion } = await import('../src/deployment/shared-upgrade.js');
    const fresh = new Storage(':memory:'); expect(() => ensureSharedActivityVersion(fresh)).not.toThrow(); fresh.close();
    expect(appConfig(loadSettings(join(root, 'story.json'), {}))).toMatchObject({ sharedIdleSeconds: 60, sharedMaxSteps: 20 });
  } finally { await dispose?.(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); }
});
