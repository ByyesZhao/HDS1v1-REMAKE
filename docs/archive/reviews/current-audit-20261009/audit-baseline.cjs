// Read-only inventory of public source and the current V0.5 document set.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../..');
const currentDocs = [
  'README.md', 'docs/v0.5/README.md',
  'docs/v0.5/architecture/REMAKE_V0.5.md',
  ...['DIRECTORS','SCHEDULING','MEMORY','SHARED_ACTIVITY','CONTEXT','EXPRESSION_STICKERS','WEB_SEARCH','RECOVERY']
    .map(n => `docs/v0.5/subsystems/REMAKE_V0.5_${n}.md`),
  'docs/v0.5/reference/V0.5_IMPLEMENTATION_MAP_20261009.md',
];
function walk(dir) {
  return fs.readdirSync(path.join(root, dir), {withFileTypes:true}).flatMap(e =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
}
const files = [...currentDocs, ...walk('src'), ...walk('tests'), 'package.json', 'package-lock.json'];
const manifest = files.map(file => {
  const data = fs.readFileSync(path.join(root,file));
  return {file, bytes:data.length, lines:data.toString('utf8').split(/\r?\n/).length,
    sha256:crypto.createHash('sha256').update(data).digest('hex')};
});
const links = [];
for (const file of currentDocs) {
  const text = fs.readFileSync(path.join(root,file),'utf8');
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = m[1];
    if (/^(https?:|#)/i.test(link)) continue;
    const target = link.split('#')[0];
    const resolved = path.resolve(path.dirname(path.join(root,file)),target);
    links.push({file,line:text.slice(0,m.index).split('\n').length,link,
      exists:fs.existsSync(resolved)});
  }
}
fs.writeFileSync(path.join(__dirname,'baseline-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(__dirname,'doc-links.json'),JSON.stringify(links,null,2)+'\n');
console.log(JSON.stringify({publicFiles:manifest.length,currentDocuments:currentDocs.length,
  checkedLocalLinks:links.length,missing:links.filter(l=>!l.exists)},null,2));
