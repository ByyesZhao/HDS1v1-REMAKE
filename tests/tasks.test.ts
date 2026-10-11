import { it, expect } from 'vitest';
import { HdsiApp, generateTurn } from '../src/app';
import { Scheduler } from '../src/host/scheduler';
import { setup, saveInput, NOW, narrative } from './helpers';

it('shortens existing sleep for an explicit future check_messages to appointment rescheduling', async () => {
  const d = setup();
  try {
    saveInput(d.storage, 'a', '先前的问题');
    d.storage.save('messages', 'a', { ...d.storage.read('messages', 'a')!, seenTurnId: 'old' });
    d.storage.set('character', { ...d.storage.character(), sleep: { sleepAt: '2026-10-07T23:30:00+08:00', wakeAt: '2026-10-08T08:30:00+08:00' } });
    d.storage.save('tasks', 'check', { id: 'check', kind: 'check_messages', at: NOW, description: '稍后回应', checkReason: 'deferred_reply', messageIds: ['a'], status: 'pending' });
    d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'none' }, taskChanges: [{ action: 'update', id: 'check', task: { kind: 'appointment', at: '2026-10-08T08:00:00+08:00' } }] };
    const generated = await generateTurn(d, { inputMessageIds: [], taskIds: ['check'], triggerKinds: ['check_messages'] }, 'kind-projection');
    expect(Date.parse(generated.candidate.nextState.sleep!.wakeAt)).toBe(Date.parse('2026-10-08T07:00:00+08:00'));
  } finally { d.storage.close(); }
});

it.each([
  { name: 'consumed description only', patch: { description: '描述更新' }, wakeAt: '2026-10-08T08:30:00+08:00' },
  { name: 'explicit future rescheduling', patch: { at: '2026-10-08T08:00:00+08:00' }, wakeAt: '2026-10-08T07:00:00+08:00' },
])('uses projected appointment lifecycle for sleep planning: $name', async ({ patch, wakeAt }) => {
  const d = setup();
  try {
    // The explicit request supplies the consumed ID; a future row makes its participation in morning planning observable.
    d.storage.save('tasks', 'morning', { id: 'morning', kind: 'appointment', at: '2026-10-08T08:30:00+08:00', description: '早上约定', status: 'pending' });
    d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'none' }, taskChanges: [{ action: 'update', id: 'morning', task: patch }], sleepPreference: { sleepAt: '2026-10-07T23:30:00+08:00', wakeAt: '2026-10-08T08:30:00+08:00', reason: '准备休息' } };
    const generated = await generateTurn(d, { inputMessageIds: [], taskIds: ['morning'], triggerKinds: ['appointment'] }, 'sleep-projection');
    expect(Date.parse(generated.candidate.nextState.sleep!.wakeAt)).toBe(Date.parse(wakeAt));
  } finally { d.storage.close(); }
});

it('keeps seen input seen and updates the same deferred check on reconsideration', async () => {
  const d = setup(); saveInput(d.storage, 'a', '晚点回答我');
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'later', reconsiderAt: '2026-10-07T10:15:00+08:00', intention: '晚点认真回答' }, taskChanges: [] };
  const app = new HdsiApp(d); await app.runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
  const seen = d.storage.read('messages', 'a')!.seenTurnId;
  const check = d.storage.all('tasks')[0];
  expect(check.checkReason).toBe('deferred_reply'); expect(check.messageIds).toEqual(['a']);
  d.clock.time = '2026-10-07T10:15:00+08:00';
  d.models.outputs.personal_chat.reply.reconsiderAt = '2026-10-07T10:30:00+08:00';
  await app.runTurn((await new Scheduler(d.storage).collectReady(d.clock.now()))!);
  expect(d.storage.read('messages', 'a')!.seenTurnId).toBe(seen);
  expect(d.storage.all('tasks').filter(t => t.status === 'pending')).toHaveLength(1);
  expect(d.storage.read('tasks', check.id)!.at).toBe('2026-10-07T10:30:00+08:00');
  const person = d.models.calls.filter(c => c.name === 'personal_chat')[1].input;
  expect(person.roles.visibleIds).toEqual([]); expect(person.roles.reconsiderIds).toEqual(['a']);
  expect(d.models.calls.filter(c => c.name === 'memory')).toHaveLength(1);
  d.storage.close();
});
it('explicit rescheduling wins over default completion', async () => {
  const d = setup(); d.storage.save('tasks', 'lunch', { id: 'lunch', kind: 'appointment', at: NOW, description: '午饭', status: 'pending' });
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'none' }, taskChanges: [{ action: 'update', id: 'lunch', task: { at: '2026-10-07T13:00:00+08:00' } }] };
  await new HdsiApp(d).runTurn({ inputMessageIds: [], taskIds: ['lunch'], triggerKinds: ['appointment'] });
  expect(d.storage.read('tasks', 'lunch')).toMatchObject({ status: 'pending', description: '午饭', at: '2026-10-07T13:00:00+08:00' });
  d.storage.close();
});

it('uses life rather than chat when a deferred reply is still inaccessible during an autonomous turn', async () => {
  const d = setup(); saveInput(d.storage, 'a', '已经看过');
  d.storage.save('messages', 'a', { ...d.storage.read('messages', 'a')!, seenTurnId: 'old' });
  d.storage.save('tasks', 'deferred', { id: 'deferred', kind: 'check_messages', at: NOW, description: '稍后回复', checkReason: 'deferred_reply', messageIds: ['a'], status: 'pending' });
  d.models.outputs.narrative = { ...narrative, currentScene: { description: '洗澡中', activity: { description: '洗澡', startsAt: NOW, expectedEndAt: '2026-10-07T10:30:00+08:00', phoneAccess: false } } };
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'now', intention: '不该在洗澡时回复', draft: '不该发' }, taskChanges: [] };
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '不该发' }] };
  const r = await generateTurn(d, { inputMessageIds: [], taskIds: ['deferred'], triggerKinds: ['autonomous', 'check_messages'] }, 'a');
  expect(d.models.calls.map(c => c.name)).toEqual(['narrative', 'personal_life']);
  expect(r.items).toEqual([]); expect(r.candidate.completedTaskIds).toEqual([]);
  expect(r.candidate.taskChanges).toContainEqual({ action: 'update', id: 'deferred', task: expect.objectContaining({ at: '2026-10-07T10:30:00+08:00' }) });
  d.storage.close();
});
