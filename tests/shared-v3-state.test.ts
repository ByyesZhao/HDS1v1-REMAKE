import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../src/storage';
import { loadSettings } from '../src/settings';
import { HdsiApp } from '../src/app';
import { setup, saveInput, NOW } from './helpers';
import { makeSharedFixture } from './shared-v3-fixture';

it('defaults_and_snapshot: validates settings and freezes active configuration at start', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shared-settings-'));
  const path = join(dir, 'sample.json');
  const input = JSON.parse(readFileSync('examples/story.sample.json', 'utf8'));
  try {
    writeFileSync(path, JSON.stringify(input));
    expect(loadSettings(path, {})).toMatchObject({ sharedIdleSeconds: 60, sharedMaxSteps: 20 });
    for (const invalid of [{ sharedIdleSeconds: 0 }, { sharedMaxSteps: 21 }]) {
      writeFileSync(path, JSON.stringify({ ...input, ...invalid }));
      expect(() => loadSettings(path, {})).toThrow();
    }
    const d = setup(); d.config.sharedIdleSeconds = 75; d.config.sharedMaxSteps = 12;
    saveInput(d.storage, 'a', '好，开始');
    d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'none' }, taskChanges: [],
      sharedChange: { action: 'start', mode: 'shared_online', title: '游戏' } };
    await new HdsiApp(d).runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
    d.config.sharedIdleSeconds = 90; d.config.sharedMaxSteps = 10;
    expect(d.storage.character().scene.shared).toMatchObject({ idleSeconds: 75, maxSteps: 12, completedSteps: 0 });
    d.storage.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('clock_uses_latest_real_anchor: uses final confirmed sticker and later input', async () => {
  const { sharedDeadline } = await import('../src/host/shared.js');
  const d = setup(); makeSharedFixture(d);
  const clock = d.storage.runtime().sharedClock!;
  clock.lastInputAt = '2026-10-07T10:00:10+08:00'; clock.lastOutputAt = '2026-10-07T10:00:30+08:00';
  expect(Date.parse(sharedDeadline(d.storage.character().scene.shared!, clock))).toBe(Date.parse('2026-10-07T10:01:30+08:00'));
  clock.lastInputAt = '2026-10-07T10:01:00+08:00';
  expect(Date.parse(sharedDeadline(d.storage.character().scene.shared!, clock))).toBe(Date.parse('2026-10-07T10:02:00+08:00'));
  d.storage.close();
});

it('first_step_and_single_projection: keeps exactly one scene timer across refreshes', async () => {
  const { refreshSharedStep } = await import('../src/host/shared.js');
  const d = setup(); makeSharedFixture(d, { completedSteps: 0 });
  d.storage.transaction(() => refreshSharedStep(d.storage, NOW));
  expect(Date.parse(d.storage.character().scene.shared!.nextStepAt!)).toBe(Date.parse(NOW));
  const state = d.storage.character(); state.scene.shared!.completedSteps = 1; d.storage.set('character', state);
  for (let i = 0; i < 3; i++) d.storage.transaction(() => refreshSharedStep(d.storage, NOW));
  const tasks = d.storage.all('tasks').filter(t => t.kind === 'scene_step' && t.status === 'pending');
  expect(tasks).toHaveLength(1); expect(tasks[0].id).toBe('scene:activity-a');
  expect(Date.parse(tasks[0].at)).toBe(Date.parse('2026-10-07T10:01:00+08:00'));
  expect(tasks[0].at).toBe(d.storage.character().scene.shared!.nextStepAt);
  d.storage.close();
});

it('silent_and_reopen: preserves silent completion deadline and old version identity', async () => {
  const { refreshSharedStep } = await import('../src/host/shared.js');
  const dir = mkdtempSync(join(tmpdir(), 'shared-clock-')); const path = join(dir, 'state.sqlite');
  try {
    const d = setup(); d.storage.close(); d.storage = new Storage(path); d.storage.set('character', setupState());
    makeSharedFixture(d);
    const r = d.storage.runtime(); r.sharedClock!.lastSilentCompletedAt = '2026-10-07T10:03:00+08:00'; d.storage.set('runtime', r);
    d.storage.transaction(() => refreshSharedStep(d.storage, NOW)); d.storage.close();
    const reopened = new Storage(path);
    expect(Date.parse(reopened.character().scene.shared!.nextStepAt!)).toBe(Date.parse('2026-10-07T10:04:00+08:00'));
    expect(reopened.all('tasks').filter(t => t.kind === 'scene_step')).toHaveLength(1);
    const old = reopened.runtime() as any; delete old.sharedActivityVersion; delete old.sharedClock; reopened.set('runtime', old);
    expect(reopened.runtime().sharedActivityVersion).toBeNull(); reopened.close();
    const fresh = new Storage(':memory:'); expect(fresh.runtime().sharedActivityVersion).toBe(1); fresh.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function setupState() { const d = setup(); const state = d.storage.character(); d.storage.close(); return state; }
