import { it, expect } from 'vitest';
import { HdsiApp } from '../src/app';
import { setup, saveInput, NOW, narrative } from './helpers';
import { Scheduler } from '../src/host/scheduler';

function makeShared(d: ReturnType<typeof setup>, mode: 'shared_online' | 'shared_offline') {
  d.storage.set('character', { ...d.storage.character(), scene: { mode, description: '共同活动', activity: { description: '游戏', startsAt: NOW, expectedEndAt: null, phoneAccess: false }, shared: { title: '一起玩', progress: '刚开始', lastPublicNode: '', nextStepAt: null } } });
  d.models.outputs.narrative_shared = { ...narrative, currentScene: { description: '继续活动', activity: { description: '游戏', startsAt: NOW, expectedEndAt: null, phoneAccess: false } }, publicNarration: '门口亮起灯', progress: '走到门口', nextStepAt: null };
  d.models.outputs.personal_shared = { emotions: [], reply: { decision: 'now', intention: '反应', draft: '一起进去吧' }, taskChanges: [] };
  d.models.outputs.expression = { parts: [{ kind: 'action', content: '点头' }, { kind: 'text', content: '一起进去吧' }] };
}
it('starts only after confirmation, emits the marker and schedules the immediate first public node', async () => {
  const d = setup(); saveInput(d.storage, 'a', '好，现在开始');
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'now', intention: '确认', draft: '好' }, taskChanges: [], sharedChange: { action: 'start', mode: 'shared_offline', title: '一起散步' } };
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '好' }] };
  await new HdsiApp(d).runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
  expect(d.models.calls[0].name).toBe('narrative');
  expect(d.models.calls.find(c => c.name === 'expression')!.input.mode).toBe('shared_offline');
  expect(d.sender.sent.map(i => i.payload)).toEqual(['共同活动开始', '好']);
  expect(d.storage.character().scene.mode).toBe('shared_offline');
  expect(d.storage.character().scene.shared!.lastPublicNode).toBe('');
  expect((await new Scheduler(d.storage).collectReady(d.clock.now()))!.triggerKinds).toContain('scene_step');
  d.storage.close();
});
it.each(['shared_online', 'shared_offline'] as const)('keeps closed scene input visible without phone access in %s', async mode => {
  const d = setup(); makeShared(d, mode); saveInput(d.storage, 'a', '【动作：推门】');
  await new HdsiApp(d).runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
  expect(d.models.calls[0].input.visibleMessages[0].content).toBe('【动作：推门】');
  expect(d.models.calls[1].input.visibleMessages[0].content).toBe('【动作：推门】');
  expect(d.sender.sent.map(i => i.kind)).toEqual(['narration', 'action', 'text']);
  expect(d.sender.sent[0].payload).toBe('门口亮起灯');
  expect(d.storage.character().scene.shared!.lastPublicNode).toBe('门口亮起灯');
  d.storage.close();
});
it('ends after the public node and reaction without revoking current input visibility', async () => {
  const d = setup(); makeShared(d, 'shared_offline'); saveInput(d.storage, 'a', '结束吧');
  d.storage.save('tasks', 'node', { id: 'node', kind: 'scene_step', at: '2026-10-07T11:00:00+08:00', description: '下一节点', status: 'pending' });
  d.models.outputs.personal_shared.sharedChange = { action: 'end' };
  await new HdsiApp(d).runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
  expect(d.sender.sent.map(i => i.payload)).toEqual(['门口亮起灯', '点头', '一起进去吧', '共同活动结束']);
  expect(d.storage.read('messages', 'a')!.seenTurnId).toBeTruthy();
  expect(d.storage.character().scene).toMatchObject({ mode: 'chat', shared: null });
  expect(d.storage.read('tasks', 'node')!.status).toBe('cancelled');
  d.storage.close();
});
it('sends start and end markers even without any character speech', async () => {
  const d = setup(); saveInput(d.storage, 'a', '现在开始');
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'none' }, taskChanges: [], sharedChange: { action: 'start', mode: 'shared_online', title: '游戏' } };
  const app = new HdsiApp(d); await app.runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
  expect(d.sender.sent.map(i => i.payload)).toEqual(['共同活动开始']);
  d.models.outputs.narrative_shared = { ...narrative, publicNarration: null, progress: '结束', nextStepAt: null };
  d.models.outputs.personal_shared = { emotions: [], reply: { decision: 'none' }, taskChanges: [], sharedChange: { action: 'end' } };
  await app.runTurn((await new Scheduler(d.storage).collectReady(d.clock.now()))!);
  expect(d.sender.sent.map(i => i.payload)).toEqual(['共同活动开始', '共同活动结束']);
  expect(d.models.calls.filter(c => c.name === 'expression')).toHaveLength(0);
  d.storage.close();
});
