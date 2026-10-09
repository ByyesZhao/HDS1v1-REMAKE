// Offline review probe. Run from repository root; exit 1 means a reviewed defect remains.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../../../../..');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const source = name => require(path.join(root, name));
const { asyncFixture } = source('tests/environment-async-fixture.ts');
const { NOW } = source('tests/helpers.ts');
const { Storage } = source('src/storage.ts');
const { EnvironmentPreparation } = source('src/environment/preparation.ts');
const { SerialHost } = source('src/host/runtime.ts');
const { HdsiApp } = source('src/app.ts');
const { ModelRequestError } = source('src/model/client.ts');
const { inspectEnvironmentAsyncUpgrade } = source('src/deployment/environment-async-upgrade.ts');
const results = [];

async function hostGate(initial, gate) {
  const { d, step } = asyncFixture();
  let calls = 0;
  const gatesAtGeneration = [];
  d.generateEnvironment = async () => ({ stage: 'world', changes: [{ action: 'create', event: {
    kind: 'world', description: 'offline review event', startsAt: NOW, endsAt: null, basis: 'fiction', sourceUrls: [],
  } }] });
  if (initial === 'ready') {
    const prep = new EnvironmentPreparation(d);
    prep.startOne(step.id, NOW);
    await prep.wait();
    await prep.stop();
    assert.equal(d.environmentStore.step(step.id).status, 'ready');
    d.generateEnvironment = async () => { throw new ModelRequestError('offline later stage'); };
  } else {
    d.generateEnvironment = async () => {
      calls++;
      gatesAtGeneration.push({ paused: d.storage.runtime().paused, openBatch: !!d.storage.runtime().openBatch });
      return { stage: 'world', changes: [] };
    };
  }
  const host = new SerialHost(new HdsiApp(d), { timers: false });
  const read = () => ({ paused: d.storage.runtime().paused, openBatch: !!d.storage.runtime().openBatch,
    status: d.environmentStore.step(step.id).status, events: d.storage.all('events').length, calls });
  try {
    // collectReady has already selected a candidate, but its await continuation has not run.
    const starting = host.start();
    const gating = gate === 'pause' ? host.pause() : gate === 'stop' ? host.stop()
      : host.acceptInput({ id: 'review-input', content: 'hello', receivedAt: NOW, platformMessageIds: [] });
    const before = read();
    await Promise.all([starting, gating]);
    const after = read();
    const passed = initial === 'ready' ? after.status === 'ready' && after.events === 0
      : after.status === 'pending' && after.calls === 0;
    results.push({ finding: 'R1', initial, gate, before, after, gatesAtGeneration, passed });
  } finally { await host.stop(); d.storage.close(); }
}

async function upgradeCounts() {
  const tmpRoot = path.join(root, '.tmp', 'post-environment-async-review');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'counts-'));
  const database = path.join(dir, 'synthetic.sqlite');
  const { d, step } = asyncFixture('world', new Storage(database));
  d.generateEnvironment = async () => ({ stage: 'world', changes: [] });
  const prep = new EnvironmentPreparation(d);
  let states;
  try {
    prep.startOne(step.id, NOW);
    await prep.wait();
    states = d.environmentStore.steps(step.batchId).map(({ stage, status, preparationVersion }) => ({ stage, status, preparationVersion }));
    assert.equal(states[0].status, 'ready');
    assert.ok(states.every(s => s.preparationVersion === 1));
  } finally { await prep.stop(); d.storage.close(); }
  const report = inspectEnvironmentAsyncUpgrade(database);
  results.push({ finding: 'R2', states, report, expected: { legacyUnfinished: 0, asyncUnfinished: 4 },
    passed: report.legacyUnfinished === 0 && report.asyncUnfinished === 4 });
}

async function main() {
  for (const initial of ['ready', 'pending']) for (const gate of ['pause', 'input', 'stop']) await hostGate(initial, gate);
  await upgradeCounts();
  console.log(JSON.stringify({ baseline: 'cc963f8', synthetic: true, results }, null, 2));
  if (results.some(result => !result.passed)) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 2; });
