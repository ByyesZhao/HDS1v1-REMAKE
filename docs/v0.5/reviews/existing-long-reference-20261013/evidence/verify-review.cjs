// Read-only repository checks, except for this review's new verification report.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../../..');
const baseline = '44cfdbdf2e137a4f699728d4f42659bcb89dec31';
const review = 'docs/v0.5/reviews/existing-long-reference-20261013/';
const report = path.join(__dirname, 'document-verification.json');
if (!fs.existsSync(report)) fs.writeFileSync(report, '{}\n');
const rel = file => path.relative(root, file).replaceAll('\\', '/');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const lines = value => value ? value.split(/\r?\n/) : [];
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : file.endsWith('.md') ? [file] : [];
});
const noFences = value => value.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
const anchors = file => {
  const result = new Set(), counts = new Map(), content = fs.readFileSync(file, 'utf8');
  for (const match of noFences(content).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = match[1].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/<[^>]+>/g, '').toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = counts.get(slug) || 0;
    result.add(slug + (count ? '-' + count : '')); counts.set(slug, count + 1);
  }
  for (const match of content.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) result.add(match[1]);
  return result;
};
const files = [...walk(path.join(root, 'docs/v0.5')), path.join(root, 'README.md'), path.join(root, 'docs/README.md')];
const cache = new Map(), errors = [];
let linksChecked = 0;
for (const file of files) {
  for (const match of noFences(fs.readFileSync(file, 'utf8')).matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) continue;
    linksChecked++;
    let decoded;
    try { decoded = decodeURIComponent(href); } catch { errors.push({ file: rel(file), href, error: 'invalid encoding' }); continue; }
    const hash = decoded.indexOf('#'), targetPath = hash < 0 ? decoded : decoded.slice(0, hash);
    const target = targetPath ? path.resolve(path.dirname(file), targetPath.replace(/:\d+$/, '')) : file;
    if (!fs.existsSync(target)) { errors.push({ file: rel(file), href, error: 'missing target' }); continue; }
    if (hash >= 0 && decoded.slice(hash + 1) && target.endsWith('.md')) {
      if (!cache.has(target)) cache.set(target, anchors(target));
      if (!cache.get(target).has(decoded.slice(hash + 1))) errors.push({ file: rel(file), href, error: 'missing anchor' });
    }
  }
}
const inputs = JSON.parse(fs.readFileSync(path.join(__dirname, 'input-hashes.json'), 'utf8'));
const changedOriginalInputs = inputs.filter(item => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, item.path))).digest('hex') !== item.sha256);
const allowed = new Set([...inputs.map(item => item.path), 'docs/v0.5/README.md', 'docs/v0.5/plans/README.md', 'docs/v0.5/reviews/README.md']);
const changedFiles = [...new Set([...lines(git(['diff', '--name-only', baseline])), ...lines(git(['ls-files', '--others', '--exclude-standard']))])].sort();
const unexpectedChanges = changedFiles.filter(file => !allowed.has(file) && !file.startsWith(review));
const whitespace = spawnSync('git', ['diff', '--check', baseline], { cwd: root, encoding: 'utf8' });
const newReviewFiles = changedFiles.filter(file => file.startsWith(review));
const newReviewWhitespaceErrors = newReviewFiles.flatMap(file => {
  const check = spawnSync('git', ['diff', '--no-index', '--check', '--', 'NUL', file], { cwd: root, encoding: 'utf8' });
  const output = check.stdout?.trim() || '';
  return output || ![0, 1].includes(check.status)
    ? [{ file, exitCode: check.status, output, error: check.error?.message || check.stderr?.trim() || null }]
    : [];
});
const result = { baseline, scope: 'V0.5 links/anchors; original SOL package hashes; only review package, original untracked SOL package, and three indexes allowed.',
  markdownFiles: files.length, linksChecked, errors, changedOriginalInputs, unexpectedChanges, changedFiles,
  whitespaceCheck: { exitCode: whitespace.status, output: whitespace.stdout.trim() },
  newReviewWhitespace: { filesChecked: newReviewFiles.length, errors: newReviewWhitespaceErrors } };
fs.writeFileSync(report, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ markdownFiles: files.length, linksChecked, errors, changedOriginalInputs, unexpectedChanges, whitespaceExitCode: whitespace.status,
  newReviewFilesChecked: newReviewFiles.length, newReviewWhitespaceErrors }, null, 2));
if (errors.length || changedOriginalInputs.length || unexpectedChanges.length || whitespace.status !== 0 || newReviewWhitespaceErrors.length) process.exitCode = 1;
