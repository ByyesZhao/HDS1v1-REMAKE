import { it, expect } from 'vitest';
import { HdsiApp, generateTurn } from '../src/app';
import type { TurnRecord } from '../src/types';
import { setup, saveInput, NOW } from './helpers';
import { MemoryStore } from '../src/memory/store';

function unfinished(id = 'a'): TurnRecord {
  return { id, inputMessageIds: ['a'], triggerTaskIds: [], triggerKinds: ['input'], at: NOW, completedAt: null, frozenResult: null, outputComplete: false, done: false, batchIds: ['batch-a'], entryMode: 'chat' };
}
it('sends in order with real confirmation times, then commits once', async () => {
  const d = setup(); saveInput(d.storage, 'a', '你好');
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'now', intention: '回答', draft: '你好' }, taskChanges: [] };
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '你好' }, { kind: 'text', content: '笑' }, { kind: 'text', content: '哈'.repeat(13) }] };
  const app = new HdsiApp(d);
  await app.runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
  expect(d.sender.sent.map(i => i.payload)).toEqual(['你好', '笑', '哈'.repeat(13)]);
  expect(Date.parse(d.clock.now()) - Date.parse(NOW)).toBe(9500);
  expect(d.storage.unfinishedTurn()).toBeNull();
  expect(d.storage.read('messages', 'a')!.seenTurnId).toBeTruthy();
  expect(d.storage.all('turns')[0].frozenResult).toBeNull();
  expect(d.models.calls.filter(c => c.name === 'memory')).toHaveLength(1);
  d.storage.close();
});
it('regenerates an unattempted frozen turn at the recovery time with the same ID', async () => {
  const d = setup(); saveInput(d.storage, 'a', '你好');
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'now', intention: '回复', draft: '旧稿' }, taskChanges: [] };
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '旧稿' }] };
  const r = await generateTurn(d, { inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }, 'a');
  d.storage.save('turns', 'a', { ...unfinished(), frozenResult: r.candidate });
  r.items.forEach(i => d.storage.saveOutbox(i)); d.storage.save('post_jobs', 'a', { turnId: 'a', result: null });
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '新稿' }] };
  d.clock.advance(60_000);
  await new HdsiApp(d).resumeUnfinishedTurn();
  expect(d.sender.sent.map(i => i.payload)).toEqual(['新稿']);
  expect(d.storage.read('turns', 'a')!.at).toBe('2026-10-07T02:01:00.000Z');
  d.storage.close();
});
it('keeps attempted text, skips confirmed segments and resends unknown segments', async () => {
  const d = setup(); saveInput(d.storage, 'a', '你好');
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'now', intention: '回复', draft: '稿' }, taskChanges: [] };
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '第一段' }, { kind: 'text', content: '第二段' }, { kind: 'text', content: '第三段' }] };
  const send = d.sender.sendItem.bind(d.sender); let fail = true;
  d.sender.sendItem = async item => { if (item.seq === 1 && fail) throw new Error('unknown'); return send(item); };
  const app = new HdsiApp(d);
  await expect(app.runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] })).rejects.toThrow('unknown');
  const t = d.storage.unfinishedTurn()!;
  expect(d.storage.runtime().paused).toBe(true);
  expect(d.storage.outbox(t.id).map(i => i.status)).toEqual(['confirmed', 'retry', 'pending']);
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '不该重生成' }] }; fail = false;
  await app.resumeUnfinishedTurn();
  expect(d.sender.sent.map(i => i.payload)).toEqual(['第一段', '第二段', '第三段']);
  expect(d.models.calls.filter(c => c.name === 'expression')).toHaveLength(1);
  d.storage.close();
});
it('resumes only postprocessing and never awakens a memory twice after commit', async () => {
  const d = setup(); saveInput(d.storage, 'a', '记得那次吗');
  d.storage.save('memories', 'old', { id: 'old', kind: 'long', content: '旧事', topics: ['旧事'], sourceIds: [], importance: 'high', mentions: 1, createdAt: NOW, reinforcedAt: NOW, turnId: 'old' });
  const store=new MemoryStore(d.storage);store.migrate(NOW);
  const r = await generateTurn(d, { inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }, 'a');
  d.storage.save('turns', 'a', { ...unfinished(), frozenResult: r.candidate, outputComplete: true });
  d.storage.save('post_jobs', 'a', { turnId: 'a', result: { schemaVersion:3,shortTermChanges: [], longTermChanges: [{ action: 'awaken', id: 'old', reason: '真实重谈',sourceIds:['a'] }], detailChanges: [] } });
  const count = d.models.calls.length;
  const app = new HdsiApp(d); await app.resumeUnfinishedTurn(); await app.resumeUnfinishedTurn();
  expect(d.models.calls).toHaveLength(count);
  expect(d.sender.sent).toEqual([]);
  expect(store.canonical('old')!.totalAwakenings).toBe(1);
  expect(d.storage.read('turns', 'a')!.done).toBe(true);
  d.storage.close();
});
it('commits silent turns and saves new input while output is busy', async () => {
  const d = setup(); saveInput(d.storage, 'a', '好');
  const app = new HdsiApp(d);
  await app.runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
  expect(d.storage.read('messages', 'a')!.seenTurnId).toBeTruthy();
  expect(d.sender.sent).toEqual([]);
  expect(d.models.calls.map(c => c.name)).toEqual(['narrative', 'personal_chat', 'memory']);
  d.storage.close();
});

it('does not run personal models if an unsent autonomous turn is recovered during sleep', async () => {
  const d = setup();
  d.storage.set('character', { ...d.storage.character(), sleep: { sleepAt: NOW, wakeAt: '2026-10-07T11:00:00+08:00' }, nextAutonomousAt: NOW });
  d.storage.save('turns', 'a', { ...unfinished(), inputMessageIds: [], triggerKinds: ['autonomous'] });
  await new HdsiApp(d).resumeUnfinishedTurn();
  expect(d.models.calls).toEqual([]);
  expect(d.storage.character().nextAutonomousAt).toBeNull();
  expect(d.storage.character().narratedUntil).toBe(NOW);
  d.storage.close();
});
