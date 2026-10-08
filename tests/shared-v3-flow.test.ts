import {ensureEnvironmentBatch,selectEnvironmentStep} from '../src/environment/scheduler';
import { it, expect, vi } from 'vitest';
import { HdsiApp } from '../src/app';
import { InputBuffer } from '../src/host/input';
import { Scheduler } from '../src/host/scheduler';
import { ModelClient } from '../src/model/client';
import { SerialHost } from '../src/host/runtime';
import { setup, saveInput, NOW, narrative, silent, emptyMemory } from './helpers';
import { makeSharedFixture, configureSharedModels } from './shared-v3-fixture';
const plus = (at: string, ms: number) => new Date(Date.parse(at) + ms).toISOString();
function gateMemory(d: ReturnType<typeof setup>) {
  let release!: () => void, arrived = false;
  const gate = new Promise<void>(r => release = r), original = d.models.runModel.bind(d.models);
  d.models.runModel = async (task, input, options) => { if (task.name === 'memory') { arrived = true; await gate; } return original(task, input, options); };
  return { release: () => release(), wait: () => vi.waitFor(() => expect(arrived).toBe(true)) };
}
it('begin_publish_before_post: confirmed start routes new input before B but first shared step waits', async () => {
  const d = setup(); saveInput(d.storage, 'first', '现在开始'); configureSharedModels(d);
  d.models.outputs.personal_chat = { ...silent, sharedChange: { action: 'start', mode: 'shared_online', title: '游戏' } };
  const gate = gateMemory(d), app = new HdsiApp(d), input = new InputBuffer(d.storage);
  const running = app.runTurn({ inputMessageIds: ['first'], taskIds: [], triggerKinds: ['input'] }); await gate.wait();
  try {
    expect(d.storage.character().scene.mode).toBe('chat'); expect(d.storage.runtime().sharedClock?.status).toBe('active');
    const activityId = d.storage.runtime().sharedClock!.activityId;
    await input.acceptInput({ id: 'late', content: '【动作：移动】', receivedAt: d.clock.now() });
    await input.acceptInput({ id: 'advance', content: '【推进】', receivedAt: d.clock.now() });
    expect(d.storage.read('messages', 'late')!.sharedActivityId).toBe(activityId); expect(d.storage.read('control_requests', 'advance')!.activityId).toBe(activityId);
    expect(await new Scheduler(d.storage).collectReady(d.clock.now())).toBeNull();
  } finally { gate.release(); await running; }
  expect(d.storage.character().scene.shared!.completedSteps).toBe(0);
  await app.runTurn((await new Scheduler(d.storage).collectReady(d.clock.now()))!);
  expect(d.storage.character().scene.shared!.completedSteps).toBe(1); expect(d.storage.read('messages', 'late')!.seenTurnId).toBeTruthy();
  expect(d.storage.read('control_requests', 'advance')!.status).toBe('consumed'); d.storage.close();
});
it('end_publish_and_late_input: requeues unseen shared content and preserves post-marker ordinary batch', async () => {
  const d = setup(); makeSharedFixture(d, { completedSteps: 0 }); configureSharedModels(d);
  d.models.outputs.personal_shared = { ...silent, sharedChange: { action: 'end' } };
  const input = new InputBuffer(d.storage); const request = (await new Scheduler(d.storage).collectReady(NOW))!;
  const original = d.models.runModel.bind(d.models); let inserted = false;
  d.models.runModel = async (task, data, options) => {
    if (task.name === 'personal_shared' && !inserted) { inserted = true; await input.acceptInput({ id: 'before-end', content: '刚刚想到', receivedAt: NOW }); await input.acceptInput({ id: 'old-control', content: '【推进】', receivedAt: NOW }); }
    return original(task, data, options);
  };
  const gate = gateMemory(d), app = new HdsiApp(d), running = app.runTurn(request); await gate.wait();
  try {
    expect(d.storage.runtime().sharedClock!.status).toBe('ended');
    await input.acceptInput({ id: 'after-end', content: '晚安', receivedAt: d.clock.now() });
    expect((await input.acceptInput({ id: 'after-control', content: '【推进】', receivedAt: d.clock.now() })).systemReply).toBe('当前没有共同活动');
    expect(d.storage.read('messages', 'after-end')!.batchId).toBeTruthy();
  } finally { gate.release(); await running; }
  expect(d.storage.runtime().sharedClock).toBeNull(); expect(d.storage.character().scene.shared).toBeNull();
  const before = d.storage.read('messages', 'before-end')!, after = d.storage.read('messages', 'after-end')!;
  expect(before.seenTurnId).toBeNull(); expect(before.batchId).toBe(after.batchId); expect(before.sharedActivityId).toBe('activity-a');
  expect(d.storage.read('control_requests', 'old-control')!.status).toBe('cancelled');
  d.clock.advance(15_000); const ordinary = (await new Scheduler(d.storage).collectReady(d.clock.now()))!;
  expect(ordinary.inputMessageIds).toEqual(['before-end', 'after-end']); expect(ordinary.sharedMeta).toBeNull(); d.storage.close();
});
it('late_inputs_survive_frozen_commit: consumes only selected controls and keeps new anchors across slow post', async () => {
  const d = setup(); makeSharedFixture(d); configureSharedModels(d); const input = new InputBuffer(d.storage);
  await input.acceptInput({ id: 'selected', content: '【推进】', receivedAt: NOW });
  const request = (await new Scheduler(d.storage).collectReady(NOW))!;
  const original = d.models.runModel.bind(d.models); let release!: () => void, entered = false;
  d.models.runModel = async (task, data, opts) => { if (task.name === 'narrative_shared') { entered = true; await new Promise<void>(r => release = r); } return original(task, data, opts); };
  const app = new HdsiApp(d), running = app.runTurn(request); await vi.waitFor(() => expect(entered).toBe(true));
  d.clock.advance(30_000); await input.acceptInput({ id: 'new-message', content: '我回来了', receivedAt: d.clock.now() }); await input.acceptInput({ id: 'new-control', content: '【推进】', receivedAt: d.clock.now() });
  const postGate = gateMemory(d); release(); await postGate.wait(); d.clock.advance(90_000);
  await input.acceptInput({ id: 'post-control', content: '【推进】', receivedAt: d.clock.now() }); postGate.release(); await running;
  expect(d.storage.character().scene.shared!.completedSteps).toBe(2);
  expect(d.storage.read('control_requests', 'selected')!.status).toBe('consumed'); expect(d.storage.read('control_requests', 'new-control')!.status).toBe('pending');
  expect(d.storage.read('messages', 'new-message')!.seenTurnId).toBeNull();
  const next = (await new Scheduler(d.storage).collectReady(d.clock.now()))!; expect(next.sharedMeta!.stepNumber).toBe(3);
  expect(next.sharedMeta!.controlRequestIds).toEqual(['new-control', 'post-control']); expect(next.inputMessageIds).toEqual(['new-message']); d.storage.close();
});
it('deadline_uses_last_send_confirmation: final sticker anchor survives slower post and later input', async () => {
  const d = setup(); makeSharedFixture(d, { completedSteps: 0 }); configureSharedModels(d);
  d.clock.time = '2026-10-07T22:31:00+08:00'; d.config.stickersEnabled = true; d.random.next = () => 0;
  d.models.outputs.personal_shared = { ...silent, reply: { decision: 'now', intention: '继续', draft: '好' } };
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '好' }, { kind: 'text', content: '继续' }] };
  const send = d.sender.sendItem.bind(d.sender); let last = 0;
  d.sender.sendItem = async item => { if (item.seq === 3) d.clock.time = '2026-10-07T22:31:30+08:00'; else d.clock.advance(5000); last = Date.parse(d.clock.now()); return send(item); };
  const original = d.models.runModel.bind(d.models);
  d.models.runModel = async (task, input, opts) => { if (task.name === 'memory') d.clock.advance(15000); return original(task, input, opts); };
  const request = (await new Scheduler(d.storage).collectReady(d.clock.now()))!;
  await new HdsiApp({ ...d, stickers: { findSticker: async () => 'sticker' } }).runTurn(request);
  expect(d.sender.sent.at(-1)!.kind).toBe('sticker');
  expect(Date.parse(d.storage.runtime().sharedClock!.lastOutputAt!)).toBe(last);
  expect(Date.parse(d.storage.character().scene.shared!.nextStepAt!)).toBe(last + 60_000);
  await new InputBuffer(d.storage).acceptInput({ id: 'late', content: '等等', receivedAt: d.clock.now() });
  expect(Date.parse(d.storage.character().scene.shared!.nextStepAt!)).toBe(Date.parse(d.clock.now()) + 60_000); d.storage.close();
});
it('environment_commit_preserves_shared_clock: world changes only its own event and deadline', async () => {
  const d = setup(); makeSharedFixture(d); configureSharedModels(d);
  d.storage.set('character', { ...d.storage.character(), nextAutonomousAt: plus(NOW, 180*60000) });
  d.models.outputs.world = { changes: [] }; const before = d.storage.character(), clock = d.storage.runtime().sharedClock;
  d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null}); ensureEnvironmentBatch(d.storage,d.config,NOW); d.generateEnvironment=async()=>({stage:'world',changes:[]});
  await new HdsiApp(d).runTurn({inputMessageIds:[],taskIds:[],triggerKinds:['environment'],environmentStepId:selectEnvironmentStep(d.storage,NOW)!.id});
  expect(d.storage.character()).toEqual(before); expect(d.storage.runtime().sharedClock).toEqual(clock);
  expect(d.storage.all('turns')).toEqual([]); d.storage.close();
});
it('silent_20_steps_natural_close: quiet nodes count and the twentieth closes without a twenty-first', async () => {
  const d = setup(); makeSharedFixture(d, { completedSteps: 0 }); configureSharedModels(d); const scheduler = new Scheduler(d.storage), app = new HdsiApp(d);
  for (let step = 1; step <= 20; step++) {
    const request = (await scheduler.collectReady(d.clock.now()))!; expect(request.sharedMeta!.stepNumber).toBe(step);
    if (step === 17) expect(request.sharedMeta!.phase).toBe('wrap_up');
    await app.runTurn(request);
    if (step < 20) { expect(d.storage.character().scene.shared!.completedSteps).toBe(step); expect(await scheduler.collectReady(d.clock.now())).toBeNull(); d.clock.advance(60_000); }
  }
  expect(d.storage.character().scene.mode).toBe('chat'); expect(d.storage.runtime().sharedClock).toBeNull();
  expect(d.sender.sent.map(i => i.payload)).toEqual(['游戏界面亮起，本次活动准备就绪。', '本次活动告一段落，余下的事约好下次继续。', '共同活动结束']);
  expect(d.models.calls.filter(c => c.name === 'narrative_shared')).toHaveLength(20); expect(d.storage.all('turns').at(-1)!.sharedMeta!.stepNumber).toBe(20);
  expect(await scheduler.collectReady(d.clock.now())).toBeNull(); d.storage.close();
});
it('silent_20_steps_natural_close: invalid final pauses after two repairs without clearing or counting', async () => {
  const d = setup(); makeSharedFixture(d, { completedSteps: 19 }); d.clock.advance(60_000); let calls = 0;
  const models = new ModelClient({ complete: async () => { calls++; return { ...narrative, publicNarration: null, progress: '结束', outline: { goal: '游戏', openThreads: [], endingCondition: '结束' }, simulatedUserActions: [] }; } });
  await expect(new HdsiApp({ ...d, models }).runTurn((await new Scheduler(d.storage).collectReady(d.clock.now()))!)).rejects.toThrow('narrative_shared');
  expect(calls).toBe(3); expect(d.storage.runtime().paused).toBe(true); expect(d.storage.character().scene.shared!.completedSteps).toBe(19);
  expect(d.sender.sent).toHaveLength(0); expect(await new Scheduler(d.storage).collectReady(d.clock.now())).toBeNull(); d.storage.close();
});
it.each(['inside', 'expired', 'postponed'] as const)('sleep_and_idle_cycle: shared stays awake and end resolves %s sleep plan', async kind => {
  const d = setup(); makeSharedFixture(d, { completedSteps: 0 }); configureSharedModels(d); d.clock.time = '2026-10-07T23:30:00+08:00';
  const sleep = { sleepAt: '2026-10-07T23:00:00+08:00', wakeAt: kind === 'expired' ? '2026-10-07T23:20:00+08:00' : '2026-10-08T08:00:00+08:00' };
  d.storage.set('character', { ...d.storage.character(), sleep });
  const app = new HdsiApp(d), scheduler = new Scheduler(d.storage); await app.runTurn((await scheduler.collectReady(d.clock.now()))!);
  expect(d.models.calls[0].input.context.waking).toBe(false); expect(d.storage.character().sleep).toEqual(sleep); expect(d.storage.character().scene.shared!.completedSteps).toBe(1);
  await new InputBuffer(d.storage).acceptInput({ id: 'end', content: '【推进】', receivedAt: d.clock.now() });
  d.models.outputs.personal_shared = { ...silent, sharedChange: { action: 'end' }, ...(kind === 'postponed' ? { sleepPreference: { reason: '晚点睡', sleepAt: '2026-10-08T01:00:00+08:00', wakeAt: '2026-10-08T09:00:00+08:00' } } : {}) };
  d.models.outputs.narrative_shared = { ...narrative, publicNarration: '这次活动告一段落，准备休息。', progress: '结束', outline: { goal: '游戏', openThreads: [], endingCondition: '结束' }, simulatedUserActions: [] };
  await app.runTurn((await scheduler.collectReady(d.clock.now()))!);
  if (kind === 'inside') expect(d.storage.character().nextAutonomousAt).toBeNull();
  else expect(Date.parse(d.storage.character().nextAutonomousAt!)).toBe(Date.parse(d.clock.now()) + 180*60000);
  if (kind === 'expired') expect(d.storage.character().sleep).toBeNull(); d.storage.close();
});
it.each(['input', 'appointment', 'sleep', 'check_messages', 'autonomous'] as const)('all_foreground_resets_once: %s narrative sets completedAt plus interval', async kind => {
  const d = setup(); d.clock.advance(60000); const request = { inputMessageIds: [] as string[], taskIds: [] as string[], triggerKinds: [kind] };
  if (kind === 'input') { saveInput(d.storage, 'a', '你好'); request.inputMessageIds = ['a']; }
  if (kind === 'appointment') { d.storage.save('tasks', 't', { id: 't', kind, at: NOW, description: '见面', status: 'pending' }); request.taskIds = ['t']; }
  if (kind === 'check_messages') { d.storage.save('tasks', 't', { id: 't', kind, at: NOW, description: '检查', checkReason: 'unread', messageIds: [], status: 'pending' }); request.taskIds = ['t']; }
  await new HdsiApp(d).runTurn(request); const turn = d.storage.all('turns')[0];
  expect(turn.autonomousIntervalMinutes).toBe(180); expect(Date.parse(d.storage.character().nextAutonomousAt!)).toBe(Date.parse(turn.completedAt!) + 180*60000);
  expect(d.storage.character().narratedUntil).toBe(turn.at); expect(d.storage.runtime().contactMisses).toBe(0); d.storage.close();
});
it('life_and_shared_memory: private catchup stays blind and public simulation uses real outgoing sources', async () => {
  const d = setup(), app = new HdsiApp(d); saveInput(d.storage, 'a', '未看秘密'); d.clock.advance(3_600_000);
  await app.runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }); const firstAt = d.storage.character().narratedUntil;
  d.clock.advance(300_000); await app.runTurn({ inputMessageIds: [], taskIds: [], triggerKinds: ['appointment'] });
  expect(d.models.calls.filter(c => c.name === 'narrative')[1].input.context.from).toBe(firstAt); expect(JSON.stringify(d.models.calls[0].input)).not.toContain('未看秘密');
  makeSharedFixture(d, { completedSteps: 0 }); configureSharedModels(d);
  d.models.outputs.narrative_shared = { ...narrative, publicNarration: '你拿下了补给点', progress: '补给', outline: { goal: '游戏', openThreads: [], endingCondition: '结束' }, simulatedUserActions: ['你拿下了补给点'] };
  d.models.outputs.memory = (input: any) => ({ ...emptyMemory, shortTermChanges: [{ action: 'create', clientRef: 'simulation', content: '共同游戏时你拿下补给点，她感到高兴', eventSummary: '共同模拟游戏拿下补给点', feelingSummary: '高兴', topics: ['游戏'], importance: 'normal', sourceIds: [input.outgoing[0].id] }] });
  await app.runTurn((await new Scheduler(d.storage).collectReady(d.clock.now()))!);
  expect(d.storage.all('memories').some(m => m.content.includes('共同模拟'))).toBe(true);
  const memoryInput = d.models.calls.filter(c => c.name === 'memory').at(-1)!.input;
  expect(memoryInput.roles.sharedPublicOutgoingIds).toContain(memoryInput.resources.messages[0].id); expect(memoryInput.context.arrangementsAndIntent.outline).toMatchObject({ goal: '游戏' });
  expect(d.storage.all('memories').find(m => m.kind === 'short')!.sourceIds).toEqual([memoryInput.resources.messages[0].id]);
  const published = d.storage.messages().filter(m => m.direction === 'outgoing').map(m => m.content);
  await new InputBuffer(d.storage).acceptInput({ id: 'correction', content: '我还没拿到', receivedAt: d.clock.now() });
  expect(d.storage.read('messages', 'correction')!.seenTurnId).toBeNull(); expect(d.storage.messages().filter(m => m.direction === 'outgoing').map(m => m.content)).toEqual(published); d.storage.close();
});
it('sleep_and_idle_cycle: inactive advance cannot wake a sleeping ordinary character', async () => {
  const d = setup(); d.storage.set('character', { ...d.storage.character(), sleep: { sleepAt: NOW, wakeAt: plus(NOW, 3600000) }, nextAutonomousAt: NOW });
  const host = new SerialHost(new HdsiApp(d), { timers: false });
  expect((await host.acceptInput({ id: 'c', content: '【推进】', receivedAt: NOW })).systemReply).toBe('当前没有共同活动');
  await host.wake(); expect(d.models.calls).toHaveLength(0); expect(d.storage.character().scene.mode).toBe('chat'); await host.stop(); d.storage.close();
});
