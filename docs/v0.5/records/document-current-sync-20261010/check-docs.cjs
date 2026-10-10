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
const links = { date: '2026-10-10', codeBaseline: '726eb00', markdownFiles: markdown.length,
  checkedLinks, missingLinks, checkedAnchors, missingAnchors, currentRuleFiles: current.map(relative), headingIssues,
  checkedSourcePaths, missingSourcePaths,
  scope: 'All local Markdown targets/anchors, current numbered sections and fully spelled literal source paths; no runtime test. Source rule comparison is recorded separately in README.md.' };
fs.writeFileSync(path.join(evidence, 'document-check.json'), JSON.stringify(links, null, 2) + '\n');

// Explicit whitelist: never serialize the configuration object, credentials or character text.
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.local.json'), 'utf8'));
const roles = ['narrative', 'narrative_shared', 'personal_chat', 'personal_life', 'personal_shared',
  'expression', 'memory', 'memory_consolidation', 'world', 'school_campus', 'school_group', 'school_week'];
const connection = (role, c, inheritedFrom) => ({ role, model: c?.model ?? null,
  reasoningEffort: c?.reasoningEffort ?? (role.startsWith('school_') ? 'low' : 'high'),
  outputMode: c?.outputMode ?? 'json_object', providerHost: new URL(c?.baseUrl ?? 'https://api.deepseek.com').hostname,
  ...(inheritedFrom ? { inheritedFrom } : {}) });
const models = roles.map(role => connection(role, config.models?.[role] ?? (role.startsWith('school_') ? config.models?.school : undefined)));
models.push(connection('sticker_description', config.stickerDescriptionModel));
models.push(connection('incoming_image', config.incomingImageModel ?? config.stickerDescriptionModel,
  config.incomingImageModel ? undefined : 'sticker_description'));
const embedding = c => ({ model: c?.model ?? 'qwen3.7-text-embedding', dimensions: c?.dimensions ?? 1024 });
const calibration = config.memory?.calibrationFile ? JSON.parse(fs.readFileSync(path.resolve(root, config.memory.calibrationFile), 'utf8')) : null;
const fallback = (object, key, value) => object?.[key] === undefined ? value : object[key];
const memory = config.memory ?? {};
const capacityDefaults = { shortActiveLimit: 100, longActiveLimit: 1000, longArchiveLimit: 500, archiveRetentionDays: 90 };
const contextDefaults = { alwaysIncludeCharactersLimit: null, candidateItemsPerRoute: null, detailItemsLimit: null,
  shortItemsLimit: null, longItemsLimit: null, recentDialogueSegments: 4, dialogueIdleMinutes: 15 };
const memoryDefaults = { idleMaintenanceMinutes: 15, maintenanceDuringSleep: true, batchItems: 20, batchCharacters: null,
  queryTimeoutMs: 1500, backgroundTimeoutMs: 120000, retryDelayMs: 300000, cacheSize: 256, cacheTtlMs: 600000 };
const fields = (object, defaults) => Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, fallback(object, key, value)]));
const koishiFile = path.join(root, 'runtime/koishi.yml');
const yaml = require(require.resolve('yaml', { paths: [path.join(root, 'runtime')] }));
const koishi = yaml.parse(fs.readFileSync(koishiFile, 'utf8'));
const hasPlugin = (object, prefix) => !!object && typeof object === 'object' && Object.entries(object).some(([key, value]) =>
  key.startsWith(prefix) || key.startsWith('group:') && hasPlugin(value, prefix));
const backgroundViews = config.backgroundViewsFile ? JSON.parse(fs.readFileSync(path.resolve(root, config.backgroundViewsFile), 'utf8')) : config.backgroundViews;
const backgroundMapping = backgroundViews ? { status: backgroundViews.status, version: backgroundViews.version,
  sourceParagraphs: backgroundViews.sourceMap?.length ?? 0, migratedFacts: backgroundViews.facts?.length ?? 0,
  uses: Object.fromEntries(['core', 'style', 'world', 'campus', 'group'].map(use => [use,
    (backgroundViews.sourceMap ?? []).filter(row => row.uses.includes(use)).map(row => row.paragraph)])) } : null;
