import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Storage } from '../src/storage';
import { loadSettings } from '../src/settings';
import { importLegacyCatalog, type LegacyCatalog, type LegacyIdentity } from '../src/deployment/sticker-catalog';

const [catalogPath, imageRoot, identityPath, configPath = 'config.local.json', databasePath = 'runtime/data/hdsi-remake.sqlite'] = process.argv.slice(2);
if (!catalogPath || !imageRoot || !identityPath) {
  console.log('npm run stickers:catalog -- <catalog.json> <image-root> <verified-identity.json> [config.json] [database.sqlite]');
  process.exitCode = 1;
} else {
  const settings = loadSettings(resolve(configPath));
  if (!settings.embedding) throw new Error('configure embedding before importing catalog');
  const catalog = JSON.parse(readFileSync(resolve(catalogPath), 'utf8')) as LegacyCatalog;
  const identity = JSON.parse(readFileSync(resolve(identityPath), 'utf8')) as LegacyIdentity;
  const storage = new Storage(resolve(databasePath));
  try {
    const count = importLegacyCatalog(storage, catalog, resolve(imageRoot), resolve('runtime/data/stickers'), identity, settings.embedding);
    console.log(`Imported ${count} catalog entries without calling a model.`);
  } finally { storage.close(); }
}
