// Synthetic HTML in real headless Chrome; no public navigation or HDSI service.
const {createRequire} = require('node:module');
const {resolve, join} = require('node:path');
const {writeFileSync, existsSync} = require('node:fs');
const root = resolve(__dirname, '../../../../..');
const req = createRequire(join(root, 'package.json'));
req('tsx/cjs');
const {createKoishiBrowserPort} = req('./src/web/browser/koishi-port.ts');
const {createManagedBrowserProvider} = req('./src/web/browser/provider.ts');
const {WebSearchStore} = req('./src/web/store.ts');
const {WebSearchService} = req('./src/web/service.ts');
const {Storage} = req('./src/storage.ts');
const fixtures = {
  visibleArticle:'<article><p>VISIBLE_REAL_BODY</p></article>',
  loginMain:'<main><h1>Sign in</h1><p>Sign in to continue reading.</p><form><input type="password"><button>Sign in</button></form></main>',
  hiddenArticle:'<style>.hidden{display:none}</style><article class="hidden"><p>HIDDEN_STALE_TEMPLATE</p></article><main><p>VISIBLE_REAL_BODY</p></main>',
  hiddenCaptcha:'<style>.hidden{display:none}</style><div class="hidden"><form id="captcha-form">Dormant captcha</form></div><article><p>VISIBLE_REAL_BODY</p></article>',
};
(async () => {
  const executablePath = process.env.REVIEW_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if(!existsSync(executablePath)) throw Error('Set REVIEW_CHROME_PATH to an installed Chrome executable');
  const browser = await req('puppeteer-core').launch({executablePath, headless:true,
    args:['--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--no-first-run']});
  let pageNetworkAttempts = 0, opened = 0, closed = 0;
  const result = {baseline:'2a2e77e', fixture:'synthetic setContent, actual Chrome/Koishi port/provider/WebSearchService', cases:{}};
  try {
    result.browserVersion = await browser.version();
    for(const [name, html] of Object.entries(fixtures)) {
      let raw;
      const basePort = createKoishiBrowserPort(async () => {
        const page = await browser.newPage();
        opened++;
        // No fixture contains an external resource; abort any unexpected request.
        await page.setRequestInterception(true);
        page.on('request', request => {pageNetworkAttempts++; if(!request.isInterceptResolutionHandled()) void request.abort();});
        return new Proxy(page, {get(target, property) {
          if(property === 'goto') return async () => {await target.setContent(html, {waitUntil:'domcontentloaded'}); return {status:() => 200};};
          if(property === 'url') return () => 'https://synthetic.test/' + name;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }});
      });
      const port = {async openPage() {
        const page = await basePort.openPage();
        return {...page, async read(...args) {raw = await page.read(...args); return raw;},
          async close() {await page.close(); closed++;}};
      }};
      const managed = createManagedBrowserProvider(port, {engine:'bing', navigationTimeoutMs:5000, maxConcurrentPages:1});
      const db = new Storage(':memory:');
      try {
        const store = new WebSearchStore(db);
        const web = new WebSearchService(store, managed.provider, {now:() => '2026-10-10T00:00:00Z'}, {enabled:true});
        const session = web.openSession(store.openStage('turn', 'probe', name, 'personal_life'));
        const url = 'https://synthetic.test/' + name;
        const {operationId} = session.beginOperation({kind:'read', url});
        const response = await session.readPage(url, {operationId});
        result.cases[name] = {access:raw.access, main:raw.main, counters:response.counters,
          bodies:response.materials.map(m => m.body), failures:response.failures};
      } finally {await managed.dispose(); db.close();}
    }
    result.pageNetworkAttempts = pageNetworkAttempts;
    result.ownedPages = {opened, closed, remaining:opened - closed};
  } finally {await browser.close();}
  if(process.argv[2]) writeFileSync(resolve(process.argv[2]), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
})().catch(error => {console.error(error); process.exitCode = 1;});
