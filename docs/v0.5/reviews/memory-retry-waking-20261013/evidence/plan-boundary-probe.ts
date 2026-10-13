// Review evidence for the current code, using only synthetic in-memory data.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { setup, NOW, narrative, emptyMemory, saveInput } from '../../../../../tests/helpers';
import { schoolItem, expand } from '../../../../../tests/world-school-fixture';
import { HdsiApp, generateTurn } from '../../../../../src/app';
import { prepareSchoolCommits } from '../../../../../src/school/progress';
import { releaseSchoolNotices } from '../../../../../src/school/notices';
import { MemoryStore } from '../../../../../src/memory/store';
import { MemoryLifecycle } from '../../../../../src/memory/lifecycle';
import { MemoryIndex } from '../../../../../src/memory/index';
import { MemoryMaintenance } from '../../../../../src/memory/maintenance';
import { ModelClient, ModelFormatError } from '../../../../../src/model/client';
import { modelTask } from '../../../../../src/model/contracts';
import { WebSearchStore } from '../../../../../src/web/store';
import { WebSearchService } from '../../../../../src/web/service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

async function wakingBoundary() {
  const d = setup();
  try {
    const from = '2026-10-12T23:00:00+08:00';
    const sleep = { sleepAt: '2026-10-13T00:06:00+08:00', wakeAt: '2026-10-13T08:01:00+08:00' };
    const at = '2026-10-13T08:01:00.008+08:00';
    d.clock.time = at;
    d.storage.set('character', { ...d.storage.character(), narratedUntil: from, sleep });
    d.storage.save('school_plan_items', 'meeting', schoolItem({ issuedAt: from,
      timing: { kind: 'once', startsAt: '2026-10-14T14:00:00+08:00', endsAt: '2026-10-14T15:00:00+08:00' },
      noticePolicy: { announceOnIssue: true, announceOnChange: true, reminders: [] } }));
    expand(d, from);
    releaseSchoolNotices(d.storage, from, d.config.timezone);
    const notice = d.schoolStore.notices().find(n => n.kind === 'issue' && n.status === 'available')!;
    assert.ok(notice);
    const refs = [{ noticeId: notice.id, deliveryRevision: notice.deliveryRevision }];
    const turn = { id: 'synthetic-waking', at, schoolNoticeRefs: refs } as any;
    const story = (happenedAt: string) => ({ ...narrative,
      experiences: [{ id: 'synthetic-experience', happenedAt, description: '合成查看已发布通知', relatedEventIds: [] }],
      schoolObservations: [{ via: 'notice' as const, sourceId: notice.id, experienceIndex: 0 }] });
    const preSleep = story('2026-10-12T23:50:00+08:00');
    assert.equal(prepareSchoolCommits(d.storage, turn, preSleep, preSleep.experiences).observations.length, 1);
    const during = story('2026-10-13T00:30:00+08:00');
    assert.throws(() => prepareSchoolCommits(d.storage, turn, during, during.experiences), /not readable/);
    const after = story(sleep.wakeAt);
    assert.equal(prepareSchoolCommits(d.storage, turn, after, after.experiences).observations.length, 1);
    d.models.outputs.narrative = after;
    const generated = await generateTurn(d, { inputMessageIds: [], taskIds: [], triggerKinds: ['sleep'], schoolNoticeRefs: refs }, turn.id, at);
    const input = d.models.calls.find(c => c.name === 'narrative')!.input;
    assert.equal(input.context.waking, true);
    assert.equal(input.context.state.sleep, null);
    assert.deepEqual(d.storage.character().sleep, sleep);
    assert.equal(d.models.calls.find(c => c.name === 'personal_life')!.input.context.state.sleep, null);
    assert.ok(Date.parse(generated.candidate.nextState.sleep!.sleepAt) > Date.parse(at));
    return { preSleepReadingAllowed: true, duringSleepReadingRejected: true, exactWakeBeforeTurnMillisecondAllowed: true,
      narrativeInputHasWaking: true, narrativeInputSleep: null, savedSleepStillPresent: true,
      personalInputSleep: null, candidateRetainsNextNightSchedule: true,
      note: 'Existing input mismatch is reproduced. The proposed unconditional wakeAt lower bound would newly reject this valid pre-sleep experience.' };
  } finally { d.storage.close(); }
}

