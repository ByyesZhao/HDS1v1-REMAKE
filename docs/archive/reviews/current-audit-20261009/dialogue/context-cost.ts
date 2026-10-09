import { modern } from '../../../../../tests/chat-fixture';
import { NOW } from '../../../../../tests/helpers';
import { HdsiApp } from '../../../../../src/app';
import { InputBuffer } from '../../../../../src/host/input';
import { ContextBuilder } from '../../../../../src/memory/context';
import { makeRetrievalRequest } from '../../../../../src/memory/retrieval';
import { stageInput } from '../../../../../src/model/context-views';
import { buildCompletionEnvelope } from '../../../../../src/model/resource-pool';
import { modelTask } from '../../../../../src/model/contracts';
import { z } from 'zod';

// In-memory synthetic records only. No config, database file, model network or service is used.
function seed(d: ReturnType<typeof modern>, n: number) {
  d.storage.transaction(() => {
    for (let i = 0; i < n; i++) {
      const at = new Date(Date.parse('2020-01-01T00:00:00Z') + i * 30 * 60_000).toISOString();
      d.storage.save('turns', `past:${i}`, { id: `past:${i}`, done: true, dialogueWindowVersion: 2 } as any);
      d.storage.save('chat_episodes', `past:${i}`, { id: `past:${i}`, openedAt: at, lastInteractionAt: at, status: 'closed', closedAt: new Date(Date.parse(at) + 900_000).toISOString(), closeReason: 'idle' });
      d.storage.save('messages', `past:${i}`, { id: `past:${i}`, content: '已读的普通历史正文', receivedAt: at, direction: 'incoming', seenTurnId: `past:${i}`, platformMessageIds: [], batchId: null, turnId: null, outboxSeq: null, sharedActivityId: null, chatEpisodeId: `past:${i}` });
    }
  });
}
async function main() {
  const data: any = { generatedAt: new Date().toISOString(), history: [], pool: [] };
  for (const n of [1_000, 10_000, 50_000]) {
    const d = modern();
    try {
      seed(d, n);
      await new InputBuffer(d.storage, undefined, undefined, d.chat).acceptInput({ id: 'current', content: '现在你好', receivedAt: NOW });
      const counts: Record<string, {calls: number; rows: number}> = {};
      const all = d.storage.all.bind(d.storage);
      d.storage.all = ((table: any) => { const rows = all(table); const c = counts[table] ??= { calls: 0, rows: 0 }; c.calls++; c.rows += rows.length; return rows; }) as any;
      const began = performance.now();
      await new HdsiApp(d).runTurn({ inputMessageIds: ['current'], taskIds: [], triggerKinds: ['input'] });
      const wholeTurnMs = performance.now() - began, wholeTurn = structuredClone(counts);
      for (const key of Object.keys(counts)) delete counts[key];
      const before = performance.now();
      const memoryView = await new ContextBuilder(d.storage).buildForMemory(makeRetrievalRequest('当前记忆', NOW, 'memory'));
      const memoryOnlyMs = performance.now() - before;
      data.history.push({ n, wholeTurnMs, wholeTurn, memoryOnlyMs, memoryOnly: counts, memoryViewKeys: Object.keys(memoryView), stages: d.models.calls.map(c => c.name) });
    } finally { d.storage.close(); }
  }
  for (const n of [1_000, 5_000, 10_000]) {
    const messages = Array.from({ length: n }, (_, i) => ({ id: `m:${i}`, content: `消息${i}`, receivedAt: NOW, direction: 'incoming', sharedActivityId: 'activity', seenTurnId: 'old' })) as any;
    const stageMs: number[] = [], envelopeMs: number[] = [];
    const task = modelTask('personal_shared', z.object({}));
    for (let sample = 0; sample < 4; sample++) {
      const began = performance.now();
      const view = stageInput('personal_shared', { currentActivityMessages: messages, visibleMessages: messages });
      const middle = performance.now();
      const envelope = buildCompletionEnvelope({ task, input: view });
      const ended = performance.now();
      if (view.resources.messages.length !== n || envelope.resources.messages.length !== n) throw Error('dedup regression');
      if (sample) { stageMs.push(middle - began); envelopeMs.push(ended - middle); }
    }
    data.pool.push({ n, stageMs, envelopeMs });
  }
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}
main().catch(error => { process.stderr.write(String(error.stack ?? error)); process.exitCode = 1; });
