const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');
const runtimeRequire = createRequire(resolve(__dirname, 'package.json'));
const packages = ['koishi', 'koishi-plugin-adapter-onebot', 'koishi-plugin-hdsi-remake', '@koishijs/plugin-console'];
for (const name of packages) {
  const entry = runtimeRequire.resolve(name);
  const plugin = runtimeRequire(name);
  console.log(`${name}: ${entry}`);
  if (name === 'koishi-plugin-hdsi-remake' && (plugin.name !== 'hdsi-remake' || typeof plugin.apply !== 'function')) throw new Error('plugin entry is invalid');
}
console.log('Runtime and HDSI plugin loading verified.');
const settingsPath = resolve(__dirname, '../config.local.json');
if (existsSync(settingsPath)) {
  const { loadSettings, connectionFor, modelRoles } = require('../lib/settings');
  const settings = loadSettings(settingsPath);
  if(settings.webSearch.enabled)throw new Error('web search enabled but provider not configured');
  modelRoles.forEach(role => connectionFor(settings, role));
  if(!process.env[settings.memoryEmbedding.apiKeyEnv])throw new Error('memory embedding local key is missing');
  const {Storage:MemoryStorage}=require('../lib/storage'),{MemoryStore}=require('../lib/memory/store');
  const formalPath=resolve(__dirname,'data/hdsi-remake.sqlite');
  if(existsSync(formalPath)){const {inspectSharedUpgrade}=require('../lib/deployment/shared-upgrade');if(inspectSharedUpgrade(formalPath).version!==1)throw new Error('Stop HDSI and run shared:migrate -- --database runtime/data/hdsi-remake.sqlite --check before startup');const db=new MemoryStorage(formalPath);try{if(new MemoryStore(db).schemaVersion()!==3)throw new Error('Stop HDSI and run memory:migrate -- --stopped before startup');}finally{db.close();}}
  if (settings.stickersEnabled) {
    const { Storage } = require('../lib/storage');
    const { StickerLibrary, HttpEmbeddingProvider } = require('../lib/output/stickers');
    const e = settings.embedding;
    if (!e || !process.env[e.apiKeyEnv]) throw new Error('embedding configuration or local key is missing');
    const databasePath = resolve(__dirname, 'data/hdsi-remake.sqlite');
    if (!existsSync(databasePath)) throw new Error('import the sticker catalog before startup');
    const storage = new Storage(databasePath);
    try {
      new StickerLibrary(storage, new HttpEmbeddingProvider(e.model, e.baseUrl, process.env[e.apiKeyEnv], fetch, e.dimensions)).checkReady();
      console.log(`Formal configuration and local credentials verified; ${storage.all('stickers').length} stickers ready. No network requests made.`);
    } finally { storage.close(); }
  }
}
