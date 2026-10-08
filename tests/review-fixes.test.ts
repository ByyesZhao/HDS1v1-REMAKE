import { it, expect } from 'vitest';
import { HdsiApp } from '../src/app';
import { personalTask, memoryTask } from '../src/model/contracts';
import type { ScheduledTask } from '../src/types';
import { setup, saveInput, NOW, silent, emptyMemory } from './helpers';
import { MemoryStore } from '../src/memory/store';

const oldCheck: ScheduledTask = { id: 'check', kind: 'check_messages', at: NOW, description: '检查消息', checkReason: 'unread', messageIds: ['a'], status: 'pending' };
it.each([
  { action: 'create', task: { ...oldCheck, at: '2026-10-07T09:59:00+08:00' } },
  { action: 'create', task: oldCheck },
  { action: 'update', id: 'check', task: { at: '2026-10-07T09:59:00+08:00' } },
  { action: 'update', id: 'check', task: { at: NOW } },
  { action: 'update', id: 'check', task: { description: '仍检查' } },
])('rejects a personal check change whose merged deadline is not future: %j', change => {
  expect(() => personalTask('chat', NOW, [oldCheck], 'chat', ['a']).parse({ ...silent, taskChanges: [change] })).toThrow(/taskChanges.*at/);
});
it('allows future check changes and cancellation of an existing due check', () => {
  const task = personalTask('chat', NOW, [oldCheck], 'chat', ['a']);
  expect(() => task.parse({ ...silent, taskChanges: [{ action: 'create', task: { ...oldCheck, at: '2026-10-07T10:01:00+08:00' } }] })).not.toThrow();
  expect(() => task.parse({ ...silent, taskChanges: [{ action: 'update', id: 'check', task: { at: '2026-10-07T10:01:00+08:00' } }] })).not.toThrow();
  expect(() => task.parse({ ...silent, taskChanges: [{ action: 'cancel', id: 'check' }] })).not.toThrow();
});
it('does not apply the personal check deadline rule to appointments', () => {
  for (const kind of ['appointment'] as const) {
    expect(() => personalTask('chat', NOW, [], 'chat', []).parse({ ...silent, taskChanges: [{ action: 'create', task: { kind, at: NOW, description: '已有安排' } }] })).not.toThrow();
  }
});

const shortCreate = {action:'create',clientRef:'one',content:'摘要',eventSummary:'事件',feelingSummary:'',topics:[],importance:'normal'};
it.each([
  { ...emptyMemory, shortTermChanges: [{ ...shortCreate, sourceIds: [] }] },
  { ...emptyMemory, longTermChanges: [{ action: 'awaken', id: 'old', reason:'真实重谈', sourceIds: [] }] },
  { ...emptyMemory, detailChanges: [{ action: 'update', key: 'phone', value: '苹果', aliases: [], reason: '换机', sourceIds: [] }] },
])('rejects a new memory or detail without a current source: %j', result => {
  expect(() => memoryTask(['a'], []).parse(result)).toThrow(/sourceIds/);
});
it('accepts no new content and validates current sources for short creation and explicit awakening', () => {
  const task = memoryTask(['a'], ['old']);
  expect(task.parse(emptyMemory)).toEqual(emptyMemory);
  expect(() => task.parse({ ...emptyMemory,shortTermChanges: [{ ...shortCreate,sourceIds: ['a'] }], longTermChanges: [{action:'awaken',id:'old',reason:'真实重谈',sourceIds:['a']}], detailChanges: [{ action: 'update', key: 'phone', value: '苹果', aliases: [], reason: '换机', sourceIds: ['a'] }] })).not.toThrow();
  expect(() => task.parse({ ...emptyMemory, shortTermChanges: [{ ...shortCreate, sourceIds: ['old-message'] }] })).toThrow(/sourceIds/);
});

it('keeps relevant long memory for the organizer when unused recent history is large', async () => {
  const d = setup();
  try {
    d.config.historyBudget = 2000;
    d.storage.save('messages', 'history', { id: 'history', content: '旧聊天'.repeat(4000), receivedAt: NOW, platformMessageIds: [], direction: 'outgoing', batchId: null, seenTurnId: null, turnId: 'old', outboxSeq: 0 });
    d.storage.save('memories', 'old', { id: 'old', kind: 'long', content: '以前聊过手机', topics: ['手机'], sourceIds: ['history'], importance: 'high', mentions: 1, reinforcedAt: NOW, createdAt: NOW, turnId: 'old' });
    d.storage.save('details', 'phone', { key: 'phone', value: '某手机', aliases: ['手机'], effectiveAt: NOW });
    new MemoryStore(d.storage).migrate(NOW);
    saveInput(d.storage, 'a', '聊聊手机');
    await new HdsiApp(d).runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
    const input = d.models.calls.find(c => c.name === 'memory')!.input;
    expect(input.resources.owners.filter((r:any)=>r.kind!=='detail').map((m: any) => m.id)).toEqual(['old']);
    expect(input.resources.owners.filter((r:any)=>r.kind==='detail').map((x: any) => x.key)).toEqual(['phone']);
  } finally { d.storage.close(); }
});
it('bounds the organizer retrieval budget while keeping the highest ranked related memory', async () => {
  const d = setup();
  try {
    d.config.historyBudget = 1500;
    for (const [id, importance] of [['best', 'high'], ['other', 'normal']] as const) {
      d.storage.save('memories', id, { id, kind: 'long', content: '手机'.repeat(140), topics: ['手机'], sourceIds: [], importance, mentions: 1, reinforcedAt: NOW, createdAt: NOW, turnId: 'old' });
    }
    new MemoryStore(d.storage).migrate(NOW);
    saveInput(d.storage, 'a', '手机');
    await new HdsiApp(d).runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
    const input = d.models.calls.find(c => c.name === 'memory')!.input;
    expect(input.resources.owners.filter((r:any)=>r.kind!=='detail').map((m: any) => m.id)).toEqual(['best']);
    expect(JSON.stringify({ details: input.resources.owners.filter((r:any)=>r.kind==='detail'), retrieved: input.resources.owners.filter((r:any)=>r.kind!=='detail') }).length).toBeLessThanOrEqual(1500);
  } finally { d.storage.close(); }
});
it.each([
  { aliases: [], expected: ['手机', '型号'] },
  { aliases: ['手机', '新机'], expected: ['手机', '新机'] },
])('preserves old aliases only for an empty alias update: %j', async ({ aliases, expected }) => {
  const d = setup();
  try {
    d.storage.save('details', 'phone', { key: 'phone', value: '某手机', aliases: ['手机', '型号'], effectiveAt: NOW });
    saveInput(d.storage, 'a', '已经换机');
    d.models.outputs.memory = { ...emptyMemory, detailChanges: [{ action: 'update', key: 'phone', value: '苹果', aliases, reason: '用户修订', sourceIds: ['a'] }] };
    await new HdsiApp(d).runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
    expect(d.storage.read('details', 'phone')).toMatchObject({ value: '苹果', aliases: expected });
    expect(d.storage.all('detail_history')[0]).toMatchObject({ previousValue: '某手机', newValue: '苹果', sourceIds: ['a'] });
  } finally { d.storage.close(); }
});
