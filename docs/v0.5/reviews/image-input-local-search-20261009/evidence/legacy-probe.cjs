const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../../..');
function load(name, modules) {
  const file = path.join(root, 'references/legacy-web-search/source', name);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in modules)) throw Error(`unexpected import: ${name}`);
    return modules[name];
  }, URL, AbortController, setTimeout, clearTimeout, console }, { filename: file });
  return exports;
}

(async () => {
  const webpage = load('web-page.ts', {
    './web-observation': { isSafePublicWebUrl: () => true },
    '../world-information/feed': { parsePublicInformationFeed: () => { throw Error('not exercised'); } },
  });
  const checks = {
    navigationOnlyVisit: webpage.assessWebPage({ title: 'Example', text: '首页\n产品\n关于我们\n联系我们\n版权说明', articleText: '' }, 'https://example.test/info', 200, 'visit'),
    queryContainsNoResults: webpage.assessWebPage({ title: 'Search', text: 'no results error\nAll\nImages\nVideos\nNews\nPrivacy', articleText: '', searchResultLinks: [] }, 'https://www.bing.com/search?q=no+results+error', 200, 'search'),
  };
  const reader = load('public-web-reader.ts', {
    '../meta': { HDS_INTERLUDE_VERSION: 'offline-review' },
    // No abort is fired in this probe: the omitted helper is represented by a transparent async invocation.
    '../models/request-context': { awaitWithAbortSignal: (_signal, work) => work() },
    './web-observation': { isSafePublicWebUrl: () => true, normalizeBrowserIntentDraft: draft => draft, resolveBrowserTarget: draft => draft.url },
    './web-page': webpage,
  });
  const slots = new reader.BrowserPageSlots(() => 1);
  let open = 0, maximumOpen = 0;
  const closeResolvers = [];
  const host = {
    config: { enabled: true, navigationTimeout: 1000, waitUntil: 'domcontentloaded', maxTextCharacters: 12000, maxExcerptCharacters: 3000 },
    withBrowserSlot: (work, signal) => slots.run(work, signal),
    browser: () => ({ page: async () => {
      open++; maximumOpen = Math.max(maximumOpen, open);
      return { setUserAgent: async () => {}, setRequestInterception: async () => {}, on: () => {}, goto: async () => ({ status: () => 200 }), url: () => 'https://example.test/article', evaluate: async () => ({ title: 'Public article', text: 'Complete body', articleText: 'Complete body' }), close: () => new Promise(resolve => closeResolvers.push(() => { open--; resolve(); })) };
    } }),
  };
  await Promise.all([1, 2].map(() => reader.readPublicWebPage(host, { mode: 'visit', url: 'https://example.test/article' }, { signal: new AbortController().signal, timeoutMs: 1000 })));
  const lifecycle = { slotLimit: 1, maximumOpen, pagesStillOpenAfterReads: open };
  closeResolvers.forEach(resolve => resolve());
  const report = { referenceOnly: true, networkRequests: 0, checks, lifecycle };
  fs.writeFileSync(path.join(__dirname, 'legacy-probe-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
