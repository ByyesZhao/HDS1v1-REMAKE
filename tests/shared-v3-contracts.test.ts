import { it, expect } from 'vitest';
import { narrativeTask, personalTask } from '../src/model/contracts';
import { narrative, silent, NOW, setup } from './helpers';
import { makeSharedFixture } from './shared-v3-fixture';
import { selectSharedMeta } from '../src/host/shared';
import { ModelClient, ChatCompletionsTransport } from '../src/model/client';
import type { SharedTurnMeta, SharedOutline } from '../src/types';
const old: SharedOutline = { goal: '吃饭', openThreads: ['取餐', '结账'], endingCondition: '吃完各自回去' };
const result = { ...narrative, publicNarration: '你取餐后回到桌边', progress: '取餐完成', outline: old, simulatedUserActions: [] };
function meta(phase: SharedTurnMeta['phase'] = 'ongoing', allowed = true): SharedTurnMeta {
  const d = setup(); makeSharedFixture(d); const m = selectSharedMeta(d.storage, '2026-10-07T10:01:00+08:00', [], [])!; d.storage.close();
  return { ...m, phase, allowSimulatedUserActions: allowed };
}
const task = (m = meta(), previous: SharedOutline | null = old) => narrativeTask(true, NOW, NOW, [], m, previous);
it.each([true, false])('frozen shared permission selects one system prompt and preserves it across repair: %s', async allowed => {
  const requests: any[] = [];
  const transport = new ChatCompletionsTransport(() => ({ baseUrl: 'https://test.invalid', apiKey: 'test', model: 'test', reasoningEffort: 'low' }), async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(requests.length === 1 ? {} : result) } }] }));
  });
  const m = meta('ongoing', allowed), selected = task(m);
  await new ModelClient(transport).runModel(selected, { sharedMeta: m });
  expect(requests).toHaveLength(2);
  const system = requests[0].messages[0].content;
  expect(system).toContain(allowed ? '允许代写双方' : '禁止新增用户动作');
  expect(system).not.toContain(allowed ? '禁止新增用户动作' : '允许代写双方');
  expect(system).not.toContain('仅sharedMeta.allowSimulatedUserActions=true时');
  expect(system).toContain('goal'); expect(system).toContain('final');
  expect(requests[1].messages[0].content).toBe(system);
  expect(JSON.parse(requests[1].messages[1].content).repair).toBeDefined();
  expect(JSON.parse(requests[1].messages[1].content).input.sharedMeta.allowSimulatedUserActions).toBe(allowed);
});
it('wrap whitespace compatibility keeps stored originals, without semantic matching or resurrecting removed threads', () => {
  const previous = { ...old, openThreads: ['  结账\n 后收拾  ', '取餐'] };
  const parsed = task(meta('wrap_up'), previous).parse({ ...result, outline: { ...old, openThreads: ['结账  后收拾'] } });
  expect((parsed as typeof result).outline.openThreads).toEqual(['  结账\n 后收拾  ']);
  for (const threads of [['付钱后整理'], ['取餐', '逛新店']]) expect(() => task(meta('wrap_up'), previous).parse({ ...result, outline: { ...old, openThreads: threads } })).toThrow(/openThreads/);
  expect(() => task(meta('wrap_up'), { ...old, openThreads: ['结账'] }).parse({ ...result, outline: { ...old, openThreads: ['取餐'] } })).toThrow(/openThreads/);
});
it('shared_result_has_no_model_deadline: requires meta and new fields, rejects writable nextStepAt', () => {
  expect(task().parse(result)).toEqual(result);
  expect(() => task().parse({ ...result, nextStepAt: null })).toThrow();
  const { outline, ...missing } = result; expect(() => task().parse(missing)).toThrow();
  expect(() => narrativeTask(true, NOW, NOW).parse(result)).toThrow(/sharedMeta/);
});
it('simulated_actions_must_be_public: permission and verbatim disclosure are both required', () => {
  const actions = ['你取餐后回到桌边'];
  expect(() => task(meta('ongoing', false)).parse({ ...result, simulatedUserActions: actions })).toThrow(/simulatedUserActions/);
  expect(() => task().parse({ ...result, publicNarration: null, experiences: [{ happenedAt: NOW, description: actions[0], relatedEventIds: [] }], simulatedUserActions: actions })).toThrow(/publicNarration/);
  expect(() => task().parse({ ...result, simulatedUserActions: actions })).not.toThrow();
  expect(narrativeTask(false, NOW, NOW).parse(narrative)).not.toHaveProperty('simulatedUserActions');
});
it('final_requires_public_close_and_end: final closes both contracts and all scene tasks are program-owned', () => {
  const m = meta('final'), closed = { ...result, outline: { ...old, openThreads: [] } };
  expect(() => task(m).parse({ ...closed, publicNarration: ' ' })).toThrow(/publicNarration/);
  expect(() => task(m).parse(closed)).not.toThrow();
  const p = personalTask('shared', NOW, [], 'shared_online', [], m, closed.publicNarration);
  expect(() => p.parse(silent)).toThrow(/sharedChange/);
  expect(() => p.parse({ ...silent, sharedChange: { action: 'end' } })).not.toThrow();
  expect(() => personalTask('shared', NOW, [], 'shared_online', [], meta(), result.publicNarration).parse({ ...silent, sharedChange: { action: 'end' } })).not.toThrow();
  const scene = { id: 'scene:activity-a', kind: 'scene_step' as const, at: NOW, description: '节点', status: 'pending' as const };
  for (const change of [{ action: 'create', task: scene }, { action: 'update', id: scene.id, task: { at: NOW } }, { action: 'cancel', id: scene.id }]) {
    expect(() => personalTask('shared', NOW, [scene], 'shared_online', [], meta()).parse({ ...silent, taskChanges: [change] })).toThrow(/scene_step/);
  }
  expect(() => personalTask('chat', NOW, [], 'chat', []).parse({ ...silent, taskChanges: [{ action: 'create', task: scene }] })).toThrow(/scene_step/);
});
it('outline_closes_by_phase: wrap keeps original strings and final leaves no pending threads', () => {
  expect(() => task().parse({ ...result, outline: { ...old, openThreads: ['取餐', '结账', '逛新店'] } })).not.toThrow();
  expect(() => task(meta('wrap_up')).parse({ ...result, outline: { ...old, openThreads: ['结账'] } })).not.toThrow();
  for (const openThreads of [['逛新店'], ['结账完毕']]) expect(() => task(meta('wrap_up')).parse({ ...result, outline: { ...old, openThreads } })).toThrow(/openThreads/);
  expect(() => task(meta('final')).parse(result)).toThrow(/openThreads/);
  expect(() => task(meta('opening'), null).parse(result)).not.toThrow();
  expect(() => task({ ...meta('final'), stepNumber: 1, maxSteps: 1 }, null).parse({ ...result, outline: { ...old, openThreads: [] } })).not.toThrow();
});
it('prompts_keep_actor_and_fact_boundaries: task instructions preserve the agreed authorship rules', () => {
  const n = task().prompt, p = personalTask('shared', NOW, [], 'shared_offline', [], meta()).prompt;
  for (const text of ['【动作：', '用户台词', '心理', '稳定性格', '能力', '偏好', '关系设定', 'goal', 'endingCondition', '共享模拟经历', '意图']) expect(n).toContain(text);
  expect(p).toContain('自愿'); expect(p).toContain('scene_step');
});
