import { it, expect } from 'vitest';
import { Scheduler } from '../src/host/scheduler';
import { InputBuffer } from '../src/host/input';
import { HdsiApp } from '../src/app';
import { setup, saveInput, NOW, narrative } from './helpers';

it('selects appointment before due autonomous without adding a contact opportunity', async () => {
  const d = setup();
  d.storage.set('character', { ...d.storage.character(), nextAutonomousAt: NOW });
  d.storage.save('tasks', 'lunch', { id: 'lunch', kind: 'appointment', at: NOW, description: '一起吃饭', status: 'pending' });
  const request = await new Scheduler(d.storage).collectReady(NOW);
  expect(request!.triggerKinds).toEqual(['appointment']);
  expect(d.storage.character().nextAutonomousAt).toBe(NOW);
  expect(d.models.calls).toHaveLength(0);
  d.storage.close();
});
it('ends the cycle at sleep and wakes once with pending appointments and only closed inputs', async () => {
  const d = setup();
  d.storage.set('character', { ...d.storage.character(), sleep: { sleepAt: NOW, wakeAt: '2026-10-07T11:00:00+08:00' }, nextAutonomousAt: NOW });
  d.storage.save('tasks', 'meeting', { id: 'meeting', kind: 'appointment', at: NOW, description: '约定', status: 'pending' });
  saveInput(d.storage, 'a', '睡醒看');
  const s = new Scheduler(d.storage);
  expect(await s.collectReady(NOW)).toBeNull();
  expect(d.storage.character().nextAutonomousAt).toBeNull();
  expect(d.storage.read('tasks', 'meeting')!.status).toBe('pending');
  d.clock.time = '2026-10-07T11:00:00+08:00';
  const input = new InputBuffer(d.storage); await input.acceptInput({ id: 'b', receivedAt: d.clock.now(), content: '仍在合批' });
  const request = await s.collectReady(d.clock.now());
  expect(request!.inputMessageIds).toEqual(['a']); expect(request!.triggerKinds).toContain('sleep');
  await new HdsiApp(d).runTurn(request!);
  expect(d.storage.character().nextAutonomousAt).toBe('2026-10-07T06:00:00.000Z');
  expect(Date.parse(d.storage.character().sleep!.sleepAt)).toBeGreaterThan(Date.parse(d.clock.now()));
  expect(d.storage.read('messages', 'b')!.seenTurnId).toBeNull();
  d.storage.close();
});
it('stashes inaccessible input without models and rechecks the actual end', async () => {
  const d = setup(); saveInput(d.storage, 'a', '未看秘密');
  const runtime = d.storage.runtime(); runtime.pendingBatchIds = ['batch-a']; d.storage.set('runtime', runtime);
  const activity = { description: '洗澡', startsAt: NOW, expectedEndAt: '2026-10-07T10:15:00+08:00', phoneAccess: false };
  d.storage.set('character', { ...d.storage.character(), scene: { ...d.storage.character().scene, activity } });
  const s = new Scheduler(d.storage);
  expect(await s.collectReady(NOW)).toBeNull();
  expect(d.storage.runtime().pendingBatchIds).toEqual([]);
  expect(d.storage.all('tasks').filter(t => t.status === 'pending')).toHaveLength(1);
  d.clock.time = activity.expectedEndAt;
  d.models.outputs.narrative = { ...narrative, currentScene: { description: '停水延长', activity: { ...activity, expectedEndAt: '2026-10-07T10:30:00+08:00' } } };
  await new HdsiApp(d).runTurn((await s.collectReady(d.clock.now()))!);
  expect(d.storage.read('messages', 'a')!.seenTurnId).toBeNull();
  expect(Date.parse((await s.nextDeadline(d.clock.now()))!)).toBe(Date.parse('2026-10-07T10:30:00+08:00'));
  expect(JSON.stringify(d.models.calls)).not.toContain('未看秘密');
  d.clock.time = '2026-10-07T10:30:00+08:00';
  d.models.outputs.narrative = { ...narrative, currentScene: { description: '还没结束', activity: { ...activity, expectedEndAt: '2026-10-07T10:45:00+08:00' } } };
  await new HdsiApp(d).runTurn((await s.collectReady(d.clock.now()))!);
  expect(Date.parse((await s.nextDeadline(d.clock.now()))!)).toBe(Date.parse('2026-10-07T10:45:00+08:00'));
  expect(d.storage.read('messages', 'a')!.seenTurnId).toBeNull();
  d.storage.close();
});

it('shortens the saved wake time for a newly confirmed morning appointment', async () => {
  const d = setup(); saveInput(d.storage, 'a', '明早8点一起吃早饭');
  d.storage.set('character', { ...d.storage.character(), sleep: { sleepAt: '2026-10-07T23:30:00+08:00', wakeAt: '2026-10-08T08:30:00+08:00' } });
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'none' }, taskChanges: [{ action: 'create', task: { kind: 'appointment', at: '2026-10-08T08:00:00+08:00', description: '确认早餐' } }] };
  await new HdsiApp(d).runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
  expect(Date.parse(d.storage.character().sleep!.wakeAt)).toBe(Date.parse('2026-10-08T07:00:00+08:00'));
  d.storage.close();
});
