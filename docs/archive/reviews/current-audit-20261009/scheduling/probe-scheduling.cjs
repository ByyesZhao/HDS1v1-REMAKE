// Offline audit only: synthetic in-memory SQLite, no private files, services, or models.
const { performance } = require('node:perf_hooks');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '../../../../..');
const { Storage } = require(resolve(root, 'lib/storage.js'));
const { defaultConfig, initialCharacter } = require(resolve(root, 'lib/config.js'));
const { Scheduler } = require(resolve(root, 'lib/host/scheduler.js'));
const { environmentDeadline, batchIdentity } = require(resolve(root, 'lib/environment/scheduler.js'));
const { environmentStages } = require(resolve(root, 'lib/environment/types.js'));
const NOW = '2026-10-09T10:00:00+08:00';
const iso = (day, hour = 10) => new Date(Date.UTC(2025, 0, day + 1, hour - 8)).toISOString();
function fixture() {
  const storage = new Storage(':memory:');
  storage.set('character', { ...initialCharacter(NOW), nextAutonomousAt: '2026-10-09T13:00:00+08:00' });
  storage.set('runtime', { ...storage.runtime(), environmentPlanningVersion: null, nextEnvironmentAt: '2026-10-10T06:00:00+08:00' });
  return storage;
}
function schoolRecord(n, atDay = n) {
  const item = { id: `item:${n}`, planId: 'semester', owner: 'campus', kind: 'meeting', title: `历史会议${n}`, description: '合成例行学术会议；资料仅用于离线性能探针。', location: '研究楼', requirement: 'optional', issuedAt: iso(n - 1), timing: { kind: 'once', startsAt: iso(n), endsAt: iso(n, 11) }, noticePolicy: { announceOnIssue: true, announceOnChange: true, reminders: [] }, revision: 1, deliveryRevision: 1, status: 'closed', basis: 'fiction', sourceUrls: [] };
  const instance = { id: `instance:${n}`, sourceItemId: item.id, sourceRevision: 1, deliveryRevision: 1, occurrenceKey: JSON.stringify([item.id, 'once']), weekStart: null, startsAt: iso(n), endsAt: iso(n, 11), sourceSnapshot: item, status: 'archived', needsExpansion: false, legacyEventId: null };
  const planSnapshot = { entityKind: 'plan_item', entityId: item.id, revision: 1, value: item };
  const instanceSnapshot = { entityKind: 'instance', entityId: instance.id, revision: 1, value: instance };
  const notices = ['issue', 'reminder', 'change'].map((kind, j) => ({ id: `notice:${n}:${j}`, sourceItemId: item.id, instanceId: kind === 'reminder' ? instance.id : null, weekStart: null, deliveryRevision: 1, kind, reminderKey: kind, channel: 'institution', publishAt: iso(n - 1), releasedAt: iso(n - 1), payload: { text: `已读的合成历史会议通知${n}。`, snapshots: kind === 'reminder' ? [planSnapshot, instanceSnapshot] : [planSnapshot] }, status: 'read', nextWakeAt: null, readAt: iso(n - 1), readTurnId: `turn:${n}` }));
  const knowledge = [planSnapshot, instanceSnapshot].map((snapshot, j) => ({ id: `knowledge:${n}:${j}`, entityKind: snapshot.entityKind, entityId: snapshot.entityId, revision: 1, snapshot, acquiredAt: iso(n - 1), experienceId: `experience:${n}`, turnId: `turn:${n}`, via: 'notice' }));
  if (atDay !== n) {
    item.issuedAt = iso(atDay - 1); item.timing.startsAt = iso(atDay); item.timing.endsAt = iso(atDay, 11);
    instance.startsAt = iso(atDay); instance.endsAt = iso(atDay, 11);
    notices.forEach(n => { n.publishAt = n.releasedAt = n.readAt = iso(atDay - 1); });
    knowledge.forEach(k => { k.acquiredAt = iso(atDay - 1); });
  }
  return { item, instance, notices, knowledge };
}
function countReads(storage, operation) {
  const original = storage.all.bind(storage), reads = {};
  storage.all = function (table) {
    const rows = original(table);
    const x = reads[table] ??= { calls: 0, rows: 0 };
    x.calls++; x.rows += rows.length;
    return rows;
  };
  return Promise.resolve(operation()).then(() => reads).finally(() => { storage.all = original; });
}
async function measure(operation) {
  const at = performance.now(); await operation(); const coldMs = performance.now() - at;
  const warmMs = [];
  for (let i = 0; i < 5; i++) { const start = performance.now(); await operation(); warmMs.push(performance.now() - start); }
  return { coldMs, warmMs, warmMedianMs: [...warmMs].sort((a,b) => a-b)[2] };
}
async function schoolScan(count) {
  const storage = fixture();
  storage.transaction(() => {
    for (let i = 0; i < count; i++) {
      // Keep all timestamps historical even in the largest synthetic sample.
      const r = schoolRecord(i, i % 300);
      storage.save('school_plan_items', r.item.id, r.item);
      storage.save('school_instances', r.instance.id, r.instance);
      r.notices.forEach(n => storage.save('school_notices', n.id, n));
      r.knowledge.forEach(k => storage.save('school_knowledge', k.id, k));
    }
  });
  const scheduler = new Scheduler(storage, defaultConfig);
  const collect = await measure(() => scheduler.collectReady(NOW));
  const deadline = await measure(() => scheduler.nextDeadline(NOW));
  const collectReads = await countReads(storage, () => scheduler.collectReady(NOW));
  const deadlineReads = await countReads(storage, () => scheduler.nextDeadline(NOW));
  const rowCounts = Object.fromEntries(['school_plan_items', 'school_instances', 'school_notices', 'school_knowledge'].map(t => [t, Number(storage.prepare(`SELECT count(*) AS n FROM ${t}`).get().n)]));
  storage.close(); return { historicalMeetings: count, rowCounts, collect, deadline, collectReads, deadlineReads };
}
async function environmentScan(days) {
  const storage = fixture();
  storage.set('runtime', { ...storage.runtime(), environmentPlanningVersion: 1 });
  const items = [], instances = [], notices = [], known = [];
  storage.transaction(() => {
    for (let i = 0; i < days; i++) {
      const r = schoolRecord(i); items.push(r.item); instances.push(r.instance); notices.push(...r.notices); known.push(...r.knowledge.map(k => k.snapshot));
      const date = iso(i).slice(0,10), id = batchIdentity(date, defaultConfig.timezone);
      storage.save('environment_batches', id, { id, localDate: date, timezone: defaultConfig.timezone, scheduledAt: iso(i, 6), createdAt: iso(i, 6), reason: 'daily', status: 'committed', closedAt: iso(i, 7) });
      for (const stage of environmentStages) {
        const context = stage === 'school_week' ? { weekStarts: [], sourceItems: items, existingInstances: instances, existingNotices: notices, knownSnapshots: known, coveredVersions: {}, requiredOccurrences: [], requiredNoticeKeys: [], conflicts: [] } : { events: [], plans: [], items: stage === 'school_campus' ? items : [] };
        const stepId = JSON.stringify([id, stage]);
        const frozenResult = stage === 'world' ? { stage, changes: [] } : stage === 'school_week' ? { stage, instances: [], notices: [], weeks: [] } : { stage, plans: [], items: [] };
        storage.save('environment_steps', stepId, { id: stepId, batchId: id, stage, status: 'committed', attempt: 1, startedAt: iso(i, 6), completedAt: iso(i, 7), retryAt: null, lastError: null, inputSnapshot: { stage, batchId: id, at: iso(i, 6), context, modelContractVersion: 1 }, frozenResult });
      }
    }
    const id = batchIdentity('2026-10-09', defaultConfig.timezone);
    storage.save('environment_batches', id, { id, localDate: '2026-10-09', timezone: defaultConfig.timezone, scheduledAt: NOW, createdAt: NOW, reason: 'daily', status: 'active', closedAt: null });
    for (const stage of environmentStages) { const stepId = JSON.stringify([id, stage]); storage.save('environment_steps', stepId, { id: stepId, batchId: id, stage, status: 'pending', attempt: 0, startedAt: null, completedAt: null, retryAt: null, lastError: null, inputSnapshot: null, frozenResult: null }); }
  });
  const bytes = Number(storage.prepare('SELECT sum(length(CAST(data AS BLOB))) AS bytes FROM environment_steps').get().bytes);
  const deadline = await measure(() => environmentDeadline(storage, NOW));
  const reads = await countReads(storage, () => environmentDeadline(storage, NOW));
  storage.close(); return { historicalDays: days, currentBatchSteps: 4, historicalSteps: days * 4, storedStepJsonBytes: bytes, deadline, reads };
}
(async () => {
  const result = { node: process.version, fixture: 'in-memory synthetic; cold means first operation after seeding, not OS disk cold-cache; five warm calls; no all() instrumentation during timing', school: [], environment: [] };
  for (const n of [0, 250, 1000]) result.school.push(await schoolScan(n));
  for (const n of [0, 30, 90]) result.environment.push(await environmentScan(n));
  writeFileSync(resolve(__dirname, 'probe-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
