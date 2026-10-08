import { it, expect } from 'vitest';
import { narrativeTask, personalTask } from '../src/model/contracts';
import { ModelClient } from '../src/model/client';
import { HdsiApp } from '../src/app';
import { Scheduler } from '../src/host/scheduler';
import { InputBuffer } from '../src/host/input';
import { setup, NOW, narrative, silent, emptyMemory } from './helpers';
import { makeSharedFixture, configureSharedModels } from './shared-v3-fixture';
import type { SharedTurnMeta } from '../src/types';

const shared = { ...narrative, publicNarration: null, progress: '继续', outline: { goal: '游戏', openThreads: [], endingCondition: '本次游戏结束' }, simulatedUserActions: [] };
function meta(step = 2, maxSteps = 20, phase: SharedTurnMeta['phase'] = 'ongoing'): SharedTurnMeta {
  return { activityId: 'activity-a', stepNumber: step, maxSteps, idleSeconds: 60, advanceReason: 'automatic', phase, controlRequestIds: [], sceneTaskId: 'scene:activity-a', allowSimulatedUserActions: true };
}
it.each([[20, 'opening'], [3, 'wrap_up'], [2, 'wrap_up'], [1, 'final']] as const)('first shared node requires public text with maxSteps=%s', (max, phase) => {
  const task = narrativeTask(true, NOW, NOW, [], meta(1, max, phase), null);
  expect(() => task.parse(shared)).toThrow(/publicNarration/);
  expect(() => task.parse({ ...shared, publicNarration: '游戏界面亮起，第一关已经准备好。' })).not.toThrow();
});
it('middle shared node can remain public-silent', () => {
  expect(() => narrativeTask(true, NOW, NOW, [], meta()).parse(shared)).not.toThrow();
  expect(() => personalTask('shared', NOW, [], 'shared_online', [], meta(), null).parse(silent)).not.toThrow();
});
it.each([3, 10])('soft pacing imposes no minimum or forced end at step %s', step => {
  const sharedMeta = meta(step);
  const task = personalTask('shared', NOW, [], 'shared_online', [], sharedMeta, '本次游戏已结束，双方回到大厅。');
  expect(() => task.parse({ ...silent, sharedChange: { action: 'end' } })).not.toThrow();
  expect(() => task.parse(silent)).not.toThrow();
});
it.each([null, '  '])('early end rejects missing public narration %s', publicNarration => {
  expect(() => personalTask('shared', NOW, [], 'shared_online', [], meta(), publicNarration).parse({ ...silent, sharedChange: { action: 'end' } })).toThrow(/publicNarration/);
});
it('early end needs no character speech when narration already closes', async () => {
  const d = setup(); makeSharedFixture(d); configureSharedModels(d); d.clock.advance(60_000);
  d.models.outputs.narrative_shared = { ...shared, publicNarration: '最后一局结算完成，这次游戏告一段落。' };
  d.models.outputs.personal_shared = { ...silent, sharedChange: { action: 'end' } };
  await new HdsiApp(d).runTurn((await new Scheduler(d.storage).collectReady(d.clock.now()))!);
  expect(d.sender.sent.map(item => item.payload)).toEqual(['最后一局结算完成，这次游戏告一段落。', '共同活动结束']);
  expect(d.storage.character().scene.mode).toBe('chat'); d.storage.close();
});
it('personal repair can defer early end without regenerating silent narration', async () => {
  const d = setup(); makeSharedFixture(d); d.clock.advance(60_000); let personalCalls = 0, narrativeCalls = 0;
  const models = new ModelClient({ complete: async request => {
    if (request.task.name === 'narrative_shared') { narrativeCalls++; return shared; }
    if (request.task.name === 'personal_shared') {
      personalCalls++;
      return personalCalls === 1 ? { ...silent, sharedChange: { action: 'end' } } : { ...silent, nextPlan: '下轮公开交代收尾后结束游戏' };
    }
    return emptyMemory;
  } });
  await new HdsiApp({ ...d, models }).runTurn((await new Scheduler(d.storage).collectReady(d.clock.now()))!);
  expect(personalCalls).toBe(2); expect(narrativeCalls).toBe(1);
  expect(d.sender.sent).toEqual([]); expect(d.storage.character().scene.shared!.completedSteps).toBe(2);
  expect(d.storage.character().plan).toBe('下轮公开交代收尾后结束游戏'); d.storage.close();
});
it('invalid early end pauses without marker or consuming selected control', async () => {
  const d = setup(); makeSharedFixture(d); let personalCalls = 0;
  await new InputBuffer(d.storage).acceptInput({ id: 'advance', content: '【推进】', receivedAt: NOW });
  const models = new ModelClient({ complete: async request => {
    if (request.task.name === 'narrative_shared') return shared;
    if (request.task.name === 'personal_shared') { personalCalls++; return { ...silent, sharedChange: { action: 'end' } }; }
    return emptyMemory;
  } });
  await expect(new HdsiApp({ ...d, models }).runTurn((await new Scheduler(d.storage).collectReady(NOW))!)).rejects.toThrow(/publicNarration/);
  expect(personalCalls).toBe(3); expect(d.storage.runtime().paused).toBe(true);
  expect(d.sender.sent).toEqual([]); expect(d.storage.character().scene.shared!.completedSteps).toBe(1);
  expect(d.storage.read('control_requests', 'advance')!.status).toBe('pending'); d.storage.close();
});
