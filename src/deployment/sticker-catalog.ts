import type { Storage } from '../storage';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
export interface LegacyIdentity { model: string; baseUrl: string; dimensions: number; fingerprint?: string }
export interface LegacyCatalog { assets: Array<{ assetId: string; filePath: string; description: string; aliases: string[]; embeddingInput: string; embedding: number[]; embeddingFingerprint: string }> }
export function importLegacyCatalog(storage: Storage, catalog: LegacyCatalog, sourceRoot: string, destinationRoot: string, source: LegacyIdentity, target: LegacyIdentity): number {
  if (source.model !== target.model || source.baseUrl.replace(/\/$/, '') !== target.baseUrl.replace(/\/$/, '') || source.dimensions !== target.dimensions) throw new Error('incompatible legacy embedding configuration; rebuild vectors from the saved descriptions');
  const assets = catalog.assets.map(asset => {
    if (asset.embeddingFingerprint !== source.fingerprint || asset.embedding.length !== target.dimensions || !asset.embedding.every(Number.isFinite)) throw new Error(`incompatible legacy vector: ${asset.assetId}`);
    const original = resolve(sourceRoot, asset.filePath), destination = resolve(destinationRoot, asset.filePath);
    if (!original.startsWith(resolve(sourceRoot) + sep) || !destination.startsWith(resolve(destinationRoot) + sep)) throw new Error('catalog path must stay inside its image directory');
    if (!existsSync(original)) throw new Error(`missing source image: ${asset.filePath}`);
    return { asset, original, destination };
  });
  for (const { original, destination } of assets) {
    mkdirSync(dirname(destination), { recursive: true });
    if (original !== destination) copyFileSync(original, destination);
  }
  storage.transaction(() => {
    for (const { asset, destination } of assets) storage.save('stickers', asset.assetId, {
      id: asset.assetId, path: destination, description: asset.description, aliases: asset.aliases,
      embeddingInput: asset.embeddingInput, embedding: asset.embedding, embeddingModel: target.model,
      embeddingBaseUrl: target.baseUrl.replace(/\/$/, ''), legacyFingerprint: asset.embeddingFingerprint,
    });
  });
  return assets.length;
}
