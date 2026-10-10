import { it, expect } from 'vitest';
import { personalTask, expressionTask } from '../src/model/contracts';
import { ModelClient, ModelFormatError } from '../src/model/client';
import { runExpression } from '../src/output/expression';
import { runNarrative } from '../src/directors/narrative';
import { displayText } from '../src/output/qq';
import { HdsiApp } from '../src/app';
import { InputBuffer } from '../src/host/input';
import { Scheduler } from '../src/host/scheduler';
import { selectSharedMeta } from '../src/host/shared';
import { modern } from './chat-fixture';
import { makeSharedFixture, configureSharedModels } from './shared-v3-fixture';
import { setup, NOW, narrative, emptyMemory, saveInput } from './helpers';
import type { CompletionRequest } from '../src/model/client';
import type { SharedTurnMeta } from '../src/types';

const action = '把手机扣在枕边，缩进被窝里闭了眼';
const reply = { decision: 'now' as const, intention: '道晚安', draft: '晚安啦', actions: [action] };
const meta: SharedTurnMeta = { activityId: 'a', stepNumber: 2, maxSteps: 20, idleSeconds: 60,
  advanceReason: 'automatic', phase: 'ongoing', controlRequestIds: [], sceneTaskId: 'scene:a', allowSimulatedUserActions: false };

// A removed mode gate would let the original bedtime action escape as an action segment.
it.each(['chat', 'shared_online'])('rejects an action segment in %s', mode => {
  expect(() => expressionTask(mode).parse({ parts: [{ kind: 'action', content: action }] })).toThrow();
  expect(expressionTask(mode).parse({ parts: [{ kind: 'text', content: '我准备睡啦，晚安' }] })).toMatchObject({ parts: [{ kind: 'text' }] });
});
it.each(['chat', 'shared_online'])('rejects an action marker disguised as text in %s', mode => {
  expect(() => expressionTask(mode).parse({ parts: [{ kind: 'text', content: `【动作：${action}】` }] })).toThrow();
  expect((expressionTask(mode).schema as any).properties.parts.items.properties.kind).toMatchObject({ const: 'text' });
});
it('keeps real offline actions available', () => {
  expect(expressionTask('shared_offline').parse({ parts: [{ kind: 'action', content: '接过水杯' }] })).toMatchObject({ parts: [{ kind: 'action' }] });
});
it('blocks ordinary personal action intentions', () => {
  expect(() => personalTask('chat', NOW, [], 'chat', []).parse({ emotions: [], reply, taskChanges: [] })).toThrow();
});
it.each(['：', ':'])('blocks action markers hidden in a chat draft with %s', colon => {
  expect(() => personalTask('chat', NOW, [], 'chat', []).parse({ emotions: [], reply: { decision: 'now', intention: '晚安', draft: `【动作${colon}${action}】` }, taskChanges: [] })).toThrow();
});
it('blocks autonomous contact action intentions', () => {
  expect(() => personalTask('life', NOW, [], 'chat', []).parse({ emotions: [], innerThought: '道晚安', contact: { willing: true, intention: reply.intention, draft: reply.draft, actions: [action] } })).toThrow();
});
it('blocks online shared action intentions', () => {
  expect(() => personalTask('shared', NOW, [], 'shared_online', [], meta, '游戏继续').parse({ emotions: [], reply, taskChanges: [] })).toThrow();
});
it('uses the entering offline mode for opening intentions', () => {
  expect(personalTask('chat', NOW, [], 'chat', []).parse({ emotions: [], reply, taskChanges: [], sharedChange: { action: 'start', mode: 'shared_offline', title: '散步' } })).toMatchObject({ reply: { actions: [action] } });
});
it('does not grant actions when entering an online activity', () => {
  expect(() => personalTask('chat', NOW, [], 'chat', []).parse({ emotions: [], reply, taskChanges: [], sharedChange: { action: 'start', mode: 'shared_online', title: '游戏' } })).toThrow();
});
it('keeps offline closing intentions before the end marker', () => {
  expect(personalTask('shared', NOW, [], 'shared_offline', [], meta, '散步结束').parse({ emotions: [], reply, taskChanges: [], sharedChange: { action: 'end' } })).toMatchObject({ reply: { actions: [action] } });
});

