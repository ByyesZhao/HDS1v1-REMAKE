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
for (const file of markdown) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) continue;
    target = decodeURIComponent(target).replace(/:\d+$/, '');
    checkedLinks++;
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) missingLinks.push({ file: relative(file), target });
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
const links = { date: '2026-10-10', codeBaseline: 'c4477da', markdownFiles: markdown.length,
  checkedLinks, missingLinks, currentRuleFiles: current.map(relative), headingIssues,
  scope: 'Local Markdown targets and current numbered sections only; not a runtime test or semantic review.' };
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
const effective = { date: '2026-10-10', codeBaseline: 'c4477da', configuration: 'config.local.json',
  models, modelTaskNames: models.length, logicalPurposes: models.length + 1,
  configuredConnections: roles.length + (config.stickerDescriptionModel ? 1 : 0) + (config.incomingImageModel ? 1 : 0),
  auditConnection: 'memory_consolidation',
  visualInput: { enabled: config.visualInput?.enabled ?? false, incomingImageOverrideConfigured: !!config.incomingImageModel },
  web: { enabled: config.webSearch?.enabled ?? false, provider: config.webSearch?.provider ?? 'unconfigured',
    browser: { engine: config.webSearch?.browser?.engine ?? 'bing', navigationTimeoutMs: config.webSearch?.browser?.navigationTimeoutMs ?? 60000,
      maxConcurrentPages: config.webSearch?.browser?.maxConcurrentPages ?? 1 },
    maxSuccessReads: config.webSearch?.maxSuccessReads ?? 20, maxFailures: config.webSearch?.maxFailures ?? 40 },
  embeddings: { memory: embedding(config.memoryEmbedding), sticker: embedding(config.embedding) },
  semanticCalibrationEnabled: calibration?.semantic != null,
  scope: 'Raw local configuration whitelist with defaults checked against src/settings.ts; no settings loader, credentials, background, database or online calls.' };
fs.writeFileSync(path.join(evidence, 'effective-models.json'), JSON.stringify(effective, null, 2) + '\n');
console.log(JSON.stringify({ markdownFiles: links.markdownFiles, checkedLinks, missingLinks: missingLinks.length,
  headingIssues: headingIssues.length, modelTaskNames: models.length, logicalPurposes: effective.logicalPurposes,
  configuredConnections: effective.configuredConnections, webEnabled: effective.web.enabled,
  visualInputEnabled: effective.visualInput.enabled, semanticCalibrationEnabled: effective.semanticCalibrationEnabled }));
if (missingLinks.length || headingIssues.length) process.exitCode = 1;
