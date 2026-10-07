import { createHash } from 'node:crypto'
import type { ModelConfig } from '../models/config'
import { resolveEmbeddingRoute } from '../models/embedding-route'

export const EMBEDDING_INDEX_VERSION = 1
export const DEFAULT_HISTORY_INDEX_LIMIT = 20_000

export interface SemanticHistoryRecord {
  id: number
  vector: number[]
  content: string
  occurredAt: string
  participantId: string
  kind: string
}

export interface SemanticHistoryMatch extends Omit<SemanticHistoryRecord, 'vector'> {
  score: number
}

export interface VectorSearchIndex {
  addPoint(id: number, vector: number[] | Float32Array): Promise<void>
  buildIndex(data: Array<{ id: number; vector: number[] | Float32Array }>): Promise<void>
  searchKNN(query: number[] | Float32Array, limit: number): Array<{ id: number; score: number }>
}

interface StorySemanticIndex {
  fingerprint: string
  dimension: number
  index: VectorSearchIndex
  records: Map<number, Omit<SemanticHistoryRecord, 'vector'>>
  writes: Promise<unknown>
}

interface PendingBuild {
  fingerprint: string
  promise: Promise<boolean>
}

/**
 * A rebuildable in-memory ANN index. SQLite remains the only source of truth:
 * this layer can be discarded at any time and reconstructed from compatible
 * vectors stored on script rows. The tiny exact-search fallback keeps source
 * builds and tests usable before the optional runtime dependency is installed.
 */
export class SemanticHistoryIndex {
  private stories = new Map<string, StorySemanticIndex>()
  private pending = new Map<string, PendingBuild>()
  private disposed = false

  constructor(private readonly limit = DEFAULT_HISTORY_INDEX_LIMIT,
    private readonly createIndex: (dimension: number | null) => VectorSearchIndex = createVectorIndex) {}

  ready(storyId: string, fingerprint: string) {
    return this.stories.get(storyId)?.fingerprint === fingerprint
  }

  size(storyId: string) {
    return this.stories.get(storyId)?.records.size ?? 0
  }

  invalidate(storyId?: string) {
    if (storyId) { this.stories.delete(storyId); this.pending.delete(storyId) }
    else { this.stories.clear(); this.pending.clear() }
  }

  dispose() {
    this.disposed = true
    this.invalidate()
  }

  /** Share both SQLite loading and ANN construction for this generation. A
   * removed/replaced pending object is an invalidation token: its work may
   * finish, but it can never publish stale text or erase a newer build. */
  ensure(storyId: string, fingerprint: string, load: () => Promise<SemanticHistoryRecord[]>): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (this.ready(storyId, fingerprint)) return Promise.resolve(true)
    const current = this.pending.get(storyId)
    if (current?.fingerprint === fingerprint) return current.promise
    return this.startBuild(storyId, fingerprint, load)
  }

  build(storyId: string, fingerprint: string, rows: SemanticHistoryRecord[]) {
    return this.startBuild(storyId, fingerprint, async () => rows)
  }

  private startBuild(storyId: string, fingerprint: string, load: () => Promise<SemanticHistoryRecord[]>) {
    if (this.disposed) return Promise.resolve(false)
    this.stories.delete(storyId)
    const pending: PendingBuild = { fingerprint, promise: undefined! }
    this.pending.set(storyId, pending)
    pending.promise = Promise.resolve().then(async () => {
      const rows = await load()
      if (this.pending.get(storyId) !== pending) return false
      const index = await this.buildIndex(fingerprint, rows)
      if (this.pending.get(storyId) !== pending) return false
      this.stories.set(storyId, index)
      return true
    }).finally(() => { if (this.pending.get(storyId) === pending) this.pending.delete(storyId) })
    return pending.promise
  }

  private async buildIndex(fingerprint: string, rows: SemanticHistoryRecord[]): Promise<StorySemanticIndex> {
    const expectedDimension = rows.find(item => item.vector.length > 0)?.vector.length
    const compatible = rows
      .filter(row => row.vector.length > 0)
      .filter(row => row.vector.length === expectedDimension)
      .slice(0, Math.max(1, this.limit))
    const dimension = compatible[0]?.vector.length ?? embeddingDimensionFromFingerprint(fingerprint)
    const index = compatible.length ? this.createIndex(dimension || null) : new ExactVectorIndex(dimension || null)
    await index.buildIndex(compatible.map(row => ({ id: row.id, vector: Float32Array.from(row.vector) })))
    return {
      fingerprint,
      dimension,
      index,
      records: new Map(compatible.map(row => [row.id, withoutVector(row)])),
      writes: Promise.resolve(),
    }
  }

  async add(storyId: string, fingerprint: string, row: SemanticHistoryRecord) {
    if (this.disposed) return false
    // The loader may already have read SQLite before this new persisted row.
    // Cancel that generation; the next recall will include the complete tail.
    const pending = this.pending.get(storyId)
    if (pending) {
      if (pending.fingerprint === fingerprint) this.invalidate(storyId)
      return false
    }
    const current = this.stories.get(storyId)
    if (!current || current.fingerprint !== fingerprint || current.dimension !== row.vector.length) return false
    const run = current.writes.then(async () => {
      if (this.stories.get(storyId) !== current) return false
      if (current.records.has(row.id)) return true
      // HNSW cannot remove old nodes; rebuild the bounded hot tail from SQLite.
      if (current.records.size >= Math.max(1, this.limit)) { this.invalidate(storyId); return false }
      try { await current.index.addPoint(row.id, Float32Array.from(row.vector)) }
      catch (error) {
        if (this.stories.get(storyId) === current) this.invalidate(storyId)
        throw error
      }
      if (this.stories.get(storyId) !== current) return false
      current.records.set(row.id, withoutVector(row))
      return true
    })
    current.writes = run.catch(() => undefined)
    return run
  }

  search(
    storyId: string,
    fingerprint: string,
    query: number[],
    limit: number,
    visible: (record: Omit<SemanticHistoryRecord, 'vector'>) => boolean,
  ): SemanticHistoryMatch[] {
    const current = this.stories.get(storyId)
    if (!current || current.fingerprint !== fingerprint || current.dimension !== query.length || limit <= 0) return []
    const candidateLimit = Math.min(current.records.size, Math.max(64, limit * 16))
    return current.index.searchKNN(Float32Array.from(query), candidateLimit)
      .flatMap(match => {
        const record = current.records.get(match.id)
        return record && visible(record) ? [{ ...record, score: match.score }] : []
      })
      .slice(0, limit)
  }
}

