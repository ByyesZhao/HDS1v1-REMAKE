const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true}}).outputText, filename);
const root = path.resolve(__dirname, '../../../../..');
const {Storage} = require(path.join(root, 'src/storage.ts'));
const {initialCharacter} = require(path.join(root, 'src/config.ts'));
const {MemoryStore} = require(path.join(root, 'src/memory/store.ts'));
const {MemoryLifecycle} = require(path.join(root, 'src/memory/lifecycle.ts'));
const {MemoryRetrieval, makeRetrievalRequest} = require(path.join(root, 'src/memory/retrieval.ts'));
const {MemoryMaintenance} = require(path.join(root, 'src/memory/maintenance.ts'));
const {MemoryIndex} = require(path.join(root, 'src/memory/index.ts'));
const {MemoryIdle} = require(path.join(root, 'src/memory/idle.ts'));
const {memoryTask} = require(path.join(root, 'src/model/contracts.ts'));
const {stageInput} = require(path.join(root, 'src/model/context-views.ts'));
const oldAt = '2026-10-01T02:00:00Z', now = '2026-10-09T02:00:00Z';
function fixture() {
  const db = new Storage(':memory:');
  db.set('character', initialCharacter(now));
  const store = new MemoryStore(db);
  return {db, store};
}
async function main() {
  const checks = [];
  {
    const {db, store} = fixture();
    try {
      store.saveOwner(store.makeOwner({ownerType: 'long', ownerId: 'exam'}, {content: '考试', eventSummary: '考试', happenedAt: oldAt, happenedUntil: oldAt, sourceIds: ['old-source'], retainedFrom: oldAt, expiresAt: '2027-01-01T00:00:00Z'}, oldAt));
      const result = memoryTask(['retell'], ['exam']).parse({schemaVersion: 3, shortTermChanges: [{action: 'create', clientRef: 'again', existingLongId: 'exam', hasNewEventProgress: false, content: '考试', eventSummary: '考试', feelingSummary: '', topics: ['考试'], sourceIds: ['retell'], importance: 'normal'}], longTermChanges: [], detailChanges: []});
      new MemoryLifecycle(store).apply(result, 'again', now, ['retell']);
      const history = await new MemoryRetrieval(store).build(makeRetrievalRequest('考试', now, 'personal'));
      const view = stageInput('personal_chat', {history});
      const target = view.resources.owners.find(row => row.id === 'exam');
      assert(target);
      assert.equal(target.happenedAt, oldAt);
      assert.equal(target.happenedUntil, now);
      checks.push({name: 'B1 through real retrieval and stage projection', passed: true, target});
    } finally {db.close();}
  }
  {
    const {db, store} = fixture();
    let release;
    const gate = new Promise(resolve => {release = resolve;});
    const calls = [];
    try {
      const idle = new MemoryIdle(db, 15, true);
      idle.record('story', '2026-10-09T01:40:00Z');
      for (const id of ['first', 'second', 'third']) {
        const row = store.makeOwner({ownerType: 'long', ownerId: id}, {content: '独立正文'.repeat(30), eventSummary: id, sourceIds: [id], retainedFrom: oldAt, expiresAt: '2027-01-01T00:00:00Z'}, oldAt);
        store.saveOwner(row); store.queueDirty(row, 'event', oldAt);
      }
      const models = {runModel: async (task, input) => {calls.push(input); await gate; return task.parse({units: input.context.selectedIds.map(id => ({unitKey: id, action: 'retain', readOwners: [id], ids: [id], sourceIds: []}))});}};
      const clock = {now: () => now};
      const maintenance = new MemoryMaintenance(store, new MemoryLifecycle(store), new MemoryIndex(store, {model: 'local-fixture', embed: async () => [1, 0]}, {clock}), models, {clock, idle, batchItems: 20, batchCharacters: 150});
      assert.equal(idle.eligibility(now).allowed, true);
      assert.equal(maintenance.startOne(now), true);
      await Promise.resolve();
      assert.equal(calls.length, 1);
      assert.equal(calls[0].context.selectedIds.length, 3);
      const total = calls[0].resources.owners.reduce((sum, row) => sum + [...(row.content ?? row.eventSummary)].length, 0);
      assert.equal(total, 360);
      checks.push({name: 'B2 with real idle anchor and independent sources', passed: true, limit: 150, total, selectedIds: calls[0].context.selectedIds});
      release(); await maintenance.stop();
    } finally {db.close();}
  }
  const main = path.resolve(__dirname, '../README.md');
  const text = fs.readFileSync(main, 'utf8');
  const localLinks = [...text.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]).filter(href => !/^(?:https?:|#)/.test(href));
  const missing = localLinks.filter(href => !fs.existsSync(path.resolve(path.dirname(main), href.split('#')[0])));
  assert.deepEqual(missing, []);
  checks.push({name: 'main report link target files', passed: true, checked: localLinks.length, missing});
  const output = JSON.stringify({checks}, null, 2);
  fs.writeFileSync(path.join(__dirname, 'memory-crosscheck.json'), output + '\n');
  process.stdout.write(output + '\n');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
