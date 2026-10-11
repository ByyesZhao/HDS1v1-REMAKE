// Run from any directory. Checks documentation only; no services or model calls.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../../..');
const baseline = '9f3c73f8965d649e8b60a5a340314a7e490b1a2b';
const record = 'docs/v0.5/records/document-code-crosscheck-20261011/';
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
const whitespace = spawnSync('git', ['diff', '--check', baseline], { cwd: root, encoding: 'utf8' });
const result = { baseline, scope: 'Inline local Markdown links and heading anchors in docs/v0.5 plus root and docs indexes; documentation-only changes; historical evidence unchanged.', markdownFiles: files.length, linksChecked, errors, nonDocumentationChanges, changedHistoricalEvidence, changedFiles, whitespaceCheck: { exitCode: whitespace.status, output: whitespace.stdout.trim() } };
fs.writeFileSync(report, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ markdownFiles: files.length, linksChecked, errors, nonDocumentationChanges, changedHistoricalEvidence, whitespaceExitCode: whitespace.status }, null, 2));
if (errors.length || nonDocumentationChanges.length || changedHistoricalEvidence.length || whitespace.status !== 0) process.exitCode = 1;
