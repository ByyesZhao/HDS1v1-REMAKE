// Runs SOL's unchanged synthetic probe against src/, without rebuilding lib/.
// Usage: node <this-file> [--expect-fixed]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../../../..');
const rootRequire = createRequire(path.join(root, 'package.json'));
rootRequire('tsx/cjs');
const original = path.join(root, 'docs/v0.5/plans/existing-long-reference-20261013/evidence/reproduce.cjs');
const originalRequire = createRequire(original);
const expectedFixed = process.argv.includes('--expect-fixed');
(async () => {
  let report;
  const probeProcess = { exitCode: 0 };
  await vm.runInNewContext(fs.readFileSync(original, 'utf8'), {
    require: id => originalRequire(id.replace('../../../../../lib/', '../../../../../src/')),
    structuredClone,
    process: probeProcess,
    console: { log: value => { report = JSON.parse(value); }, error: value => console.error(value) },
  }, { filename: original });
  if (!report || probeProcess.exitCode) throw Error('Original synthetic control checks failed');
  console.log(JSON.stringify({ implementation: 'src (tsx/cjs)', expectedBugReproduced: !expectedFixed, ...report }, null, 2));
  if (report.bugReproduced === expectedFixed) throw Error('Unexpected baseline/fixed behavior');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