/** Stable, credential-free identity for one embedding configuration. */
export function embeddingFingerprintBase(config: ModelConfig) {
  const embedding = config.embedding
  if (!embedding?.enabled) return ''
  const route = resolveEmbeddingRoute(config)
  if (!route) return ''
  const { provider, model } = route
  const endpoint = normalizeEndpointIdentity(route.identityEndpoint)
  const identity = JSON.stringify({
    version: EMBEDDING_INDEX_VERSION,
    provider: provider.mode || provider.id || provider.label || 'custom',
    endpoint,
    model,
    requestedDimensions: embedding.dimensions || 0,
    maxInputCharacters: embedding.maxInputCharacters,
  })
  return `emb-v${EMBEDDING_INDEX_VERSION}-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`
}

export function embeddingFingerprint(config: ModelConfig, dimensions: number) {
  const base = embeddingFingerprintBase(config)
  return base && dimensions > 0 ? `${base}:d${dimensions}` : ''
}

export function embeddingCompatible(
  vector: number[] | undefined,
  storedFingerprint: string | undefined,
  currentBase: string,
  dimensions?: number,
) {
  if (!vector?.length || !storedFingerprint || !currentBase) return false
  if (!storedFingerprint.startsWith(`${currentBase}:d`)) return false
  const storedDimensions = embeddingDimensionFromFingerprint(storedFingerprint)
  return storedDimensions === vector.length && (!dimensions || dimensions === vector.length)
}

export function embeddingDimensionFromFingerprint(fingerprint: string | undefined) {
  const match = String(fingerprint ?? '').match(/:d(\d+)$/)
  return match ? Number(match[1]) : 0
}

function withoutVector(row: SemanticHistoryRecord): Omit<SemanticHistoryRecord, 'vector'> {
  const { vector: _vector, ...record } = row
  return record
}

function normalizeEndpointIdentity(value: string) {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return value.trim().replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

function createVectorIndex(dimension: number | null): VectorSearchIndex {
  try {
    // Kept external in the published bundle. If an old local installation has
    // not installed the new dependency yet, exact search preserves correctness.
    const HNSW = require('hnsw').HNSW as new (...args: any[]) => VectorSearchIndex
    return new HNSW(16, 200, dimension, 'cosine', 80)
  } catch {
    return new ExactVectorIndex(dimension)
  }
}

class ExactVectorIndex implements VectorSearchIndex {
  private rows = new Map<number, Float32Array>()

  constructor(private dimension: number | null) {}

  async addPoint(id: number, vector: number[] | Float32Array) {
    if (this.dimension && vector.length !== this.dimension) throw new Error('Embedding dimension mismatch.')
    this.dimension = vector.length
    this.rows.set(id, Float32Array.from(vector))
  }

  async buildIndex(data: Array<{ id: number; vector: number[] | Float32Array }>) {
    this.rows.clear()
    for (const row of data) await this.addPoint(row.id, row.vector)
  }

  searchKNN(query: number[] | Float32Array, limit: number) {
    if (this.dimension && query.length !== this.dimension) return []
    return [...this.rows]
      .map(([id, vector]) => ({ id, score: cosine(vector, query) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(0, limit))
  }
}

function cosine(left: Float32Array, right: number[] | Float32Array) {
  if (!left.length || left.length !== right.length) return -1
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : -1
}
