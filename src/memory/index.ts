import type { Clock } from '../types';
import type { EmbeddingProvider } from '../embedding';
import type { IndexJob, IndexResult, RetrievalStats } from './types';
import { MemoryStore } from './store';

export function normalizeVector(vector: number[]): Float32Array {
  const norm = Math.hypot(...vector);
  if (!norm || !Number.isFinite(norm)) throw new Error('embedding vector has no finite norm');
  return Float32Array.from(vector, value => value / norm);
}
export interface MemoryIndexOptions {
  clock?: Clock; queryTimeoutMs?: number; cacheSize?: number; cacheTtlMs?: number; templateVersion?: string;
}
export class MemoryIndex {
  readonly configSignature: string;
  readonly stats: RetrievalStats;
  private cache = new Map<string, { at: number; vector: Float32Array }>();
  private clock: Clock;
  constructor(private store: MemoryStore, private provider: EmbeddingProvider, private options: MemoryIndexOptions = {}) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.configSignature = JSON.stringify({ endpoint: provider.baseUrl?.replace(/\/$/, '') ?? '', model: provider.model,
      dimensions: provider.dimensions ?? null, template: options.templateVersion ?? 'memory-v3-text-2' });
    store.storage.set('memory_embedding_signature', this.configSignature);
    this.stats = { queries: 0, cacheHits: 0, remoteRequests: 0, timeouts: 0, failures: 0, lexicalFallbacks: 0, startedAt: this.clock.now() };
  }
  get dimensions():number|undefined{return this.provider.dimensions;}
  async query(text: string, signal?: AbortSignal): Promise<Float32Array | null> {
    this.stats.queries++;
    const now = Date.parse(this.clock.now()), key = `${this.configSignature}\n${text}`;
    const hit = this.cache.get(key);
    this.cache.delete(key);
    if (hit && now - hit.at < (this.options.cacheTtlMs ?? 600000)) {
      this.cache.set(key, hit); this.stats.cacheHits++; return hit.vector;
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined, timedOut = false;
    this.stats.remoteRequests++;
    try {
      const timeout = new Promise<null>(resolve => {
        timer = setTimeout(() => { timedOut = true; this.stats.timeouts++; controller.abort(); resolve(null); }, this.options.queryTimeoutMs ?? 1500);
      });
      const remote = this.provider.embed(text, { signal: controller.signal }).then(normalizeVector);
      const vector = await Promise.race([remote, timeout]);
      if (vector) {
        this.cache.set(key, { at: Date.parse(this.clock.now()), vector });
        while (this.cache.size > (this.options.cacheSize ?? 256)) this.cache.delete(this.cache.keys().next().value!);
      }
      return vector;
    } catch {
      if (!timedOut) this.stats.failures++;
      return null;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async prepare(job: IndexJob, signal: AbortSignal): Promise<IndexResult> {
    signal.throwIfAborted();
    const normalizedVector = normalizeVector(await this.provider.embed(job.text, { signal }));
    signal.throwIfAborted();
    return { jobId: job.id, owner: job.owner, configSignature: this.configSignature, normalizedVector };
  }
}
