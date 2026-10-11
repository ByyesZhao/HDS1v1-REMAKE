import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { HdsiApp, generateTurn } from '../src/app';
import { SerialHost } from '../src/host/runtime';
import { Scheduler } from '../src/host/scheduler';
import { finishPostprocessing, freezeTurn } from '../src/recovery';
import { Storage } from '../src/storage';
import type { TurnRecord } from '../src/types';
import { NOW, emptyMemory, setup } from './helpers';

it('starts the real Host once and consumes a description-only appointment without another turn or NOW deadline', async () => {
  const d = setup();
  d.storage.save('tasks', 'appointment', { id: 'appointment', kind: 'appointment', at: NOW, description: '旧描述', status: 'pending' });
  let calls = 0;
  d.models.outputs.personal_chat = () => {
    if (++calls > 1) throw new Error('unexpected repeated appointment turn');
    return { emotions: [], reply: { decision: 'none' }, taskChanges: [{ action: 'update', id: 'appointment', task: { description: '新描述' } }] };
  };
  const errors: unknown[] = [];
  const host = new SerialHost(new HdsiApp(d), { timers: false, onError: error => errors.push(error) });
  try {
    await host.start();
    expect(d.storage.read('tasks', 'appointment')).toMatchObject({ status: 'completed', description: '新描述' });
    expect(d.storage.all('turns')).toHaveLength(1);
    expect(d.models.calls.filter(c => c.name === 'narrative')).toHaveLength(1);
    expect(d.models.calls.filter(c => c.name === 'personal_chat')).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(d.storage.all('messages')).toEqual([]);
    const deadline = await new Scheduler(d.storage).nextDeadline(d.clock.now());
    expect(deadline === null || Date.parse(deadline) > Date.parse(NOW)).toBe(true);
  } finally { await host.stop(); d.storage.close(); }
});

it.each([
  { name: 'metadata-only', patch: { description: '新描述' }, expected: 'completed' },
  { name: 'future rescheduling after clock advances', patch: { at: '2026-10-07T10:05:00+08:00' }, expected: 'pending' },
])('recovers an old frozen candidate and stored post result exactly once: $name', async ({ patch, expected }) => {
  const dir = mkdtempSync(join(tmpdir(), 'hdsi-r1-'));
  const path = join(dir, 'story.sqlite');
  const d = setup(); const initial = d.storage.character(); const runtime = d.storage.runtime();
  d.storage.close(); d.storage = new Storage(path); d.storage.set('character', initial); d.storage.set('runtime', runtime);
  try {
    d.storage.save('tasks', 'appointment', { id: 'appointment', kind: 'appointment', at: NOW, description: '旧描述', status: 'pending' });
    d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'now', intention: '确认', draft: '确认' }, taskChanges: [{ action: 'update', id: 'appointment', task: patch }] };
    d.models.outputs.expression = { parts: [{ kind: 'text', content: '已确认的输出' }] };
    const record: TurnRecord = { id: 'legacy', inputMessageIds: [], triggerTaskIds: ['appointment'], triggerKinds: ['appointment'], at: NOW, completedAt: null, frozenResult: null, outputComplete: false, done: false, batchIds: [], entryMode: 'chat' };
    const generated = await generateTurn(d, { inputMessageIds: [], taskIds: ['appointment'], triggerKinds: ['appointment'] }, record.id);
    freezeTurn(d, record, generated.candidate, generated.items);
    for (const item of d.storage.outbox(record.id)) d.storage.saveOutbox({ ...item, status: 'confirmed', confirmedAt: NOW, platformMessageIds: ['previously-sent'] });
    const frozen = { ...d.storage.read('turns', record.id)!, outputComplete: true };
    d.storage.save('turns', record.id, frozen);
    d.storage.save('post_jobs', record.id, { turnId: record.id, result: { ...emptyMemory, schemaVersion: 3 } });
    const frozenJson = JSON.stringify(frozen.frozenResult); const outputs = d.storage.outbox(record.id);
    const injection = new DatabaseSync(path);
    try { injection.exec("CREATE TRIGGER reject_task_commit BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT, 'injected R1 commit failure'); END"); } finally { injection.close(); }
    d.clock.time = '2026-10-07T10:06:00+08:00';
    await expect(finishPostprocessing(d, frozen)).rejects.toThrow('injected R1 commit failure');
    expect(JSON.stringify(d.storage.read('turns', record.id)!.frozenResult)).toBe(frozenJson);
    expect(d.storage.read('post_jobs', record.id)!.result).toEqual(emptyMemory);
    d.storage.close(); d.storage = new Storage(path);
    const repair = new DatabaseSync(path);
    try { repair.exec('DROP TRIGGER reject_task_commit'); } finally { repair.close(); }
    const persisted = d.storage.read('turns', record.id)!;
    expect(persisted.at).toBe(NOW); expect(JSON.stringify(persisted.frozenResult)).toBe(frozenJson);
    const observedCandidates: string[] = []; const save = d.storage.save.bind(d.storage);
    let taskWrites = 0;
    d.storage.save = ((table: any, id: string, row: any) => { if (table === 'tasks') taskWrites++; if (table === 'turns' && row.done) observedCandidates.push(JSON.stringify(d.storage.read('turns', id)!.frozenResult)); save(table, id, row); }) as typeof d.storage.save;
    d.models.calls = [];
    const app = new HdsiApp(d); await app.resumeUnfinishedTurn(); await app.resumeUnfinishedTurn();
    await finishPostprocessing(d, d.storage.read('turns', record.id)!);
    expect(d.storage.read('tasks', 'appointment')).toMatchObject({ ...patch, status: expected });
    expect(taskWrites).toBe(1); expect(observedCandidates).toEqual([frozenJson]);
    expect(d.storage.read('turns', record.id)).toMatchObject({ done: true, at: NOW });
    expect(d.storage.outbox(record.id)).toEqual(outputs);
    expect(d.models.calls).toEqual([]); expect(d.sender.sent).toEqual([]);
  } finally {
    d.storage.close();
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('hdsi-r1-')) throw new Error('unexpected temporary directory');
    rmSync(dir, { recursive: true });
  }
});
