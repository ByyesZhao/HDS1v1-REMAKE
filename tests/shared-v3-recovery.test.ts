import { it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DialogueEpisodes } from '../src/dialogue/episodes';
import { DialogueStore } from '../src/dialogue/store';
import { HdsiApp, generateTurn } from '../src/app';
import { Storage } from '../src/storage';
import { Scheduler } from '../src/host/scheduler';
import { InputBuffer } from '../src/host/input';
import { freezeTurn, discardUnattempted, finishPostprocessing } from '../src/recovery';
import { initialCharacter } from '../src/config';
import type { TurnRecord, TurnRequest } from '../src/types';
import { setup, saveInput, NOW, silent } from './helpers';
import { makeSharedFixture, configureSharedModels } from './shared-v3-fixture';
function record(request: TurnRequest, shared: boolean): TurnRecord {
  return { id: 'recover', at: NOW, inputMessageIds: request.inputMessageIds, triggerTaskIds: request.taskIds,
    triggerKinds: request.triggerKinds, batchIds: request.batchIds ?? [], entryMode: shared ? 'shared_online' : 'chat', sharedMeta: request.sharedMeta,
    completedAt: null, frozenResult: null, outputComplete: false, done: false };
}
function speech(d: ReturnType<typeof setup>, shared: boolean) {
  d.models.outputs[shared ? 'personal_shared' : 'personal_chat'] = { ...silent, reply: { decision: 'now', intention: '回复', draft: '你好' } };
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '第一段' }, { kind: 'text', content: '第二段' }] };
}
it.each([false, true])('first_freeze_retains_interval_once: %s unattempted recovery reuses selected sample and metadata', async shared => {
  const d = setup();
  if (shared) { makeSharedFixture(d, { completedSteps: 0 }); configureSharedModels(d); }
  else { saveInput(d.storage, 'input', '你好'); d.storage.set('character', { ...d.storage.character(), sleep: { sleepAt: '2026-10-07T23:00:00+08:00', wakeAt: '2026-10-08T08:00:00+08:00' } }); }
  speech(d, shared); d.random.next = vi.fn(() => 0.5);
  const narrativePrompts: string[] = [], runModel = d.models.runModel.bind(d.models);
  d.models.runModel = async (task, input, options) => {
    if (task.name === 'narrative_shared') narrativePrompts.push(task.prompt);
    return runModel(task, input, options);
  };
  const request: TurnRequest = shared ? (await new Scheduler(d.storage).collectReady(NOW))! : { inputMessageIds: ['input'], taskIds: [], triggerKinds: ['input'] };
  const turn = record(request, shared); d.storage.save('turns', turn.id, turn); expect(d.storage.read('turns', turn.id)!.autonomousIntervalMinutes).toBeUndefined();
  const generated = await generateTurn(d, request, turn.id); const frozen = freezeTurn(d, turn, generated.candidate, generated.items);
  expect(frozen.autonomousIntervalMinutes).toBe(180); expect(d.random.next).toHaveBeenCalledTimes(1);
  d.clock.advance(60_000); const discarded = discardUnattempted(d, frozen);
  expect(discarded.autonomousIntervalMinutes).toBe(180); expect(discarded.sharedMeta).toEqual(request.sharedMeta);
  await new InputBuffer(d.storage).acceptInput({ id: 'late', content: shared ? '【推进】' : '新输入', receivedAt: d.clock.now() });
  if (shared) await new InputBuffer(d.storage).acceptInput({ id: 'late-speech', content: '我还在门外，别继续走。', receivedAt: d.clock.now() });
  await new HdsiApp(d).resumeUnfinishedTurn();
  const done = d.storage.read('turns', turn.id)!; expect(done.autonomousIntervalMinutes).toBe(180); expect(done.sharedMeta).toEqual(request.sharedMeta); expect(done.done).toBe(true);
  expect(d.random.next).toHaveBeenCalledTimes(1); expect(done.inputMessageIds).toEqual(request.inputMessageIds);
  if (shared) {
    expect(d.storage.read('control_requests', 'late')!.status).toBe('pending'); expect(d.storage.character().scene.shared!.completedSteps).toBe(1);
    expect(narrativePrompts).toHaveLength(2); expect(narrativePrompts[0]).toContain('允许代写双方');
    expect(narrativePrompts[1]).toBe(narrativePrompts[0]);
    expect(d.storage.read('messages', 'late-speech')!.seenTurnId).toBeNull();
  }
  await finishPostprocessing(d, done); expect(d.storage.read('turns', turn.id)!.autonomousIntervalMinutes).toBe(180); d.storage.close();
});
it.each(['partial', 'post', 'committed'] as const)('recover_exact_same_step: file reopen at %s keeps output/count/control exactly once', async stage => {
  const dir = mkdtempSync(join(tmpdir(), 'shared-recovery-')), path = join(dir, 'state.sqlite');
  const d = setup(); d.storage.close(); d.storage = new Storage(path); d.storage.set('character', initialCharacter(NOW));
  try {
    makeSharedFixture(d, { completedSteps: 0 }); configureSharedModels(d); speech(d, true); d.random.next = vi.fn(() => 0.5);
    await new InputBuffer(d.storage).acceptInput({ id: 'control', content: '【推进】', receivedAt: NOW });
    const request = (await new Scheduler(d.storage).collectReady(NOW))!, send = d.sender.sendItem.bind(d.sender); let fail = stage !== 'committed';
    d.sender.sendItem = async item => { if (stage === 'partial' && item.seq === 1 && fail) throw new Error('offline send failed'); return send(item); };
    const original = d.models.runModel.bind(d.models);
    d.models.runModel = async (task, input, options) => { if (stage === 'post' && task.name === 'memory' && fail) throw new Error('offline post failed'); return original(task, input, options); };
    const app = new HdsiApp(d);
    if (stage === 'committed') await app.runTurn(request); else await expect(app.runTurn(request)).rejects.toThrow('offline');
    const turn = d.storage.all('turns')[0], countBefore = d.sender.sent.length;
    const confirmations = d.storage.outbox(turn.id).filter(i => i.status === 'confirmed').map(i => i.seq);
    expect(turn.sharedMeta).toEqual(request.sharedMeta); expect(turn.autonomousIntervalMinutes).toBe(180);
    d.storage.close(); d.storage = new Storage(path); (d as import('../src/app').Dependencies).dialogue=new DialogueEpisodes(new DialogueStore(d.storage)); fail = false; d.clock.advance(60_000);
    await new HdsiApp(d).resumeUnfinishedTurn(); await new HdsiApp(d).resumeUnfinishedTurn();
    expect(d.storage.character().scene.shared!.completedSteps).toBe(1); expect(d.storage.read('control_requests', 'control')!.status).toBe('consumed');
    expect(d.storage.read('turns', turn.id)!.sharedMeta).toEqual(request.sharedMeta); expect(d.random.next).toHaveBeenCalledTimes(1);
    expect(d.sender.sent.slice(countBefore).some(i => confirmations.includes(i.seq))).toBe(false);
    expect(d.models.calls.filter(c => c.name === 'narrative_shared')).toHaveLength(1); d.storage.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('begin_publish_before_post: unconfirmed marker leaves advance inactive and transfers ordinary late content only', async () => {
  const d = setup(); saveInput(d.storage, 'input', '现在开始'); configureSharedModels(d);
  d.models.outputs.personal_chat = { ...silent, sharedChange: { action: 'start', mode: 'shared_online', title: '游戏' } };
  const input = new InputBuffer(d.storage), send = d.sender.sendItem.bind(d.sender); let release!: () => void, entered = false;
  d.sender.sendItem = async item => { entered = true; await new Promise<void>(r => release = r); return send(item); };
  const running = new HdsiApp(d).runTurn({ inputMessageIds: ['input'], taskIds: [], triggerKinds: ['input'] }); await vi.waitFor(() => expect(entered).toBe(true));
  expect((await input.acceptInput({ id: 'control', content: '【推进】', receivedAt: NOW })).systemReply).toBe('当前没有共同活动');
  await input.acceptInput({ id: 'late', content: '出发吧', receivedAt: NOW }); release(); await running;
  expect(d.storage.read('control_requests', 'control')!.status).toBe('cancelled');
  expect(d.storage.read('messages', 'late')).toMatchObject({ batchId: null, sharedActivityId: d.storage.character().scene.shared!.activityId, seenTurnId: null });
  expect(d.storage.runtime().openBatch).toBeNull(); d.storage.close();
});
