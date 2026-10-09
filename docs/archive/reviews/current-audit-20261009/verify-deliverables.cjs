const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname,'../../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname,'baseline-manifest.json'),'utf8'));
const changed = manifest.filter(row => {
  const bytes = fs.readFileSync(path.join(root,row.file));
  return crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256;
}).map(row=>row.file);
const reports = ['README.md','MEMORY_REVIEW.md','DIALOGUE_REVIEW.md','SCHEDULING_REVIEW.md'];
const brokenLinks = [];
for (const file of reports) {
  const full = path.join(__dirname,file),text = fs.readFileSync(full,'utf8');
  for(const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link=m[1];
    if (/^(https?:|#)/i.test(link)) continue;
    if(!fs.existsSync(path.resolve(path.dirname(full),link.split('#')[0])))
      brokenLinks.push({file,link});
  }
}
const result={checkedBaselineFiles:manifest.length,changedBaselineFiles:changed,
  checkedReports:reports,brokenLinks};
fs.writeFileSync(path.join(__dirname,'deliverable-verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(changed.length||brokenLinks.length)process.exitCode=1;
