const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const { Storage } = require('../../../../src/storage.ts');
const { SchoolStore } = require('../../../../src/school/store.ts');
const { EnvironmentStore } = require('../../../../src/environment/store.ts');
const env = require('../../../../src/environment/scheduler.ts');
const { runEnvironmentStep } = require('../../../../src/environment/runtime.ts');
const notices = require('../../../../src/school/notices.ts');
const { selectKnownSchoolSnapshots } = require('../../../../src/school/knowledge.ts');
const { runProbes } = require('../../../../scripts/check-scheduling-queries.cjs');
const { schoolItem } = require('../../../../tests/world-school-fixture.ts');
const { setup, NOW } = require('../../../../tests/helpers.ts');

async function main() {
  const workload = await runProbes({ Storage, SchoolStore, EnvironmentStore, runEnvironmentStep, ...env, ...notices });
  fs.writeFileSync(__dirname + '/rerun-workload.json', JSON.stringify(workload, null, 2));
  const metrics = [];
  for (const H of [0, 1000, 5000]) {
    const s = new Storage(':memory:');
    try {
      const store = new SchoolStore(s), first = schoolItem();
      s.transaction(() => { for (let i = 0; i <= H; i++) s.save('school_knowledge', 'k' + i, { snapshot: { entityKind: 'plan_item', entityId: first.id, revision: 1, value: { ...first, location: i ? 'old' : 'winner' } }, acquiredAt: i ? '2020-01-01T00:00:00Z' : NOW }); });
      let calls = 0;
      s.db.function('hdsi_epoch_ms', { deterministic: true }, value => { calls++; return Date.parse(value); });
      const started = performance.now();
      const got = store.latestKnownSnapshots([{ entityKind: 'plan_item', entityId: first.id }]);
      const elapsedMs = performance.now() - started;
      assert.equal(got[0].value.location, 'winner');
      assert.deepEqual(got, selectKnownSchoolSnapshots(store.knowledge()));
      metrics.push({ H, returned: got.length, epochCalls: calls, elapsedMs });
    } finally { s.close(); }
  }
  const d = setup();
  try {
    d.storage.set('runtime', { ...d.storage.runtime(), nextEnvironmentAt: null });
    const first = env.ensureEnvironmentBatch(d.storage, d.config, NOW);
    for (const step of d.environmentStore.steps(first.id)) d.environmentStore.saveStep({ ...step, status: 'committed' });
    d.environmentStore.saveBatch({ ...first, status: 'committed', closedAt: NOW });
    d.config.timezone = 'UTC';
    env.ensureEnvironmentBatch(d.storage, d.config, '2026-10-07T08:00:00Z');
    d.config.timezone = 'Asia/Shanghai';
    for (let i = 0; i < 2; i++) {
      env.ensureEnvironmentBatch(d.storage, d.config, '2026-10-07T16:00:00+08:00');
      assert.equal(env.selectEnvironmentStepMetadata(d.storage, '2026-10-07T16:00:00+08:00'), null);
      assert.equal(Date.parse(env.environmentDeadline(d.storage, '2026-10-07T16:00:00+08:00')), Date.parse('2026-10-08T06:00:00+08:00'));
      assert.equal(d.environmentStore.batch(first.id).status, 'committed');
    }
    assert.equal(d.environmentStore.batches().length, 2);
  } finally { d.storage.close(); }
  const order = new Storage(':memory:');
  try {
    const store = new SchoolStore(order);
    const ids = Array.from({ length: 1101 }, (_, i) => 'id-' + i);
    order.transaction(() => {
      for (const id of ids) order.save('school_plan_items', id, schoolItem({ id }));
      for (const id of ['i-old', 'i-new']) {
        const value = { id, sourceItemId: 'same-source', deliveryRevision: 1, startsAt: NOW, endsAt: NOW };
        order.save('school_knowledge', id, { snapshot: { entityKind: 'instance', entityId: id, revision: 1, value }, acquiredAt: NOW });
      }
    });
    assert.deepEqual(store.itemsByIds([...ids].reverse().concat(ids.slice(0, 100))).map(x => x.id), ids);
    const known = store.latestKnownSnapshots([{ entityKind: 'instance', entityId: 'i-new' }, { entityKind: 'instance', entityId: 'missing' }, { entityKind: 'instance', entityId: 'i-old' }, { entityKind: 'instance', entityId: 'i-new' }]);
    assert.deepEqual(known.map(x => x.entityId), ['i-new', 'i-old']);
  } finally { order.close(); }
  const summary = { sourceWorkloadSamples: workload.results.length, relatedKnowledge: metrics, committedTimezoneReturn: 'passed', idChunkRowOrderAndRefIdentities: 'passed', recordedRelatedFields: workload.results.filter(r => r.kind === 'relatedKnowledge').map(r => ({ H: r.H, keys: Object.keys(r) })) };
  fs.writeFileSync(__dirname + '/summary.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
