import { it, expect } from 'vitest';
import { HdsiApp } from '../src/app';
import { Scheduler } from '../src/host/scheduler';
import { setup, NOW } from './helpers';

it('updates an existing exam ID without turning the future event into an experience', async () => {
  const d = setup();
  d.storage.save('events', 'exam', { id: 'exam', kind: 'school', startsAt: '2026-10-08T09:00:00+08:00', endsAt: null, description: '考试', basis: 'fiction', sourceUrls: [], status: 'active' });
  d.models.outputs.school = { changes: [{ action: 'update', id: 'exam', event: { startsAt: '2026-10-08T10:00:00+08:00' } }] };
  await new HdsiApp(d).runTurn({ inputMessageIds: [], taskIds: [], triggerKinds: ['environment'], environmentKind: 'school' });
  expect(d.storage.all('events')).toHaveLength(1);
  expect(d.storage.read('events', 'exam')!.startsAt).toBe('2026-10-08T10:00:00+08:00');
  expect(d.storage.all('experiences')).toEqual([]);
  expect(d.storage.character().narratedUntil).toBe(NOW);
  expect(d.models.calls.map(c => c.name)).toEqual(['school']);
  d.storage.close();
});
it('updates the world while sleeping without personal calls or a nighttime cycle', async () => {
  const d = setup();
  d.storage.set('character', { ...d.storage.character(), sleep: { sleepAt: NOW, wakeAt: '2026-10-07T11:00:00+08:00' }, nextAutonomousAt: NOW });
  d.storage.set('runtime', { ...d.storage.runtime(), nextWorldAt: NOW });
  d.models.outputs.world = { changes: [{ action: 'create', event: { kind: 'world', startsAt: NOW, endsAt: null, description: '晴天', basis: 'fiction', sourceUrls: [] } }] };
  const request = await new Scheduler(d.storage).collectReady(NOW);
  expect(request!.environmentKind).toBe('world');
  await new HdsiApp(d).runTurn(request!);
  expect(d.models.calls.map(c => c.name)).toEqual(['world']);
  expect(d.storage.character().nextAutonomousAt).toBeNull();
  expect(d.storage.all('events')[0].sourceUrls).toEqual([]);
  expect(Date.parse(d.storage.runtime().nextWorldAt!)).toBeGreaterThan(Date.parse(NOW));
  d.storage.close();
});
