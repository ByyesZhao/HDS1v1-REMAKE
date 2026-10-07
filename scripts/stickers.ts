import { resolve, extname } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import {randomUUID} from 'node:crypto';
import { Storage } from '../src/storage';
import { loadSettings, connectionFor } from '../src/settings';
import { HttpEmbeddingProvider, StickerLibrary } from '../src/output/stickers';
import { ModelClient, ChatCompletionsTransport } from '../src/model/client';
import {assembleWeb} from '../src/deployment/web-runtime';
import {describeSticker} from '../src/output/sticker-description';
import {systemClock} from '../src/time';

async function main() {
  const [command, source, configPath = 'config.local.json', databasePath = 'runtime/data/hdsi-remake.sqlite'] = process.argv.slice(2);
  if (!['import', 'rebuild'].includes(command) || (command === 'import' && !source)) {
    console.log('npm run stickers -- import <image-or-directory> [configPath] [databasePath]\nnpm run stickers -- rebuild - [configPath] [databasePath]\nStop the story plugin while importing or rebuilding.');
    return;
  }
  const settings = loadSettings(resolve(configPath)); const embedding = settings.embedding;
  if (!embedding || !process.env[embedding.apiKeyEnv]) throw new Error('configure qwen embedding and its environment key first');
  const storage = new Storage(resolve(databasePath));
  const ownerId=randomUUID();let web:ReturnType<typeof assembleWeb>|undefined;
  try {
    web=assembleWeb(storage,settings,systemClock);
    const library = new StickerLibrary(storage, new HttpEmbeddingProvider(embedding.model, embedding.baseUrl, process.env[embedding.apiKeyEnv]!, fetch, embedding.dimensions));
    if (command === 'rebuild') { await library.rebuild(); console.log('Sticker embeddings rebuilt.'); return; }
    const files = statSync(source).isDirectory() ? readdirSync(source).filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f)).sort().map(f => resolve(source, f)) : [resolve(source)];
    const models = new ModelClient(new ChatCompletionsTransport(task => connectionFor(settings, task)));
    for (const path of files) {
      const ext = extname(path).slice(1).toLowerCase(); const mime = ext === 'jpg' ? 'jpeg' : ext;
      const imageDataUrl = `data:image/${mime};base64,${readFileSync(path).toString('base64')}`;
      const result = await describeSticker(models,web,ownerId,path,imageDataUrl);
      const id = await library.importSticker(path, result.description);
      console.log(`Imported ${path} -> ${id}`);
    }
  } finally { web?.releaseOwner('asset',ownerId);storage.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
