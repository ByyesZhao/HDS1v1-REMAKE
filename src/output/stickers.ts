import { randomUUID } from 'node:crypto';
import { Storage } from '../storage';
import type { EmbeddingProvider } from '../embedding';
export { HttpEmbeddingProvider } from '../embedding';
export type { EmbeddingProvider } from '../embedding';
export class StickerLibrary {
  constructor(private storage: Storage, private embeddings: EmbeddingProvider) {}
  checkReady(): void {
    const items = this.storage.all('stickers');
    if (!items.length) throw new Error('import stickers before enabling the feature');
    if (items.some(s => s.embeddingModel !== this.embeddings.model)) throw new Error('embedding model changed; run the explicit rebuild command');
    if (items.some(s => this.embeddings.dimensions !== undefined && s.embedding.length !== this.embeddings.dimensions || s.embeddingBaseUrl && this.embeddings.baseUrl && s.embeddingBaseUrl !== this.embeddings.baseUrl.replace(/\/$/, ''))) throw new Error('embedding endpoint or dimensions changed; run the explicit rebuild command');
  }
  async importSticker(path: string, description: string): Promise<string> {
    const id = randomUUID(); const embedding = await this.embeddings.embed(description);
    this.storage.save('stickers', id, { id, path, description, embedding, embeddingModel: this.embeddings.model, embeddingBaseUrl: this.embeddings.baseUrl?.replace(/\/$/, '') });
    return id;
  }
  async rebuild(): Promise<void> {
    for (const sticker of this.storage.all('stickers')) {
      const embedding = await this.embeddings.embed(sticker.embeddingInput ?? sticker.description);
      this.storage.save('stickers', sticker.id, { ...sticker, embedding, embeddingModel: this.embeddings.model, embeddingBaseUrl: this.embeddings.baseUrl?.replace(/\/$/, ''), legacyFingerprint: undefined });
    }
  }
  async findSticker(query: string): Promise<string> {
    const vector = await this.embeddings.embed(query);
    const norm = (v: number[]) => Math.sqrt(v.reduce((s, n) => s + n * n, 0));
    const queryNorm = norm(vector);
    let bestId = '', bestScore = -Infinity;
    for (const sticker of this.storage.all('stickers')) {
      const score = vector.reduce((sum, n, i) => sum + n * sticker.embedding[i], 0) / (queryNorm * norm(sticker.embedding));
      if (score > bestScore) { bestScore = score; bestId = sticker.id; }
    }
    if (!bestId) throw new Error('sticker index is empty or contains invalid embeddings');
    return bestId;
  }
}
