// Documentation-only checks. No services, credentials, databases or provider calls.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../..');
const version = path.join(root, 'docs/v0.5');
const evidence = path.join(__dirname, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const markdown = walk(version).filter(file => file.endsWith('.md'));
const relative = file => path.relative(root, file).replace(/\\/g, '/');
let checkedLinks = 0;
const missingLinks = [];
let checkedAnchors = 0;
const missingAnchors = [];
const headingIds = file => {
  const seen = new Map();
  return new Set([...fs.readFileSync(file, 'utf8').matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map(match => {
    const id = match[1].toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
    const n = seen.get(id) ?? 0; seen.set(id, n + 1); return n ? `${id}-${n}` : id;
  }));
};
for (const file of markdown) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].trim().replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) continue;
    let [target, anchor] = href.split('#');
    target = decodeURIComponent(target).replace(/:\d+$/, '');
    const resolved = target ? path.resolve(path.dirname(file), target) : file;
    checkedLinks++;
    if (!fs.existsSync(resolved)) missingLinks.push({ file: relative(file), target });
    else if (anchor && resolved.endsWith('.md')) {
      checkedAnchors++;
      if (!headingIds(resolved).has(decodeURIComponent(anchor))) missingAnchors.push({ file: relative(file), target, anchor });
    }
  }
}
const current = [path.join(version, 'architecture/REMAKE_V0.5.md'),
  ...walk(path.join(version, 'subsystems')).filter(file => file.endsWith('.md')),
  ...walk(path.join(version, 'reference')).filter(file => file.endsWith('.md'))];
const headingIssues = [];
for (const file of current) {
  const numbers = [...fs.readFileSync(file, 'utf8').matchAll(/^## (\d+)\./gm)].map(match => Number(match[1]));
  numbers.forEach((number, i) => { if (number !== i + 1) headingIssues.push({ file: relative(file), position: i + 1, number }); });
}
const missingSourcePaths = [];
let checkedSourcePaths = 0;
for (const file of current) for (const match of fs.readFileSync(file, 'utf8').matchAll(/`((?:src|scripts|tests|runtime)\/[\w./-]+\.(?:ts|js|cjs))`/g)) {
  checkedSourcePaths++;
  if (!fs.existsSync(path.join(root, match[1]))) missingSourcePaths.push({ file: relative(file), target: match[1] });
}
const links = { date: '2026-10-10', codeBaseline: '008ca2c + offline action boundary correction', markdownFiles: markdown.length,
  checkedLinks, missingLinks, checkedAnchors, missingAnchors, currentRuleFiles: current.map(relative), headingIssues,
  checkedSourcePaths, missingSourcePaths,
  scope: 'All local Markdown targets/anchors, current numbered sections and fully spelled literal source paths; no runtime test. Source rule comparison is recorded separately in README.md.' };
fs.writeFileSync(path.join(evidence, 'document-check.json'), JSON.stringify(links, null, 2) + '\n');

console.log(JSON.stringify({markdownFiles:links.markdownFiles,checkedLinks,checkedAnchors,checkedSourcePaths,missingLinks,missingAnchors,headingIssues,missingSourcePaths}));
process.exitCode=missingLinks.length+missingAnchors.length+headingIssues.length+missingSourcePaths.length?1:0;
