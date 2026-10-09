const { Context } = require('koishi');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const ctx = new Context();
  ctx.provide('probeBrowser');
  const calls = [];
  ctx.plugin({ name: 'optional-browser-consumer', inject: { optional: ['probeBrowser'] }, apply(c) { calls.push({ browserAvailable: !!c.get('probeBrowser') }); } });
  const beforeService = [...calls];
  ctx.set('probeBrowser', { page() {} });
  await ctx.start();
  const afterService = [...calls];
  await ctx.stop();
  const report = { networkRequests: 0, usesRealInstalledKoishiContext: true, beforeService, afterService };
  fs.writeFileSync(path.join(__dirname, 'koishi-inject-probe-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
