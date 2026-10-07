import { it, expect } from 'vitest';
import { generateTurn } from '../src/app';
import { ModelClient } from '../src/model/client';
import { setup, saveInput, narrative } from './helpers';

it('implements the past before reaction and expression without changing official state', async () => {
  const d = setup(); saveInput(d.storage, 'a', '手机是什么型号');
  d.storage.set('character', { ...d.storage.character(), emotions: [{ label: '失落', degree: '一点', reason: '旧事' }] });
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'now', intention: '回答', draft: '某手机' }, taskChanges: [], nextPlan: '想换新手机' };
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '某手机呀' }] };
  const result = await generateTurn(d, { inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }, 'turn-a');
  expect(d.models.calls.map(c => c.name)).toEqual(['narrative', 'personal_chat', 'expression']);
  expect(JSON.stringify(d.models.calls[0].input)).not.toContain('手机是什么型号');
  expect(d.models.calls[1].input.visibleMessages[0].content).toBe('手机是什么型号');
  expect(d.models.calls[2].input.intent.draft).toBe('某手机');
  expect(result.candidate.nextState.emotions).toEqual([]);
  expect(result.candidate.nextState.scene.activity).toBeNull();
  expect(d.storage.character().emotions).toHaveLength(1);
  expect(d.storage.read('messages', 'a')!.seenTurnId).toBeNull();
  d.storage.close();
});

it('never leaks unread content through model inputs and skips expression for silence', async () => {
  const d = setup(); saveInput(d.storage, 'a', '秘密手机型号');
  d.models.outputs.narrative = { ...narrative, currentScene: { description: '洗澡', activity: { description: '洗澡', startsAt: '2026-10-07T09:50:00+08:00', expectedEndAt: '2026-10-07T10:15:00+08:00', phoneAccess: false } } };
  const r = await generateTurn(d, { inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }, 'turn-a');
  expect(JSON.stringify(d.models.calls)).not.toContain('秘密手机型号');
  expect(d.models.calls.map(c => c.name)).toEqual(['narrative']);
  expect(r.candidate.visibleMessageIds).toEqual([]);
  expect(r.items).toEqual([]);
  d.storage.close();
});

it('does not express a silent reply', async () => {
  const d = setup(); saveInput(d.storage, 'a', '好');
  await generateTurn(d, { inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }, 'a');
  expect(d.models.calls.map(c => c.name)).toEqual(['narrative', 'personal_chat']);
  d.storage.close();
});

it('repairs malformed controls twice and never replaces them with defaults', async () => {
  const requests: any[] = [];
  const client = new ModelClient({ complete: async (r: any) => { requests.push(r); return '{}'; } });
  const task = { name: 'control', prompt: '', schema: {}, parse: (value: any) => { if (!value.reply) throw new Error('reply: required'); return value; } };
  await expect(client.runModel(task, {})).rejects.toThrow('control');
  expect(requests).toHaveLength(3);
  expect(requests[1].repair.errors).toContain('reply: required');
});

it('rejects future experiences through the same repair path', async () => {
  const d = setup();
  d.models.outputs.narrative = { ...narrative, experiences: [{ happenedAt: '2026-10-07T11:00:00+08:00', description: '未来成绩', relatedEventIds: [] }] };
  await expect(generateTurn(d, { inputMessageIds: [], taskIds: [], triggerKinds: ['autonomous'] }, 'a')).rejects.toThrow('happenedAt');
  d.storage.close();
});
