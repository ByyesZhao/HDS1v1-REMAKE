import { it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Storage } from '../src/storage';
import { HdsiApp, generateTurn } from '../src/app';
import { freezeTurn, finishPostprocessing } from '../src/recovery';
import { InputBuffer } from '../src/host/input';
import { Scheduler } from '../src/host/scheduler';
import { SerialHost } from '../src/host/runtime';
import type { TurnRecord } from '../src/types';
import { setup, saveInput, NOW } from './helpers';

function turn(): TurnRecord {
  return { id: 'a', inputMessageIds: ['a'], triggerTaskIds: [], triggerKinds: ['input'], at: NOW, completedAt: null, frozenResult: null, outputComplete: false, done: false, batchIds: ['batch-a'], entryMode: 'chat' };
}
function output(d: ReturnType<typeof setup>) {
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'now', intention: '回复', draft: '稿' }, taskChanges: [] };
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '第一段' }, { kind: 'text', content: '第二段' }] };
}
function cleanTemp(dir: string) {
  const target = resolve(dir);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('hdsi-review-')) throw new Error('unexpected temporary directory');
  rmSync(target, { recursive: true });
}

it('freezes the complete ordered output and post job before any platform send', async () => {
  const d = setup();
  try {
    saveInput(d.storage, 'a', '你好'); output(d);
    const r = await generateTurn(d, { inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }, 'a');
    freezeTurn(d, turn(), r.candidate, r.items);
    expect(d.storage.read('turns', 'a')).toMatchObject({ frozenResult: r.candidate, outputComplete: false, done: false });
    expect(d.storage.outbox('a').map(i => [i.seq, i.payload, i.status, i.notBefore])).toEqual([[0, '第一段', 'pending', NOW], [1, '第二段', 'pending', null]]);
    expect(d.storage.read('post_jobs', 'a')).toEqual({ turnId: 'a', result: null });
    expect(d.sender.sent).toEqual([]);
  } finally { d.storage.close(); }
});
it('marks a silent frozen turn output complete and commits without sending', async () => {
  const d = setup();
  try {
    saveInput(d.storage, 'a', '好');
    const r = await generateTurn(d, { inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }, 'a');
    const frozen = freezeTurn(d, turn(), r.candidate, r.items);
    expect(d.storage.read('turns', 'a')!.outputComplete).toBe(true);
    expect(d.storage.outbox('a')).toEqual([]);
    await finishPostprocessing(d, frozen);
    expect(d.storage.read('turns', 'a')!.done).toBe(true);
    expect(d.storage.read('messages', 'a')!.seenTurnId).toBe('a');
    expect(d.sender.sent).toEqual([]);
  } finally { d.storage.close(); }
});
it('rolls back the turn and all output rows when freezing the post job fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdsi-review-')); const path = join(dir, 'story.sqlite');
  const d = setup(); const initial = d.storage.character(); d.storage.close(); d.storage = new Storage(path); d.storage.set('runtime',{...d.storage.runtime(),dialogueContextVersion:1});
  try {
    d.storage.set('character', initial);
    saveInput(d.storage, 'a', '你好'); output(d); d.storage.save('turns', 'a', turn());
    const r = await generateTurn(d, { inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }, 'a');
    const injection = new DatabaseSync(path);
    try { injection.exec("CREATE TRIGGER reject_post BEFORE INSERT ON post_jobs BEGIN SELECT RAISE(ABORT, 'injected post failure'); END"); } finally { injection.close(); }
    expect(() => freezeTurn(d, turn(), r.candidate, r.items)).toThrow('injected post failure');
    expect(d.storage.read('turns', 'a')).toEqual(turn());
    expect(d.storage.outbox('a')).toEqual([]);
    expect(d.storage.read('post_jobs', 'a')).toBeNull();
    expect(d.sender.sent).toEqual([]);
  } finally { d.storage.close(); cleanTemp(dir); }
});
it('reopens a file database and retries sending while retaining confirmed output and frozen text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdsi-review-')); const path = join(dir, 'story.sqlite');
  const d = setup(); const initial = d.storage.character(); d.storage.close(); d.storage = new Storage(path); d.storage.set('runtime',{...d.storage.runtime(),dialogueContextVersion:1});
  try {
    // An already chosen future sleep leaves autonomous interval selection as the only random draw.
    d.storage.set('character', { ...initial, sleep: { sleepAt: '2026-10-07T23:00:00+08:00', wakeAt: '2026-10-08T08:00:00+08:00' } });
    saveInput(d.storage, 'a', '你好'); output(d);
    d.random.next = vi.fn().mockReturnValueOnce(0.5).mockReturnValue(0.9);
    const r = await generateTurn(d, { inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }, 'a');
    freezeTurn(d, turn(), r.candidate, r.items);
    expect(d.random.next).toHaveBeenCalledTimes(1);
    expect(d.storage.read('turns', 'a')!.autonomousIntervalMinutes).toBe(180);
    expect(d.storage.read('turns', 'a')!.frozenResult!.autonomousIntervalMinutes).toBe(180);
    const items = d.storage.outbox('a');
    d.storage.saveOutbox({ ...items[0], status: 'confirmed', confirmedAt: NOW, platformMessageIds: ['already-sent'] });
    d.storage.save('messages', 'a:out:0', { id: 'a:out:0', direction: 'outgoing', content: '第一段', receivedAt: NOW, platformMessageIds: ['already-sent'], seenTurnId: null, batchId: null, turnId: 'a', outboxSeq: 0 });
    d.storage.saveOutbox({ ...items[1], status: 'sending' });
    const oldTurn = d.storage.read('turns', 'a')!;
    const oldFrozenJson = JSON.stringify(oldTurn.frozenResult);
    const oldOutbox = d.storage.outbox('a');
    const oldConfirmedMessage = d.storage.read('messages', 'a:out:0');
    const episodeId = d.storage.read('messages', 'a')!.dialogueEpisodeId;
    expect(episodeId).toBeTruthy();
    d.clock.advance(60_000);
    d.storage.close(); d.storage = new Storage(path); d.storage.set('runtime',{...d.storage.runtime(),dialogueContextVersion:1});
    expect(d.storage.read('turns', 'a')).toEqual(oldTurn);
    expect(d.storage.outbox('a')).toEqual(oldOutbox);
    const persistedStatuses: string[] = []; const saveOutbox = d.storage.saveOutbox.bind(d.storage);
    d.storage.saveOutbox = item => {
      saveOutbox(item); persistedStatuses.push(d.storage.outbox('a')[1].status);
      expect(d.storage.outbox('a')[0]).toEqual(oldOutbox[0]);
      expect(JSON.stringify(d.storage.read('turns', 'a')!.frozenResult)).toBe(oldFrozenJson);
      expect(d.storage.read('turns', 'a')).toMatchObject({ at: NOW, autonomousIntervalMinutes: 180 });
    };
    const beforeCompletion: TurnRecord[] = []; const save = d.storage.save.bind(d.storage);
    d.storage.save = ((...args: Parameters<typeof d.storage.save>) => {
      const [table, id, row] = args;
      // finishPostprocessing intentionally clears frozenResult in the terminal write.
      if (table === 'turns' && 'done' in row && row.done) beforeCompletion.push(d.storage.read('turns', id)!);
      save(...args);
    }) as typeof d.storage.save;
    d.models.calls = []; d.models.outputs.expression = { parts: [{ kind: 'text', content: '不能重新生成' }] };
    const app = new HdsiApp(d); await app.resumeUnfinishedTurn(); await app.resumeUnfinishedTurn();
    expect(persistedStatuses).toEqual(['retry', 'sending', 'confirmed']);
    expect(d.sender.sent.map(i => i.payload)).toEqual(['第二段']);
    expect(d.models.calls.map(c => c.name)).toEqual(['memory']);
    expect(d.random.next).toHaveBeenCalledTimes(1);
    expect(beforeCompletion).toHaveLength(1);
    expect(beforeCompletion[0]).toEqual({ ...oldTurn, outputComplete: true, dialogueBinding: { episodeId, holdReply: false } });
    expect(JSON.stringify(beforeCompletion[0].frozenResult)).toBe(oldFrozenJson);
    expect(d.storage.outbox('a')[0]).toEqual(oldOutbox[0]);
    expect(d.storage.outbox('a')[1]).toEqual({ ...oldOutbox[1], status: 'confirmed', confirmedAt: d.clock.now(), platformMessageIds: ['qq-1'] });
    expect(d.storage.read('messages', 'a:out:0')).toEqual(oldConfirmedMessage);
    expect(d.storage.outbox('a').map(i => i.platformMessageIds)).toEqual([['already-sent'], ['qq-1']]);
    expect(d.storage.read('messages', 'a')!.seenTurnId).toBe('a');
    expect(d.storage.read('turns', 'a')).toMatchObject({ at: NOW, autonomousIntervalMinutes: 180, outputComplete: true, done: true, completedAt: d.clock.now(), frozenResult: null });
    expect(d.storage.character()).toEqual({ ...oldTurn.frozenResult!.nextState, nextAutonomousAt: '2026-10-07T05:01:00.000Z' });
    expect(d.storage.read('post_jobs', 'a')!.result).toBeNull();
  } finally { d.storage.close(); cleanTemp(dir); }
});

