// Review-only synthetic probe of the existing code. No production config, DB or network.
import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { modern } from '../../../../../tests/chat-fixture';
import { NOW, narrative, silent, emptyMemory } from '../../../../../tests/helpers';
import { schoolItem, expand } from '../../../../../tests/world-school-fixture';
import { HdsiApp } from '../../../../../src/app';
import { InputBuffer } from '../../../../../src/host/input';
import { Scheduler } from '../../../../../src/host/scheduler';
import { ModelClient, ModelFormatError } from '../../../../../src/model/client';
import { WebSearchService } from '../../../../../src/web/service';
import { WebSearchStore } from '../../../../../src/web/store';

async function main() {
  const d = modern();
  const attempts: Array<{ task: string; at: string; repair: boolean; visibleIds?: string[] }> = [];
  let recovering = false;
  let recoveredRepairCount: number | null = null;
  let recoveredOriginal: unknown;
  try {
    d.storage.set('runtime', { ...d.storage.runtime(), environmentPlanningVersion: 2 });
    d.storage.save('school_plan_items', 'meeting', schoolItem());
    expand(d);
    await new InputBuffer(d.storage).acceptInput({ id: 'synthetic-new', content: '合成新消息', receivedAt: NOW });
    d.clock.advance(15_000);
    const request = await new Scheduler(d.storage, d.config).collectReady(d.clock.now());
    assert.ok(request?.schoolNoticeRefs?.length);
    assert.equal(request.replyInputRevision, undefined, 'mixed school turn is not an ordinary-freshness turn');
    const noticeId = request.schoolNoticeRefs[0].noticeId;
    const observedAt = d.clock.now();
    const web = new WebSearchService(new WebSearchStore(d.storage), undefined, d.clock, { enabled: false });
    const invalidLife = { innerThought: '合成生活反应', emotions: [], contact: { willing: false },
      taskChanges: [{ action: 'create', task: { kind: 'check_messages', at: '2026-10-07T10:30:00+08:00', description: '合成检查' } }] };
    const models = new ModelClient({ complete: async r => {
      const input = r.input as any;
      attempts.push({ task: r.task.name, at: input.context.at, repair: !!r.repair, visibleIds: input.roles.visibleIds });
      if (r.task.name === 'narrative') return {
        ...narrative,
        experiences: [{ happenedAt: observedAt, description: '合成读取学校通知', relatedEventIds: ['meeting'] }],
        schoolObservations: [{ via: 'notice', sourceId: noticeId, experienceIndex: 0 }],
        currentScene: recovering ? narrative.currentScene : { description: '合成不可读活动', activity: {
          description: '合成小憩', startsAt: observedAt, expectedEndAt: '2026-10-07T10:05:00+08:00', phoneAccess: false,
        } },
      };
      if (r.task.name === 'personal_life') return invalidLife;
      if (r.task.name === 'personal_chat') {
        assert.ok(recovering);
        const turn = d.storage.unfinishedTurn()!;
        const ref = web.store.openStage('turn', turn.id, 'personal', 'personal_chat');
        recoveredRepairCount = web.store.checkpoint(ref.runId)!.repairCount;
        recoveredOriginal = r.repair?.original;
        return silent;
      }
      if (r.task.name === 'memory') return emptyMemory;
      throw new Error('unexpected synthetic stage ' + r.task.name);
    } });
    const app = new HdsiApp({ ...d, models, web });
    await assert.rejects(app.runTurn(request), error => error instanceof ModelFormatError && error.message.startsWith('personal_life:'));
    const failed = d.storage.unfinishedTurn()!;
    assert.equal(failed.frozenResult, null);
    assert.equal(failed.outputComplete, false);
    assert.equal(d.storage.outbox(failed.id).length, 0);
    const oldRef = web.store.openStage('turn', failed.id, 'personal', 'personal_life');
    assert.equal(web.store.checkpoint(oldRef.runId)!.repairCount, 2);
    recovering = true;
    d.clock.advance(10 * 60_000);
    const recoveryAt = d.clock.now();
    await app.resumeUnfinishedTurn();
    const finished = d.storage.read('turns', failed.id)!;
    const newRef = web.store.openStage('turn', failed.id, 'personal', 'personal_chat');
    assert.equal(finished.at, recoveryAt);
    assert.notEqual(Date.parse(finished.at), Date.parse(failed.at));
    assert.equal(finished.done, true);
    assert.equal(newRef.runId, oldRef.runId);
    assert.equal(recoveredRepairCount, 2);
    assert.deepEqual(recoveredOriginal, invalidLife);
    assert.equal(d.sender.sent.length, 0);
    assert.equal(d.storage.read('messages', 'synthetic-new')!.seenTurnId, failed.id);
    const result = {
      baseline: '9a14ea4b5191deda366bbe0c3d9fcdeb7dfd0e78', passed: true,
      scope: 'Existing implementation; in-memory protocol-2 mixed input/school turn; fake transport and sender; web disabled; no network.',
      failedAt: failed.at, recoveryAt, completedTurnAt: finished.at,
      personalStageBefore: 'personal_life', personalStageAfter: 'personal_chat',
      sameStageRunId: newRef.runId === oldRef.runId, repairCountAtRecoveredRequest: recoveredRepairCount,
      oldRepairOriginalRetained: true, completed: finished.done, fakeStorySends: d.sender.sent.length,
      note: 'Direct HdsiApp.resumeUnfinishedTurn probe; does not test Host pause/resume or disk reopen. A compatible response passes the current old contract; this is not validation of the proposed appointment-only contract.',
      attempts,
    };
    const output = process.argv[2];
    if (!output) throw new Error('explicit report path required');
    writeFileSync(resolve(output), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { d.storage.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