const effective = { date: '2026-10-10', codeBaseline: '726eb00', configuration: 'config.local.json',
  models, modelTaskNames: models.length, logicalPurposes: models.length + 1,
  configuredConnections: roles.length + (config.stickerDescriptionModel ? 1 : 0) + (config.incomingImageModel ? 1 : 0),
  auditConnection: 'memory_consolidation',
  visualInput: { enabled: config.visualInput?.enabled ?? false, incomingImageOverrideConfigured: !!config.incomingImageModel },
  web: { enabled: config.webSearch?.enabled ?? false, provider: config.webSearch?.provider ?? 'unconfigured',
    browser: { engine: config.webSearch?.browser?.engine ?? 'bing', navigationTimeoutMs: config.webSearch?.browser?.navigationTimeoutMs ?? 60000,
      maxConcurrentPages: config.webSearch?.browser?.maxConcurrentPages ?? 1 },
    maxSuccessReads: config.webSearch?.maxSuccessReads ?? 20, maxFailures: config.webSearch?.maxFailures ?? 40 },
  embeddings: { memory: embedding(config.memoryEmbedding), sticker: embedding(config.embedding) },
  runtime: { puppeteerConfigured: hasPlugin(koishi.plugins, 'puppeteer:') },
  backgroundMapping,
  parameters: { timezone: config.timezone ?? 'Asia/Shanghai', historyBudget: fallback(config, 'historyBudget', null),
    sharedIdleSeconds: config.sharedIdleSeconds ?? 60, sharedMaxSteps: config.sharedMaxSteps ?? 20,
    environmentDailyAt: config.environmentDailyAt ?? '06:00', environmentRetryMs: config.environmentRetryMs ?? 300000,
    sleepHabits: fields(config.sleepHabits, { sleepStart: '23:30', sleepEnd: '00:30', wakeStart: '08:00', wakeEnd: '09:00', preparationMinutes: 60 }),
    stickersEnabled: config.stickersEnabled ?? false,
    memory: { ...fields(memory, memoryDefaults), capacity: fields(memory.capacity, capacityDefaults), contextLimits: fields(memory.contextLimits, contextDefaults) } },
  semanticCalibrationEnabled: calibration?.semantic != null,
  scope: 'Local configuration whitelist, enabled plugin names and approved background mapping metadata only; defaults checked against src/settings.ts. No settings loader, key.txt, original character background file, database or online calls. No private prose or authentication values are serialized.' };
fs.writeFileSync(path.join(evidence, 'effective-models.json'), JSON.stringify(effective, null, 2) + '\n');
// The checker creates its own two linked outputs on the first run. Recheck
// targets after both have been written, retaining genuinely missing targets.
for (let i = missingLinks.length - 1; i >= 0; i--) {
  const item = missingLinks[i];
  if (fs.existsSync(path.resolve(path.dirname(path.join(root, item.file)), item.target))) missingLinks.splice(i, 1);
}
fs.writeFileSync(path.join(evidence, 'document-check.json'), JSON.stringify(links, null, 2) + '\n');
console.log(JSON.stringify({ markdownFiles: links.markdownFiles, checkedLinks, missingLinks: missingLinks.length,
  checkedAnchors, missingAnchors: missingAnchors.length, checkedSourcePaths, missingSourcePaths: missingSourcePaths.length,
  headingIssues: headingIssues.length, modelTaskNames: models.length, logicalPurposes: effective.logicalPurposes,
  configuredConnections: effective.configuredConnections, webEnabled: effective.web.enabled,
  visualInputEnabled: effective.visualInput.enabled, semanticCalibrationEnabled: effective.semanticCalibrationEnabled }));
if (missingLinks.length || missingAnchors.length || missingSourcePaths.length || headingIssues.length) process.exitCode = 1;
