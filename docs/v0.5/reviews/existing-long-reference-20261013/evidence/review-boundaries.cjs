// Synthetic, in-memory, source-only review evidence. No live data or network.
// Assertions describe baseline 44cfdbd; this is not the future fix acceptance suite.
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../../../..');
const fromRoot = createRequire(path.join(root, 'package.json'));
fromRoot('tsx/cjs');
const { setup, NOW, narrative } = fromRoot('./tests/helpers.ts');
const { Storage } = fromRoot('./src/storage.ts');
const { MemoryStore } = fromRoot('./src/memory/store.ts');
const { memoryTask } = fromRoot('./src/model/contracts.ts');
const { HdsiApp } = fromRoot('./src/app.ts');
const { stageInput } = fromRoot('./src/model/context-views.ts');
const { ModelClient, ChatCompletionsTransport } = fromRoot('./src/model/client.ts');
const { WebSearchStore } = fromRoot('./src/web/store.ts');
const { WebSearchService } = fromRoot('./src/web/service.ts');
const empty = { schemaVersion: 3, shortTermChanges: [], longTermChanges: [], detailChanges: [] };

async function postTargetCase(change) {
  const d = setup();
  try {
    const store = new MemoryStore(d.storage);
    const target = store.makeOwner({ ownerType: 'long', ownerId: 'L' }, {
      content: 'Synthetic previous event', sourceIds: ['old-source'],
      retainedFrom: '2026-10-13T10:00:00+08:00', expiresAt: '2027-01-11T10:00:00+08:00',
    }, NOW);
    store.saveOwner(target);
    const result = memoryTask(['new-source'], ['L']).parse({ ...empty, shortTermChanges: [{
      action: 'create', clientRef: 'revisit', existingLongId: 'L', hasNewEventProgress: false,
      content: 'Synthetic event revisited', eventSummary: 'Synthetic event revisited', feelingSummary: '',
      topics: [], sourceIds: ['new-source'], importance: 'normal',
    }] });
    const id = 'post-' + change;
    const candidate = {
      narrative, personal: null, nextState: d.storage.character(),
      experiences: [{ id: 'new-source', happenedAt: NOW, description: 'Synthetic event revisited', relatedEventIds: [] }],
      taskChanges: [], completedTaskIds: [], visibleMessageIds: [], reconsiderMessageIds: [],
      environmentChanges: [], schoolObservations: [], autonomousIntervalMinutes: null,
      probability: { contactMisses: 0, stickerMisses: 0 },
    };
    d.storage.save('turns', id, {
      id, at: NOW, inputMessageIds: [], triggerTaskIds: [], triggerKinds: ['sleep'], batchIds: [],
      entryMode: 'chat', dialogueWindowVersion: 1, frozenResult: candidate, outputComplete: true, done: false,
    });
    d.storage.save('post_jobs', id, { turnId: id, result });
    if (change === 'missing') d.storage.remove('memories', 'L');
    else store.saveOwner({ ...target, status: 'discarded' });
    let error = null;
    try { await new HdsiApp(d).resumeUnfinishedTurn(); } catch (e) { error = e.message; }
    return {
      change, error, canonicalStillResolves: !!store.canonical('L'),
      targetStatus: store.canonical('L')?.status ?? null,
      turnDone: d.storage.read('turns', id).done,
      savedPostResultRetained: d.storage.read('post_jobs', id).result !== null,
      createdShort: !!store.owner({ ownerType: 'short', ownerId: id + ':short:0' }),
      modelCalls: d.models.calls.length, senderCalls: d.sender.sent.length, paused: d.storage.runtime().paused,
    };
  } finally { d.storage.close(); }
}

async function restoredPermissionProjection(format) {
  const db = new Storage(':memory:');
  try {
    const store = new MemoryStore(db), ws = new WebSearchStore(db);
    const web = new WebSearchService(ws, undefined, { now: () => NOW }, { enabled: false });
    const session = web.openSession(ws.openStage('turn', 'projection-' + format, 'memory', 'memory'));
    const short = store.makeOwner({ ownerType: 'short', ownerId: 'S' }, { content: 'Synthetic short', linkedLongId: 'L' }, NOW);
    const rebuilt = { shortUpdateIds: ['S'], longAwakenIds: [], existingLongIds: ['L'] };
    const claimed = { shortUpdateIds: [], longAwakenIds: ['UNPROVIDED'], existingLongIds: ['UNPROVIDED'] };
    const lookup = format === 'raw'
      ? { details: [], retrieved: [short], memoryWritePermissions: claimed }
      : stageInput('memory', { retrieved: [short], memoryWritePermissions: claimed });
    session.saveCheckpoint({
      formatVersion: 2, input: {}, repairCount: 1, lookupUsed: true, lookupPending: false,
      privateLookupResult: lookup, pendingOperationId: null, toolResults: [],
    });
    const envelopes = [];
    let lookupCalls = 0;
    const transport = new ChatCompletionsTransport(() => ({ baseUrl: 'https://fixture.invalid', apiKey: 'fixture', model: 'fixture' }),
      async (_url, init) => {
        const body = JSON.parse(init.body);
        envelopes.push(JSON.parse(body.messages[1].content));
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(empty) } }] }));
      });
    // Emulates rebuilding validator/initial permissions while leaving confirmed lookup payload untouched.
    // The new permission field is synthetic; it is not present in production at this baseline.
    await new ModelClient(transport).runModel(memoryTask(['source'], [], ['S']),
      stageInput('memory', { memoryWritePermissions: rebuilt }), {
        web: session, lookup: async () => { lookupCalls++; throw Error('Confirmed lookup must not run again'); },
      });
    const envelope = envelopes[0], checkpoint = session.checkpoint();
    return {
      format, scope: 'synthetic proposed permission field, existing transport/recovery code',
      inputPermissions: envelope.input.context.memoryWritePermissions,
      lookupPermissions: envelope.lookupResult.context.memoryWritePermissions,
      providedOwnerIds: envelope.resources.owners.map(row => row.id),
      calls: envelopes.length, lookupCalls, repairCount: checkpoint.repairCount, lookupUsed: checkpoint.lookupUsed,
    };
  } finally { db.close(); }
}

(async () => {
  const missing = await postTargetCase('missing'), discarded = await postTargetCase('discarded');
  assert.match(missing.error, /existingLongId/);
  assert.equal(missing.turnDone, false); assert.equal(missing.savedPostResultRetained, true);
  assert.equal(missing.createdShort, false); assert.equal(missing.paused, true);
  assert.equal(discarded.error, null); assert.equal(discarded.turnDone, true);
  assert.equal(discarded.createdShort, true); assert.equal(discarded.targetStatus, 'discarded');
  assert.equal(discarded.savedPostResultRetained, false);
  const restoredLookup = [await restoredPermissionProjection('raw'), await restoredPermissionProjection('projected')];
  for (const item of restoredLookup) {
    assert.deepEqual(item.inputPermissions.existingLongIds, ['L']);
    assert.deepEqual(item.lookupPermissions.existingLongIds, ['UNPROVIDED']);
    assert.equal(item.lookupCalls, 0); assert.equal(item.repairCount, 1);
  }
  console.log(JSON.stringify({ sourceBaseline: '44cfdbd', implementation: 'src (tsx/cjs)',
    postTargetCases: [missing, discarded], restoredLookup, productionDatabaseOpened: false,
    realNetworkRequests: 0, baselineAssertionsPassed: true }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