it('wakes without piggybacking ordinary inputs while a new batch is open', async () => {
  const d = setup();
  try {
    d.storage.set('character', { ...d.storage.character(), sleep: { sleepAt: NOW, wakeAt: '2026-10-07T11:00:00+08:00' } });
    const input = new InputBuffer(d.storage); const scheduler = new Scheduler(d.storage);
    await input.acceptInput({ id: 'a', receivedAt: NOW, content: '睡醒看' });
    d.clock.advance(15_000); input.closeReady(d.clock.now());
    expect(d.storage.runtime().pendingBatchIds).toHaveLength(1);
    expect(await scheduler.collectReady(d.clock.now())).toBeNull();
    expect(d.storage.runtime().pendingBatchIds).toEqual([]);
    expect(d.storage.read('messages', 'a')!.seenTurnId).toBeNull();
    d.clock.time = '2026-10-07T11:00:00+08:00';
    await input.acceptInput({ id: 'b', receivedAt: d.clock.now(), content: '仍在合批' });
    const ready = (await scheduler.collectReady(d.clock.now()))!;
    expect(ready.inputMessageIds).toEqual([]); expect(ready.triggerKinds).toContain('sleep');
    await new HdsiApp(d).runTurn(ready);
    expect(d.storage.read('messages', 'a')!.seenTurnId).toBeNull();
    expect(d.storage.read('messages', 'b')!.seenTurnId).toBeNull();
    d.clock.advance(15000);const ordinary=(await scheduler.collectReady(d.clock.now()))!;
    expect(ordinary.inputMessageIds).toEqual(['a','b']);await new HdsiApp(d).runTurn(ordinary);
    expect(d.storage.read('messages','a')!.seenTurnId).toBeTruthy();
    expect(d.storage.read('messages','b')!.seenTurnId).toBeTruthy();
  } finally { d.storage.close(); }
});
it.each([
  { reason: 'unread' as const, status: 'cancelled' },
  { reason: 'deferred_reply' as const, status: 'completed' },
])('delivers all real closed batches and retires a due check: %j', async ({ reason, status }) => {
  const d = setup();
  try {
    const input = new InputBuffer(d.storage);
    await input.acceptInput({ id: 'a', receivedAt: NOW, content: '第一批' });
    d.clock.advance(15_000); input.closeReady(d.clock.now());
    await input.acceptInput({ id: 'b', receivedAt: d.clock.now(), content: '第二批' });
    d.clock.advance(15_000); input.closeReady(d.clock.now());
    expect(d.storage.runtime().pendingBatchIds).toHaveLength(2);
    d.storage.save('tasks', 'check', { id: 'check', kind: 'check_messages', at: NOW, description: '到期检查', checkReason: reason, messageIds: ['a', 'b'], status: 'pending' });
    const ready = (await new Scheduler(d.storage).collectReady(d.clock.now()))!;
    expect(ready.inputMessageIds).toEqual(['a', 'b']); expect(ready.batchIds).toHaveLength(2);
    await new HdsiApp(d).runTurn(ready);
    expect(d.storage.read('tasks', 'check')!.status).toBe(status);
    expect(d.storage.unreadMessages()).toEqual([]);
  } finally { d.storage.close(); }
});
it('closes an expired batch while paused and leaves no repeated open-batch deadline', async () => {
  const d = setup(); const host = new SerialHost(new HdsiApp(d), { timers: false });
  try {
    await host.pause(); await host.acceptInput({ id: 'a', receivedAt: NOW, content: '暂停输入' });
    await host.wake(); d.clock.advance(15_000); await host.wake();
    expect(d.storage.runtime().openBatch).toBeNull();
    expect(d.storage.runtime().pendingBatchIds).toHaveLength(1);
    expect(await new Scheduler(d.storage).nextDeadline(d.clock.now())).toBeNull();
    expect(d.models.calls).toEqual([]);
  } finally { await host.stop(); d.storage.close(); }
});
