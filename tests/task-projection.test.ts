import { expect, it } from 'vitest';
import { projectTaskChanges } from '../src/host/task-projection';
import type { ScheduledTask, TaskChange } from '../src/types';
import { NOW } from './helpers';

const appointment: ScheduledTask = { id: 'a', kind: 'appointment', at: NOW, description: '约好见面', status: 'pending' };
const future = '2026-10-07T10:05:00+08:00';
const update = (task: Extract<TaskChange, {action: 'update'}>['task']): TaskChange => ({ action: 'update', id: 'a', task });

it.each([
  { name: 'unconsumed metadata', consumed: false, changes: [update({ description: '更新' })], status: 'pending' },
  { name: 'unconsumed same time', consumed: false, changes: [update({ at: NOW })], status: 'pending' },
  { name: 'unconsumed different time', consumed: false, changes: [update({ at: future })], status: 'pending' },
  { name: 'consumed without change', consumed: true, changes: [], status: 'completed' },
  { name: 'consumed empty patch', consumed: true, changes: [update({})], status: 'completed' },
  { name: 'consumed description', consumed: true, changes: [update({ description: '更新' })], status: 'completed' },
  { name: 'consumed same time', consumed: true, changes: [update({ at: NOW })], status: 'completed' },
  { name: 'consumed same epoch with UTC offset', consumed: true, changes: [update({ at: '2026-10-07T02:00:00Z' })], status: 'completed' },
  { name: 'consumed past time', consumed: true, changes: [update({ at: '2026-10-07T09:59:00+08:00' })], status: 'completed' },
  { name: 'consumed different time equal to turn', consumed: true, oldAt: '2026-10-07T09:00:00+08:00', changes: [update({ at: NOW })], status: 'completed' },
  { name: 'consumed future rescheduling', consumed: true, changes: [update({ at: future })], status: 'pending' },
  { name: 'consumed cancellation', consumed: true, changes: [{ action: 'cancel', id: 'a' }], status: 'cancelled' },
  { name: 'unconsumed cancellation', consumed: false, changes: [{ action: 'cancel', id: 'a' }], status: 'cancelled' },
] as Array<{ name: string; consumed: boolean; oldAt?: string; changes: TaskChange[]; status: string }>)('$name', ({ consumed, oldAt, changes, status }) => {
  const tasks = [{ ...appointment, at: oldAt ?? NOW }];
  const before = structuredClone({ tasks, changes });
  const result = projectTaskChanges(tasks, changes, consumed ? ['a'] : [], NOW);
  expect(result[0]).toEqual({ ...tasks[0], ...(changes[0]?.action === 'update' ? changes[0].task : {}), status });
  expect({ tasks, changes }).toEqual(before);
});

it.each(['completed', 'cancelled'] as const)('preserves original %s history through consumption, future updates and cancellation', status => {
  const old = { ...appointment, status };
  expect(projectTaskChanges([old], [], ['a'], NOW)[0].status).toBe(status);
  expect(projectTaskChanges([old], [update({ at: future, description: '更新' })], ['a'], NOW)[0]).toEqual({ ...old, at: future, description: '更新' });
  expect(projectTaskChanges([old], [{ action: 'cancel', id: 'a' }], ['a'], NOW)[0]).toEqual(old);
});

it('keeps input order, terminal rows and appends creates in change order including create NOW', () => {
  const tasks = [{ ...appointment, id: 'terminal', status: 'completed' as const }, appointment];
  const changes: TaskChange[] = [
    { action: 'create', id: 'new-1', task: { kind: 'appointment', at: NOW, description: '现在' } },
    update({ description: '更新' }),
    { action: 'create', id: 'new-2', task: { kind: 'appointment', at: future, description: '稍后' } },
  ];
  expect(projectTaskChanges(tasks, changes, ['a'], NOW).map(t => [t.id, t.status])).toEqual([
    ['terminal', 'completed'], ['a', 'completed'], ['new-1', 'pending'], ['new-2', 'pending'],
  ]);
});

it.each([
  { old: appointment, patch: { kind: 'check_messages', checkReason: 'deferred_reply', messageIds: ['message'], at: future }, status: 'pending' },
  { old: { ...appointment, kind: 'check_messages', checkReason: 'deferred_reply', messageIds: ['message'] }, patch: { kind: 'appointment' }, status: 'completed' },
  { old: { ...appointment, kind: 'check_messages', checkReason: 'deferred_reply', messageIds: ['message'] }, patch: { kind: 'appointment', at: NOW }, status: 'completed' },
  { old: { ...appointment, kind: 'check_messages', checkReason: 'deferred_reply', messageIds: ['message'] }, patch: { kind: 'appointment', at: future }, status: 'pending' },
] as Array<{old: ScheduledTask; patch: Partial<ScheduledTask>; status: string}>)('projects final kind without treating a kind-only change as rescheduling: %j', ({ old, patch, status }) => {
  expect(projectTaskChanges([old], [update(patch)], ['a'], NOW)[0]).toEqual({ ...old, ...patch, status });
});
