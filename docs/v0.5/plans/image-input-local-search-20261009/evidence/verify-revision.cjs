// Documentation-only verification for the 2026-10-09 planning revision.
// Do not use this report as feature-test evidence or overwrite it after implementation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const task = 'docs/v0.5/plans/image-input-local-search-20261009/';
const baseline = '4fe090c0e2acfe2b137854db7a55de86afcc9036';
// Git is checked by the PowerShell companion: Node child-process spawning is
// unavailable in this desktop sandbox. This file never runs product code.
const codeCheck = JSON.parse(fs.readFileSync(path.join(__dirname, 'revision-code-check.json'), 'utf8').replace(/^\uFEFF/, ''));
const head = codeCheck.sourceBaseline;
const productChanges = [...codeCheck.trackedProductChanges, ...codeCheck.untrackedProductChanges];
if (head !== baseline || productChanges.length) {
  throw new Error('This planning-only verifier requires the original code baseline and no product changes; preserve the existing evidence.');
}
const files = [
  ...['README.md','DESIGN.md','IMAGE_INPUT_PLAN.md','LOCAL_SEARCH_PLAN.md','EXECUTION_GUIDE.md'].map(f => task + f),
  'docs/v0.5/README.md','docs/v0.5/plans/README.md','docs/v0.5/reviews/README.md',
  'docs/v0.5/reviews/image-input-local-search-20261009/PLAN_REVIEW.md',
];
const missing = [], checked = [], formatting = [], manifest = [];
for (const file of files) {
  const absolute = path.join(root, file);
  const source = fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n');
  manifest.push({path: file, sha256: crypto.createHash('sha256').update(source).digest('hex'), lines: source.trimEnd().split('\n').length});
  if ((source.match(/^```/gm) || []).length % 2) formatting.push({file, issue: 'unclosed code fence'});
  const prose = source.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
  for (const match of prose.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
    target = decodeURIComponent(target.split('#')[0].split('?')[0]);
    const resolved = path.resolve(path.dirname(absolute), target);
    const entry = {file, target, exists: fs.existsSync(resolved)};
    checked.push(entry);
    if (!entry.exists) missing.push(entry);
  }
}
const report = {kind: 'documentation-link-check', sourceBaseline: head, checkedAt: new Date().toISOString(), files: files.length, links: checked.length, missing, formatting, productChanges, checks: checked};
fs.writeFileSync(path.join(__dirname, 'revision-document-links.json'), JSON.stringify(report, null, 2) + '\n');
const selfPath = path.join(__dirname, 'revision-self-review.json');
const review = JSON.parse(fs.readFileSync(selfPath, 'utf8'));
review.verifiedAt = report.checkedAt;
review.documentManifest = manifest;
review.hashMode = 'SHA256 over UTF-8 document text normalized to LF';
review.linkCheck = {files: report.files, links: report.links, missing: missing.length, formattingErrors: formatting.length};
review.productFilesChanged = productChanges;
review.codeCheckEvidence = 'revision-code-check.json';
fs.writeFileSync(selfPath, JSON.stringify(review, null, 2) + '\n');
console.log(JSON.stringify({files: report.files, links: report.links, missing: missing.length, formattingErrors: formatting.length, productFilesChanged: productChanges.length, sourceBaseline: head}, null, 2));
if (missing.length || formatting.length) process.exitCode = 1;
