// No browser is launched: substitute a failing Puppeteer service in this process only.
const {createRequire} = require('node:module');
const {resolve, join} = require('node:path');
const {writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync} = require('node:fs');
const path = require('node:path');
const root = resolve(__dirname, '../../../../..');
const req = createRequire(join(root, 'package.json'));
req('tsx/cjs');
const koishiPath = req.resolve('koishi');
const originalKoishi = req('koishi');
const {Context, Service} = originalKoishi;
let started = 0, disposedByScript = 0, context;
const errors = [];
class ObservedContext extends Context {
  constructor(...args) {
    super(...args);
    context = this;
    this.on('internal/error', error => {errors.push(String(error));});
    this.on('dispose', () => {disposedByScript++;});
  }
}
require.cache[koishiPath].exports = {...originalKoishi, Context:ObservedContext};
class FailingBrowser extends Service {
  static [Service.provide] = 'puppeteer';
  constructor(ctx) {super(ctx, 'puppeteer');}
  async start() {started++; throw Error('SYNTHETIC_BROWSER_START_FAILURE');}
  async page() {throw Error('probe must not create a page');}
}
const pluginPath = req.resolve('koishi-plugin-puppeteer');
req(pluginPath);
const originalPlugin = require.cache[pluginPath].exports;
require.cache[pluginPath].exports = {default:FailingBrowser};
const {validateLocalWeb} = req('./scripts/validate-local-web.ts');
const tempParent = join(root, '.tmp', 'post-implementation-review');
mkdirSync(tempParent, {recursive:true});
const temp = mkdtempSync(join(tempParent, 'startup-'));
(async () => {
  try {
    const reportPath = join(temp, 'validation.json');
    let settled = false;
    const pending = validateLocalWeb({online:true, probe:true, report:reportPath}).then(() => {settled = true;});
    await Promise.race([pending, new Promise(r => setTimeout(r, 1000))]);
    const result = {baseline:'2a2e77e', observedForMs:1000, serviceStarts:started,
      startupErrors:errors, validationSettled:settled, reportExists:existsSync(reportPath),
      rootDisposalsByValidation:disposedByScript, cleanup:'review probe calls Context.stop after observation'};
    console.log(JSON.stringify(result, null, 2));
    if(process.argv[2]) writeFileSync(resolve(process.argv[2]), JSON.stringify(result, null, 2) + '\n');
  } finally {
    if(context) await context.stop();
    require.cache[pluginPath].exports = originalPlugin;
    require.cache[koishiPath].exports = originalKoishi;
    const child = path.relative(tempParent, temp);
    if(!child || child === '..' || child.startsWith('..' + path.sep)) throw Error('unsafe probe cleanup');
    rmSync(temp, {recursive:true, force:true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