it.each(['chat', 'shared_online'])('repairs a forbidden action instead of sending or silently dropping it in %s', async mode => {
  const requests: CompletionRequest[] = [];
  const models = new ModelClient({ complete: async request => {
    requests.push(request);
    return requests.length === 1 ? { parts: [{ kind: 'action', content: action }] } : { parts: [{ kind: 'text', content: '我睡啦，晚安' }] };
  } });
  const result = await runExpression(models, { mode, intent: { intention: '晚安', draft: '我睡啦，晚安' } }, { lookup: null });
  expect(result.parts).toEqual([{ kind: 'text', content: '我睡啦，晚安' }]);
  expect(requests).toHaveLength(2);
  expect(requests[1].repair?.errors).toMatch(/kind|action/);
});
it('keeps the selected chat contract across lookup and repair', async () => {
  const input = { mode: 'chat', intent: { intention: '晚安', draft: '我睡啦' } };
  const requests: CompletionRequest[] = [];
  const models = new ModelClient({ complete: async request => {
    requests.push(request);
    if (requests.length === 1) return { lookupDetails: '睡眠习惯' };
    if (requests.length === 2) return { parts: [{ kind: 'action', content: action }] };
    return { parts: [{ kind: 'text', content: '我睡啦' }] };
  } });
  const result = await runExpression(models, input, { lookup: async () => { input.mode = 'shared_offline'; return {}; } });
  expect(result.parts).toEqual([{ kind: 'text', content: '我睡啦' }]);
  expect(requests).toHaveLength(3);
  expect(requests.every(r => r.task.promptPolicy?.facts.mode === 'chat')).toBe(true);
  expect(requests[2].repair).toBeDefined();
});
it('retains the existing repair limit when all action replies are invalid', async () => {
  let calls = 0;
  const models = new ModelClient({ complete: async () => { calls++; return { parts: [{ kind: 'action', content: action }] }; } });
  await expect(runExpression(models, { mode: 'chat' }, { lookup: null })).rejects.toBeInstanceOf(ModelFormatError);
  expect(calls).toBe(3);
});
it('ordinary app repairs both personal and expression actions before public output', async () => {
  const d = setup();
  try {
    saveInput(d.storage, 'a', '晚安');
    const requests: CompletionRequest[] = [];
    let personalCalls = 0, expressionCalls = 0;
    const models = new ModelClient({ complete: async request => {
      requests.push(request);
      if (request.task.name === 'narrative') return narrative;
      if (request.task.name === 'personal_chat') return { emotions: [], reply: ++personalCalls === 1 ? reply : { decision: 'now', intention: '晚安', draft: '我准备睡啦' }, taskChanges: [] };
      if (request.task.name === 'expression') return { parts: [{ kind: ++expressionCalls === 1 ? 'action' : 'text', content: expressionCalls === 1 ? action : '我准备睡啦' }] };
      return emptyMemory;
    } });
    await new HdsiApp({ ...d, models }).runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
    expect(d.sender.sent.map(x => [x.kind, x.payload])).toEqual([['text', '我准备睡啦']]);
    expect(requests.filter(r => r.repair)).toHaveLength(2);
    expect(d.storage.unfinishedTurn()).toBeNull();
  } finally { d.storage.close(); }
});
it('finishes an already attempted legacy action outbox without regenerating or replaying confirmed output', async () => {
  const d = setup();
  try {
    saveInput(d.storage, 'a', '晚安');
    d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'now', intention: '晚安', draft: '晚安' }, taskChanges: [] };
    d.models.outputs.expression = { parts: [{ kind: 'text', content: '晚安' }, { kind: 'text', content: '第二段' }] };
    const send = d.sender.sendItem.bind(d.sender);
    d.sender.sendItem = async item => { if (item.seq === 1) throw Error('unknown send'); return send(item); };
    const app = new HdsiApp(d);
    await expect(app.runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] })).rejects.toThrow('unknown send');
    // Seed the persisted shape written by the previous unrestricted contract.
    const turn = d.storage.unfinishedTurn()!;
    turn.frozenResult!.expression!.parts[1] = { kind: 'action', content: action };
    d.storage.save('turns', turn.id, turn);
    d.storage.saveOutbox({ ...d.storage.outbox(turn.id)[1], kind: 'action', payload: action });
    d.sender.sendItem = send;
    d.models.outputs.expression = { parts: [{ kind: 'text', content: '不可重新生成' }] };
    await app.resumeUnfinishedTurn();
    expect(d.sender.sent.map(x => [x.kind, x.payload])).toEqual([['text', '晚安'], ['action', action]]);
    expect(d.models.calls.filter(x => x.name === 'expression')).toHaveLength(1);
    expect(d.storage.unfinishedTurn()).toBeNull();
  } finally { d.storage.close(); }
});
it('offline user and confirmed character actions reach the next shared narrative', async () => {
  const d = modern();
  try {
    makeSharedFixture(d); configureSharedModels(d);
    const character = d.storage.character(); character.scene.mode = 'shared_offline'; d.storage.set('character', character);
    d.storage.set('runtime', { ...d.storage.runtime(), sharedClock: { ...d.storage.runtime().sharedClock!, mode: 'shared_offline' } });
    const buffer = new InputBuffer(d.storage);
    await buffer.acceptInput({ id: 'water', content: '【动作：把水杯递给她】', receivedAt: NOW });
    d.clock.advance(60_000);
    d.models.outputs.personal_shared = { emotions: [], reply: { decision: 'now', intention: '接杯', draft: '', actions: ['接过水杯'] }, taskChanges: [] };
    d.models.outputs.expression = { parts: [{ kind: 'action', content: '接过水杯' }] };
    await new HdsiApp(d).runTurn({ inputMessageIds: ['water'], taskIds: [], triggerKinds: ['input'], sharedMeta: selectSharedMeta(d.storage, d.clock.now(), ['water'], []) });
    expect(d.sender.sent.map(x => x.kind)).toEqual(['action']);
    expect(d.storage.messages().find(x => x.direction === 'outgoing')?.content).toBe('【动作：接过水杯】');
    d.models.outputs.personal_shared = { emotions: [], reply: { decision: 'none' }, taskChanges: [] };
    d.clock.advance(60_000);
    const next = await new Scheduler(d.storage).collectReady(d.clock.now());
    expect(next).not.toBeNull(); await new HdsiApp(d).runTurn(next!);
    const lastNarrative = d.models.calls.filter(x => x.name === 'narrative_shared').at(-1)!;
    expect(lastNarrative.input.resources.messages.map((x: any) => x.content)).toEqual(expect.arrayContaining(['【动作：把水杯递给她】', '【动作：接过水杯】']));
  } finally { d.storage.close(); }
});
it.each(['动作：推门', '【动作：推门】', '动作:推门'])('repairs online public narration that would render an action marker: %s', async publicNarration => {
  const d = setup();
  try {
    makeSharedFixture(d);
    const requests: CompletionRequest[] = [];
    const result = { ...narrative, publicNarration, progress: '继续', outline: { goal: '游戏', openThreads: [], endingCondition: '结束游戏' }, simulatedUserActions: [] };
    const models = new ModelClient({ complete: async request => {
      requests.push(request);
      return requests.length === 1 ? result : { ...result, publicNarration: '游戏角色推开门，进入下一关。' };
    } });
    const output = await runNarrative(models, true, NOW, NOW, [], { state: d.storage.character() }, { lookup: null }, meta);
    expect((output as any).publicNarration).toBe('游戏角色推开门，进入下一关。');
    expect(requests).toHaveLength(2);
    expect(requests[1].repair?.errors).toMatch(/publicNarration/);
    expect(displayText({ kind: 'narration', payload: (output as any).publicNarration })).toBe('【游戏角色推开门，进入下一关。】');
  } finally { d.storage.close(); }
});
it('keeps offline public action narration permitted', async () => {
  const d = setup();
  try {
    makeSharedFixture(d); const state = d.storage.character(); state.scene.mode = 'shared_offline';
    const result = { ...narrative, publicNarration: '动作：接过水杯', progress: '继续', outline: { goal: '散步', openThreads: [], endingCondition: '结束散步' }, simulatedUserActions: [] };
    const models = new ModelClient({ complete: async () => result });
    expect(await runNarrative(models, true, NOW, NOW, [], { state }, { lookup: null }, meta)).toMatchObject(result);
  } finally { d.storage.close(); }
});
it('freezes online public narration permission across lookup and repair', async () => {
  const d = setup();
  try {
    makeSharedFixture(d); const state = d.storage.character();
    const requests: CompletionRequest[] = [];
    const result = { ...narrative, publicNarration: '动作：推门', progress: '继续', outline: { goal: '游戏', openThreads: [], endingCondition: '结束游戏' }, simulatedUserActions: [] };
    const models = new ModelClient({ complete: async request => {
      requests.push(request);
      return requests.length === 1 ? { lookupDetails: '门口情况' } : requests.length === 2 ? result : { ...result, publicNarration: '游戏界面亮起' };
    } });
    const output = await runNarrative(models, true, NOW, NOW, [], { state }, { lookup: async () => { state.scene.mode = 'shared_offline'; return {}; } }, meta);
    expect(output).toMatchObject({ publicNarration: '游戏界面亮起' });
    expect(requests).toHaveLength(3);
    expect(requests.every(r => r.task.promptPolicy?.facts.mode === 'shared_online')).toBe(true);
    expect(requests[2].repair?.errors).toMatch(/publicNarration/);
  } finally { d.storage.close(); }
});
