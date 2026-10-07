// Explicit connectivity check only. No story turn, QQ send or background service.
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { loadSettings, connectionFor } = require('../lib/settings');
const { ModelClient, ChatCompletionsTransport } = require('../lib/model/client');
const { Storage } = require('../lib/storage');
const { StickerLibrary, HttpEmbeddingProvider } = require('../lib/output/stickers');

async function main() {
  const settings = loadSettings(resolve('config.local.json'));
  const fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  const models = new ModelClient(new ChatCompletionsTransport(task => connectionFor(settings, task), fetcher));
  await models.runModel({
    name: 'expression', prompt: '这是独立接口连通验证，不是故事消息。只输出 JSON 对象 {"ok":true}。',
    schema: { type: 'object', properties: { ok: { const: true } }, required: ['ok'], additionalProperties: false },
    parse(value) { if (value?.ok !== true) throw new Error('probe JSON did not match'); return value; },
  }, { probe: true });
  console.log('DeepSeek: authenticated JSON response verified.');
  const e = settings.embedding;
  const provider = new HttpEmbeddingProvider(e.model, e.baseUrl, process.env[e.apiKeyEnv], fetcher, e.dimensions);
  const storage = new Storage(resolve('runtime/data/hdsi-remake.sqlite'));
  try {
    const first = storage.all('stickers')[0];
    const current = await provider.embed(first.embeddingInput ?? first.description);
    if (current.length !== first.embedding.length) throw new Error('embedding dimension mismatch');
    const norm = v => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    const similarity = current.reduce((s, x, i) => s + x * first.embedding[i], 0) / (norm(current) * norm(first.embedding));
    if (similarity < 0.99) throw new Error('legacy embedding canary differs; rebuild vectors before enabling stickers');
    console.log(`Qwen: ${current.length} dimensions; legacy-vector canary cosine=${similarity.toFixed(6)}.`);
    const library = new StickerLibrary(storage, provider); library.checkReady();
    const cases = ['好累，趴着不想动了', '嘿嘿，有点小得意', '抱抱你，想你啦', '好呀，赞同', '早上好', '我要睡了，晚安', '哈哈哈哈笑死', '被夸得有点害羞', '委屈巴巴，想被哄', '我听不懂，满脸问号'];
    const matches = [];
    for (const query of cases) {
      const id = await library.findSticker(query), sticker = storage.read('stickers', id);
      matches.push({ query, assetId: id, description: sticker.description, aliases: sticker.aliases });
    }
    writeFileSync(resolve('runtime/data/sticker-retrieval-check.json'), JSON.stringify({ model: e.model, dimensions: current.length, legacyCanaryCosine: similarity, matches }, null, 2) + '\n');
    console.log(`Sticker lookup: ${matches.length} queries completed; results saved locally.`);
  } finally { storage.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Model connectivity check failed'); process.exitCode = 1; });