async function archiveFailureBoundary() {
  const d = setup();
  let maintenance: MemoryMaintenance | undefined;
  try {
    const store = new MemoryStore(d.storage); store.migrate(NOW);
    const row = store.makeOwner({ ownerType: 'short', ownerId: 'synthetic-short' }, { content: '合成旧事件', shortExpiresAt: NOW }, NOW);
    store.saveOwner(row);
    d.storage.set('runtime', { ...d.storage.runtime(), nextMaintenanceAt: NOW });
    const web = new WebSearchService(new WebSearchStore(d.storage), undefined, d.clock, { enabled: false });
    let readySignals = 0, modelCalls = 0;
    const client = new ModelClient({ complete: async () => {
      modelCalls++;
      return { units: [{ unitKey: 'keep', action: 'retain', ids: [row.id], readOwners: [row.id], sourceIds: [] }] };
    } });
    maintenance = new MemoryMaintenance(store, new MemoryLifecycle(store),
      new MemoryIndex(store, { model: 'offline', embed: async () => [1, 0] }, { clock: d.clock }), client,
      { clock: d.clock, web, onReady: () => { readySignals++; } });
    // Simulates the new archive write throwing at the exact existing cleanup hook.
    web.compactOwnerCheckpoint = () => { throw new Error('synthetic archive write failure'); };
    assert.equal(maintenance.startOne(NOW), true);
    // Attach immediately to the internal promise to avoid an unhandled rejection in this probe.
    const active = (maintenance as unknown as { active: Promise<void> }).active;
    let escapedError = '';
    await active.catch(error => { escapedError = error.message; });
    const job = store.jobs<any>('memory_maintenance_jobs')[0];
    const ref = web.store.openStage('maintenance', job.id, 'consolidation', 'memory_consolidation');
    assert.equal(escapedError, 'synthetic archive write failure');
    assert.equal(job.status, 'ready');
    assert.equal(job.lastError, null);
    assert.equal(d.storage.runtime().paused, false);
    assert.ok(web.store.checkpoint(ref.runId));
    return { escapedError, jobStatus: job.status, jobLastError: job.lastError, paused: false, checkpointPreserved: true, readySignals, modelCalls,
      note: 'Failure injected into the existing finalizer; no history feature is implemented. The active promise rejects outside prepare catch.' };
  } finally { await maintenance?.stop(); d.storage.close(); }
}

async function failureOwnershipBoundary() {
  const d = setup();
  try {
    const entered = deferred<void>(), release = deferred<void>();
    const models = new ModelClient({ complete: async request => {
      if (request.task.name === 'narrative') { entered.resolve(); await release.promise; throw new Error('synthetic foreground failure'); }
      return emptyMemory;
    } });
    saveInput(d.storage, 'synthetic-input', '合成输入');
    const store = new MemoryStore(d.storage);
    const front = new HdsiApp({ ...d, models }).runTurn({ inputMessageIds: ['synthetic-input'], taskIds: [], triggerKinds: ['input'] });
    const caught = front.catch(error => error.message);
    await entered.promise;
    // Inject exactly the terminal state proposed by M2 while a real front turn awaits transport.
    d.storage.transaction(() => {
      store.saveJob('memory_maintenance_jobs', { id: 'synthetic-failed-job', status: 'failed', retryCycle: 1,
        executionAttemptCount: 3, failureCount: 3, failedAt: NOW, retryAt: null, createdAt: NOW,
        snapshot: [], readSet: [], result: null, appliedUnitKeys: [], staleUnitKeys: [], lastError: 'synthetic exhausted' });
      d.storage.set('runtime', { ...d.storage.runtime(), paused: true,
        lastFailure: { kind: 'generation', stage: 'maintenance', task: 'memory_consolidation', at: NOW,
          jobId: 'synthetic-failed-job', retryCycle: 1, safeSummary: 'synthetic exhausted' } });
    });
    release.resolve();
    assert.equal(await caught, 'synthetic foreground failure');
    const failure = d.storage.runtime().lastFailure as any;
    assert.equal(failure.stage, 'generation');
    assert.equal(failure.jobId, undefined);
    assert.equal(store.job<any>('memory_maintenance_jobs', 'synthetic-failed-job')!.status, 'failed');
    return { paused: d.storage.runtime().paused, finalFailureStage: failure.stage, finalFailureHasJobId: failure.jobId !== undefined,
      maintenanceJobStillFailed: true, fakeErrorNotices: d.sender.errors.length,
      note: 'Proposed M2 state is synthetically injected. Current foreground catch replaces lastFailure; this is an integration risk, not a test of a yet-unimplemented M2.' };
  } finally { d.storage.close(); }
}

async function repeatedInvocationIdentity() {
  const d = setup();
  try {
    const web = new WebSearchService(new WebSearchStore(d.storage), undefined, d.clock, { enabled: false });
    const ref = web.store.openStage('turn', 'synthetic-turn', 'narrative', 'narrative');
    const session = web.openSession(ref);
    const task = modelTask('narrative', z.object({ answer: z.literal('ok') }));
    let count = 0;
    const client = new ModelClient({ complete: async () => ({ invalid: ++count }) });
    await assert.rejects(client.runModel(task, { at: NOW }, { runRef: ref, web: session, lookup: null }), ModelFormatError);
    const first = count;
    await assert.rejects(client.runModel(task, { at: NOW }, { runRef: ref, web: session, lookup: null }), ModelFormatError);
    assert.deepEqual([first, count - first], [3, 1]);
    assert.equal(web.store.checkpoint(ref.runId)!.repairCount, 2);
    assert.deepEqual(web.store.checkpoint(ref.runId)!.repair!.original, { invalid: 2 });
    return { sameBusinessRunId: true, responsesPerInvocation: [first, count - first], repairCount: 2,
      maintenanceExecutionAttemptAbsent: true, lastSavedInvalidOrdinal: 2, actuallyObservedInvalidResponses: count,
      note: 'Both foreground invocations lack a maintenance attemptId. A diagnostic invocation ID is needed for globally unique failure records; no history records are fabricated here.' };
  } finally { d.storage.close(); }
}

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error('explicit report path required');
  const sourceRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
  const result = { baseline: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim(), passed: true,
    scope: 'Review of current code boundaries only; synthetic in-memory fixtures, fake models and sender, no production data or network.',
    waking: await wakingBoundary(), archiveFailure: await archiveFailureBoundary(),
    failureOwnership: await failureOwnershipBoundary(), invocationIdentity: await repeatedInvocationIdentity() };
  writeFileSync(resolve(output), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
