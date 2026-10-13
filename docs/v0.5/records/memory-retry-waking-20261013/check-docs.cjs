'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../..');
const prefix = 'docs/v0.5/records/memory-retry-waking-20261013/';
const files = [
  'README.md','docs/v0.5/README.md','docs/v0.5/plans/README.md',
  'docs/v0.5/reviews/README.md','docs/v0.5/records/README.md',
  'docs/v0.5/subsystems/REMAKE_V0.5_MEMORY.md',
  'docs/v0.5/subsystems/REMAKE_V0.5_DIRECTORS.md',
  'docs/v0.5/subsystems/REMAKE_V0.5_RECOVERY.md',
  'docs/v0.5/reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md',
  'docs/v0.5/reference/V0.5_IMPLEMENTATION_MAP_20261009.md',
  prefix+'README.md',prefix+'DELIVERY.md',prefix+'REVIEW_CLOSURE.md',
];
const pending = new Set(['task-1-report.md','task-1-review.md','task-2-report.md','task-2-review.md',
  'task-3-report.md','task-3-review.md','final-review.md'].map(f=>prefix+'evidence/'+f));
const allowPending = process.argv.includes('--allow-pending');
const failures = [], missingEvidence = new Set(), skippedScope = new Set();
let checked = 0;
for (const file of files) {
  const absolute = path.join(root,file);
  if (!fs.existsSync(absolute)) { failures.push({file,reason:'missing checked document'}); continue; }
  const content = fs.readFileSync(absolute,'utf8').replace(/(^|\n)\x60{3}[^\n]*\n[\s\S]*?(?:\n\x60{3}[^\n]*(?=\n|$)|$)/g,'$1');
  for (const match of content.matchAll(/!?\[[^\]\n]*\]\((<[^>\n]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    let destination=match[1].replace(/^<|>$/g,'');
    if (!destination || destination.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(destination)) continue;
    destination=decodeURIComponent(destination.split('#')[0].split('?')[0]);
    const lineMatch=destination.match(/:(\d+)$/);
    const line=lineMatch ? Number(lineMatch[1]) : null;
    if(lineMatch) destination=destination.slice(0,-lineMatch[0].length);
    const target=path.resolve(path.dirname(absolute),destination);
    const relative=path.relative(root,target).replaceAll(path.sep,'/');
    const permitted=relative==='README.md'||relative.startsWith('docs/')||relative.startsWith('src/')||relative.startsWith('tests/');
    if(relative.startsWith('../')) { failures.push({file,destination,reason:'outside repository'});continue; }
    if(!permitted) { skippedScope.add(relative);continue; }
    checked++;
    if (!fs.existsSync(target)) {
      if(pending.has(relative)) missingEvidence.add(relative);
      else failures.push({file,destination,reason:'missing local link'});
      continue;
    }
    if(line!==null) {
      const count=fs.readFileSync(target,'utf8').split(/\r?\n/).length;
      if(line<1||line>count) failures.push({file,destination,reason:'source line outside file',count});
    }
  }
}
const pendingPaths=[...missingEvidence].sort();
const ok=failures.length===0&&(allowPending||pendingPaths.length===0);
console.log(JSON.stringify({ok,documents:files.length,checkedLocalLinks:checked,pendingPaths,failures,skippedOutsideScope:[...skippedScope].sort(),allowPending},null,2));
process.exitCode=ok?0:1;
