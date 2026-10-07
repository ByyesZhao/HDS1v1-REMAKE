import { it, expect } from 'vitest';
import { Scheduler } from '../src/host/scheduler';
import { InputBuffer } from '../src/host/input';
import { selectSharedMeta } from '../src/host/shared';
import { isSleeping, canRead } from '../src/host/state';
import { setup, saveInput, NOW } from './helpers';
import { makeSharedFixture } from './shared-v3-fixture';

const after = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();
it('manual_and_due_share_one_selection: freezes all current controls and inputs', async () => {
  const d = setup(); makeSharedFixture(d); const input = new InputBuffer(d.storage); const scheduler = new Scheduler(d.storage);
  for (const id of ['c1', 'c2']) await input.acceptInput({ id, content: '【推进】', receivedAt: NOW });
  await input.acceptInput({ id: 'a', content: '【动作：移动】', receivedAt: NOW });
  const request = (await scheduler.collectReady(after(60_000)))!;
  expect(request.sharedMeta).toMatchObject({ stepNumber: 2, controlRequestIds: ['c1', 'c2'], advanceReason: 'manual', allowSimulatedUserActions: false });
  expect(request.taskIds).toEqual(['scene:activity-a']); expect(request.triggerKinds).toEqual(['scene_step']); expect(request.inputMessageIds).toEqual(['a']);
  await input.acceptInput({ id: 'c3', content: '【推进】', receivedAt: after(61_000) });
  expect(request.sharedMeta!.controlRequestIds).toEqual(['c1', 'c2']); expect(d.storage.read('control_requests', 'c1')!.status).toBe('pending'); d.storage.close();
});
it('wait_60_and_first_immediate: shared input extends window without ordinary batching', async () => {
  const d = setup(); makeSharedFixture(d, { completedSteps: 0 }); const scheduler = new Scheduler(d.storage);
  expect((await scheduler.collectReady(NOW))!.sharedMeta!.advanceReason).toBe('initial');
  makeSharedFixture(d); expect(await scheduler.collectReady(after(59_999))).toBeNull();
  await new InputBuffer(d.storage).acceptInput({ id: 'a', content: '等等', receivedAt: after(50_000) });
  expect(await scheduler.collectReady(after(60_000))).toBeNull();
  expect((await scheduler.collectReady(after(110_000)))!.inputMessageIds).toEqual(['a']); d.storage.close();
});
it('phase_and_quiet_permission: selects bounded phases without treating reconsideration as new input', () => {
  const d = setup();
  for (const [completed, max, phase] of [[0, 20, 'opening'], [16, 20, 'wrap_up'], [19, 20, 'final'], [2, 3, 'final']] as const) {
    makeSharedFixture(d, { completedSteps: completed, maxSteps: max });
    expect(selectSharedMeta(d.storage, after(60_000), [], ['scene:activity-a'])).toMatchObject({ phase, stepNumber: completed + 1, allowSimulatedUserActions: true });
    expect(selectSharedMeta(d.storage, after(60_000), ['a'], [])!.allowSimulatedUserActions).toBe(false);
  }
  makeSharedFixture(d, { completedSteps: 20 }); expect(selectSharedMeta(d.storage, after(60_000), [], [])).toBeNull(); d.storage.close();
});
it('foreground_before_environment_and_autonomous: only eligible idle work includes autonomous', async () => {
  const d = setup(); const scheduler = new Scheduler(d.storage); saveInput(d.storage, 'a', '你好');
  d.storage.set('runtime', { ...d.storage.runtime(), pendingBatchIds: ['batch-a'], nextWorldAt: NOW, nextSchoolAt: NOW });
  d.storage.set('character', { ...d.storage.character(), nextAutonomousAt: NOW });
  expect((await scheduler.collectReady(NOW))!.triggerKinds).toEqual(['input']);
  d.storage.save('messages', 'a', { ...d.storage.read('messages', 'a')!, seenTurnId: 'done' });
  d.storage.set('runtime', { ...d.storage.runtime(), pendingBatchIds: [] });
  expect((await scheduler.collectReady(NOW))!.environmentKind).toBe('world');
  d.storage.set('runtime', { ...d.storage.runtime(), nextWorldAt: null, nextSchoolAt: null });
  d.storage.save('tasks', 'future', { id: 'future', kind: 'appointment', at: after(3_600_000), description: '稍后见', status: 'pending' });
  expect((await scheduler.collectReady(NOW))!.triggerKinds).toEqual(['autonomous']); d.storage.close();
});
it('environment_deadline_remains_in_shared_wait: environment runs in available window', async () => {
  const d = setup(); makeSharedFixture(d); const scheduler = new Scheduler(d.storage);
  d.storage.set('runtime', { ...d.storage.runtime(), nextWorldAt: after(10_000) });
  expect(Date.parse((await scheduler.nextDeadline(after(5_000)))!)).toBe(Date.parse(after(10_000)));
  const env = (await scheduler.collectReady(after(10_000)))!; expect(env.environmentKind).toBe('world'); expect(env.sharedMeta ?? null).toBeNull();
  await new InputBuffer(d.storage).acceptInput({ id: 'c', content: '【推进】', receivedAt: after(11_000) });
  expect((await scheduler.collectReady(after(11_000)))!.sharedMeta!.advanceReason).toBe('manual'); d.storage.close();
});
it('suppressed_deadlines_do_not_spin: shared ignores old sleep and deferred task deadlines', async () => {
  const d = setup(); makeSharedFixture(d); const scheduler = new Scheduler(d.storage);
  d.storage.set('character', { ...d.storage.character(), nextAutonomousAt: NOW, sleep: { sleepAt: NOW, wakeAt: after(20_000) } });
  d.storage.save('tasks', 'check', { id: 'check', kind: 'check_messages', checkReason: 'deferred_reply', at: NOW, description: '再考虑', status: 'pending', messageIds: ['seen'] });
  expect(isSleeping(d.storage.character(), after(10_000))).toBe(false); expect(canRead(d.storage.character(), after(10_000))).toBe(true);
  expect(Date.parse((await scheduler.nextDeadline(after(30_000)))!)).toBe(Date.parse(after(60_000)));
  expect(await scheduler.collectReady(after(30_000))).toBeNull();
  expect((await scheduler.collectReady(after(60_000)))!.triggerKinds).not.toContain('sleep');
  const state = d.storage.character(); state.scene.mode = 'chat'; state.scene.shared = null; state.sleep = null; d.storage.set('character', state);
  d.storage.set('runtime', { ...d.storage.runtime(), sharedClock: null }); d.storage.remove('tasks', 'check'); d.storage.remove('tasks', 'scene:activity-a');
  await new InputBuffer(d.storage).acceptInput({ id: 'ordinary', content: '等我说完', receivedAt: after(30_000) });
  expect(Date.parse((await scheduler.nextDeadline(after(30_000)))!)).toBe(Date.parse(after(45_000))); d.storage.close();
});
it('appointment_exception_and_maintenance_yield: appointment can open early but reconsideration waits', async () => {
  const d = setup(); makeSharedFixture(d); const scheduler = new Scheduler(d.storage);
  d.storage.save('tasks', 'check', { id: 'check', kind: 'check_messages', at: NOW, description: '复议', status: 'pending' });
  expect(await scheduler.collectReady(NOW)).toBeNull();
  d.storage.save('tasks', 'appointment', { id: 'appointment', kind: 'appointment', at: NOW, description: '已预约', status: 'pending' });
  const r = (await scheduler.collectReady(NOW))!; expect(r.sharedMeta!.advanceReason).toBe('appointment');
  expect(r.taskIds).toEqual(expect.arrayContaining(['scene:activity-a', 'check', 'appointment'])); d.storage.close();
});
