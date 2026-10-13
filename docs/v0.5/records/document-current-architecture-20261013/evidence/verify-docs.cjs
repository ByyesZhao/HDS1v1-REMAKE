// Run from any directory. Checks documentation only; no services or model calls.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../../..');
const baseline = '7138aadf80bd390bf51a24b0cd027327ee365ce2';
const record = 'docs/v0.5/records/document-current-architecture-20261013/';
const report = path.join(__dirname, 'document-verification.json');
if (!fs.existsSync(report)) fs.writeFileSync(report, '{}\n');
const relative = file => path.relative(root, file).replaceAll('\\', '/');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const lines = text => text ? text.split(/\r?\n/) : [];
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : file.endsWith('.md') ? [file] : [];
});
const files = [...walk(path.join(root, 'docs/v0.5')), path.join(root, 'README.md'), path.join(root, 'docs/README.md')];
const withoutFences = text => text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
const anchors = file => {
  const result = new Set(), counts = new Map();
  for (const match of withoutFences(fs.readFileSync(file, 'utf8')).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = match[1].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/<[^>]+>/g, '').toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = counts.get(slug) || 0;
    result.add(slug + (count ? '-' + count : '')); counts.set(slug, count + 1);
  }
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) result.add(match[1]);
  return result;
};
const cache = new Map(), errors = [];
let linksChecked = 0;
for (const file of files) {
  for (const match of withoutFences(fs.readFileSync(file, 'utf8')).matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) continue;
    linksChecked++;
    let decoded;
    try { decoded = decodeURIComponent(href); } catch { errors.push({ file: relative(file), href, error: 'invalid encoding' }); continue; }
    const hash = decoded.indexOf('#'), targetPath = hash < 0 ? decoded : decoded.slice(0, hash);
    // Codex file links may carry a :line suffix; historical line meaning stays at its original baseline.
    const target = targetPath ? path.resolve(path.dirname(file), targetPath.replace(/:\d+$/, '')) : file;
    if (!fs.existsSync(target)) { errors.push({ file: relative(file), href, error: 'missing target' }); continue; }
    if (hash >= 0 && decoded.slice(hash + 1) && target.endsWith('.md')) {
      if (!cache.has(target)) cache.set(target, anchors(target));
      if (!cache.get(target).has(decoded.slice(hash + 1))) errors.push({ file: relative(file), href, error: 'missing heading anchor' });
    }
  }
}
const changedTrackedFiles = lines(git(['diff', '--name-only', baseline]));
const newFiles = lines(git(['ls-files', '--others', '--exclude-standard']));
const changedFiles = [...new Set([...changedTrackedFiles, ...newFiles])].sort();
const nonDocumentationChanges = changedFiles.filter(file => !file.startsWith(record) && !(file.endsWith('.md') && (file.startsWith('docs/') || file === 'README.md')));
const changedHistoricalEvidence = changedFiles.filter(file => /^(docs\/archive\/|docs\/v0\.5\/(records|reviews|plans)\/)/.test(file) && !file.startsWith(record) && !/^docs\/v0\.5\/(records|reviews|plans)\/README\.md$/.test(file));
const architectureFiles = [...walk(path.join(root, 'docs/v0.5/architecture')), ...walk(path.join(root, 'docs/v0.5/subsystems'))];
const architectureErrors = [];
for (const file of architectureFiles) {
  const content = withoutFences(fs.readFileSync(file, 'utf8'));
  const numbers = new Set();
  for (const match of content.matchAll(/^##\s+(\d+)\./gm)) {
    if (numbers.has(match[1])) architectureErrors.push({ file: relative(file), error: 'duplicate section number', number: match[1] });
    numbers.add(match[1]);
  }
  for (const match of content.matchAll(/^.*(?:核对日期|源码基线|新增规则核对|\]\([^\n)]*(?:records|reviews|plans|archive)\/|^##.*（0\.5\.\d+）).*$/gm)) {
    architectureErrors.push({ file: relative(file), error: 'historical process remains in current architecture', text: match[0] });
  }
}
if (architectureFiles.length !== 9) architectureErrors.push({ error: 'expected one architecture and eight subsystem documents', actual: architectureFiles.length });
const packageVersions = ['package.json', 'package-lock.json', 'runtime/package.json', 'runtime/package-lock.json'].map(file => {
  const value = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  return { file, version: value.version, ...(value.packages ? { rootVersion: value.packages[''].version } : {}) };
});
const versionErrors = packageVersions.filter(value => value.version !== '0.5.2' || value.rootVersion !== undefined && value.rootVersion !== '0.5.2');
const whitespace = spawnSync('git', ['diff', '--check', baseline], { cwd: root, encoding: 'utf8' });
const recordWhitespaceErrors = newFiles.filter(file => file.startsWith(record)).flatMap(file => {
  const check = spawnSync('git', ['diff', '--no-index', '--check', '--', 'NUL', file], { cwd: root, encoding: 'utf8' });
  const output = check.stdout?.trim() || '';
  return output || ![0, 1].includes(check.status) ? [{ file, exitCode: check.status, output, error: check.error?.message || check.stderr?.trim() || null }] : [];
});
const result = { baseline, scope: 'V0.5 and root/docs index local links/anchors; current architecture structure and separation from change history; package versions; docs-only changes; historical evidence unchanged.', markdownFiles: files.length, linksChecked, errors,
  architectureDocuments: architectureFiles.map(relative), architectureErrors, packageVersions, versionErrors,
  nonDocumentationChanges, changedHistoricalEvidence, changedFiles, whitespaceCheck: { exitCode: whitespace.status, output: whitespace.stdout.trim(), recordWhitespaceErrors } };
fs.writeFileSync(report, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ markdownFiles: files.length, linksChecked, errors, architectureDocuments: architectureFiles.length, architectureErrors, versionErrors, nonDocumentationChanges, changedHistoricalEvidence, whitespaceExitCode: whitespace.status, recordWhitespaceErrors }, null, 2));
if (errors.length || architectureErrors.length || versionErrors.length || nonDocumentationChanges.length || changedHistoricalEvidence.length || whitespace.status !== 0 || recordWhitespaceErrors.length) process.exitCode = 1;
