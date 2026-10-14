// Read-only repository checks, except for this review's new verification report.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../../..');
const baseline = '19cdf58b49398d1b4e9e181d44bf4ae809421fb2';
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
const inputs=JSON.parse(fs.readFileSync(path.join(root,'docs/v0.5/reviews/existing-long-reference-20261013/evidence/input-hashes.json'),'utf8'));
const changedInputs=inputs.filter(r=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,r.path))).digest('hex')!==r.sha256).map(r=>r.path);
const versions=['package.json','package-lock.json','runtime/package.json','runtime/package-lock.json'].map(f=>({file:f,version:JSON.parse(fs.readFileSync(path.join(root,f),'utf8')).version}));
const versionErrors=versions.filter(r=>r.version!=='0.5.2');
const snapshot=JSON.parse(fs.readFileSync(path.join(__dirname,'pre-edit-fingerprints.json'),'utf8'));
const changedFiles=entries=>entries.filter(r=>!fs.existsSync(path.join(root,r.file))||crypto.createHash('sha256').update(fs.readFileSync(path.join(root,r.file))).digest('hex')!==r.sha256).map(r=>r.file);
const changedHistory=changedFiles(snapshot.history),changedProduct=changedFiles(snapshot.product);
const touched=[...new Set([...lines(git(['diff','--name-only',baseline])),...lines(git(['ls-files','--others','--exclude-standard']))])];
const outsideDocumentation=touched.filter(p=>!p.startsWith('docs/')&&p!=='README.md');
const numberedSectionErrors=[];
for(const file of [...walk(path.join(root,'docs/v0.5/architecture')),...walk(path.join(root,'docs/v0.5/subsystems'))]){
 const seen=new Set();
 for(const match of noFences(fs.readFileSync(file,'utf8')).matchAll(/^##\s+(\d+)\.\s/gm)){
  if(seen.has(match[1]))numberedSectionErrors.push({file:rel(file),section:match[1]});seen.add(match[1]);
 }
}
const releaseTagCommit=git(['rev-parse','v0.5.2^{}']);
const tagMismatch=releaseTagCommit!=='7138aadf80bd390bf51a24b0cd027327ee365ce2';
const result={checkedAt:new Date().toISOString(),baseline,markdownFiles:files.length,linksChecked,errors,numberedSectionErrors,originalInputCount:inputs.length,changedInputs,historicalFiles:snapshot.history.length,changedHistory,productFiles:snapshot.product.length,changedProduct,outsideDocumentation,releaseTagCommit,tagMismatch,versions};
fs.writeFileSync(report,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
if(errors.length||numberedSectionErrors.length||changedInputs.length||versionErrors.length||changedHistory.length||changedProduct.length||outsideDocumentation.length||tagMismatch)process.exitCode=1;
