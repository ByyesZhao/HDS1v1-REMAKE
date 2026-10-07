import { Context, h, Session, Time } from 'koishi'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ModelConfig, StickerDescriber } from '../models/config'
import type { OneBotNapCatConfig, StickerLibraryConfig } from '../runtime/config'
import type { LocalMediaDraft, StickerAsset, StickerCatalogEntry } from '../types'
import { embeddingCompatible, embeddingFingerprint, embeddingFingerprintBase } from '../memory/semantic-index'
import type { InteractionLog } from './media'
import { guessImageMime, MEDIA_IO_TIMEOUT } from './media-input'
import { evaluateExpressionSelection } from './expression'
import { isEnabledAccount, isOneBotPlatform, normalizeAccountId } from './onebot'
import { extractOneBotMarketStickerObservations, isStrictOneBotMarketCollectionEvent, isStrictQQMarketStickerUrl, listStickerFiles, normalizeStickerSemanticHint, pathInsideRoot, rankStickerCatalog, readStickerSemanticHint, safeStickerPathSegment, selectEquivalentStickerVariant, SEMANTIC_STICKER_LIMIT, stableStickerAssetId, stickerExtension, stickerMime } from './sticker-assets'

/** Only the global rebuildable sticker table is accessible through this port. */
export interface StickerAssetStore {
  get(query: Record<string, unknown>, options?: { sort?: Record<string, 'asc' | 'desc'> }): Promise<StickerAsset[]>
  create(value: Omit<StickerAsset, 'id'>): Promise<StickerAsset>
  set(query: Record<string, unknown>, value: Partial<StickerAsset>): Promise<StickerAsset | undefined>
  removeIds(ids: number[]): Promise<unknown>
}

export interface StickerLibraryOptions {
  config?: StickerLibraryConfig
  model: ModelConfig
  onebot?: Pick<OneBotNapCatConfig, 'botAccounts' | 'userAccounts'>
  baseDir: string
  http: Context['http']
  setTimeout(callback: () => void, delay: number): unknown
  store: StickerAssetStore
  describer: StickerDescriber
  imageBytesToNative(bytes: Buffer, mimeType: string): Promise<{ mimeType: string, dataUri: string } | undefined>
  embedText(text: string): Promise<number[]>
  log: Pick<InteractionLog, 'reportStandalone' | 'reportStandaloneOperation'>
}

export interface StickerSelectionDiagnostic {
  candidateCount: number
  proposed: boolean
  willingness: number | null
  probability: number | null
  roll: number | null
  result: 'no-candidate' | 'invalid-asset' | 'missing-willingness' | 'not-selected' | 'selected' | 'unavailable'
}

export interface StickerSelectionEvaluation {
  asset?: StickerAsset
  diagnostic: StickerSelectionDiagnostic
}

/** Owns file-backed catalog lifecycle; accepted visible sends are logged by the host. */
export class StickerLibrary {
  readonly config: StickerLibraryConfig
  private stickerCatalog: StickerAsset[] = []
  private stickerById = new Map<string, StickerAsset>()
  private stickerScanRunning = false
  private stickerScanRequested = false

  constructor(private readonly options: StickerLibraryOptions) {
    const configured = options.config
    this.config = {
      enabled: configured?.enabled === true,
      directory: String(configured?.directory || 'data/hds-interlude/stickers').trim(),
      collectionMode: configured?.collectionMode === true || configured?.captureOneBotMarketFaces === true,
      scanIntervalMinutes: Math.max(5, Math.min(10_080, Math.floor(Number(configured?.scanIntervalMinutes) || 5))),
      maxFileSizeMB: Math.max(1, Math.min(30, Number(configured?.maxFileSizeMB) || 10)),
      catalogLimit: Math.max(1, Math.min(80, Math.floor(Number(configured?.catalogLimit) || 40))),
      descriptionBatchSize: Math.max(1, Math.min(80, Math.floor(Number(configured?.descriptionBatchSize) || 5))),
      descriptionResponseFormat: configured?.descriptionResponseFormat === 'prompt-only' ? 'prompt-only' : 'json-object',
    }
  }

  get size() { return this.stickerCatalog.length }

  resolveSticker(draft: LocalMediaDraft | undefined, catalog: StickerCatalogEntry[], seed: string, policy: { midpoint: number, maximum: number, minimum: number }) {
    return this.evaluateSticker(draft, catalog, seed, policy).asset
  }

  evaluateSticker(draft: LocalMediaDraft | undefined, catalog: StickerCatalogEntry[], seed: string, policy: { midpoint: number, maximum: number, minimum: number, selection?: ReturnType<typeof evaluateExpressionSelection> }): StickerSelectionEvaluation {
    // Keep diagnostics independent of material IDs, descriptions and paths.
    const diagnostic: StickerSelectionDiagnostic = {
      candidateCount: catalog.length,
      proposed: !!draft,
      willingness: typeof draft?.willingness === 'number' && Number.isFinite(draft.willingness) ? draft.willingness : null,
      probability: null,
      roll: null,
      result: 'no-candidate',
    }
    if (!draft) return { diagnostic }
    if (typeof draft.assetId !== 'string' || !catalog.some(item => item.assetId === draft.assetId)) {
      return { diagnostic: { ...diagnostic, result: 'invalid-asset' } }
    }
    if (diagnostic.willingness === null || diagnostic.willingness < 0 || diagnostic.willingness > 1) return { diagnostic: { ...diagnostic, result: 'missing-willingness' } }
    const selection = policy.selection ?? evaluateExpressionSelection(diagnostic.willingness, policy.midpoint, `${seed}:expression`, policy.maximum, policy.minimum)
    diagnostic.probability = selection.probability
    diagnostic.roll = selection.roll
    if (!selection.selected) return { diagnostic: { ...diagnostic, result: 'not-selected' } }
    const selected = this.stickerById.get(draft.assetId)
    if (!selected) return { diagnostic: { ...diagnostic, result: 'unavailable' } }
    const visibleAssets = catalog.map(item => this.stickerById.get(item.assetId)).filter((item): item is StickerAsset => !!item)
    return {
      asset: selectEquivalentStickerVariant(selected, visibleAssets),
      diagnostic: { ...diagnostic, result: 'selected' },
    }
  }

  async sendSticker(session: Session, channelId: string, asset: StickerAsset): Promise<boolean> {
    const root = resolve(this.options.baseDir, this.config.directory)
    const file = resolve(root, asset.filePath)
    if (!pathInsideRoot(root, file)) return false
    await session.bot.sendMessage(channelId, h('img', { src: pathToFileURL(file).href }))
    return true
  }

  async captureOneBotMarketStickers(session: Session): Promise<number> {
    const config = this.config
    if (!config.enabled || !config.collectionMode || !isStrictOneBotMarketCollectionEvent(session)) return 0
    const selfId = normalizeAccountId(session.selfId)
    const senderId = normalizeAccountId(session.userId)
    if (!selfId || selfId !== senderId || !isEnabledAccount(this.options.onebot?.botAccounts, selfId)) return 0
    const rawOneBotEvent = session.event._data as any
    const reportedTargetId = normalizeAccountId(rawOneBotEvent.target_id)
    if (reportedTargetId && reportedTargetId !== selfId && !isEnabledAccount(this.options.onebot?.userAccounts, reportedTargetId)) return 0

    // Only the provider-owned raw OneBot array is eligible in collection
    // mode. Adapted content is deliberately excluded so an ordinary Koishi
    // image element can never imitate a collection event.
    const observations = extractOneBotMarketStickerObservations('', rawOneBotEvent.message)
    if (!observations.length) return 0
    const root = resolve(this.options.baseDir, config.directory)
    let imported = 0
    for (const observation of observations) {
      try {
        const url = new URL(observation.url)
        if (!isStrictQQMarketStickerUrl(observation, url)) continue
        const response = await this.options.http('GET', url.href, {
          responseType: 'arraybuffer', timeout: MEDIA_IO_TIMEOUT, redirect: 'error',
        })
        const bytes = Buffer.from(response.data)
        if (!bytes.length || bytes.length > config.maxFileSizeMB * 1024 * 1024) continue
        const mimeType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || guessImageMime(bytes)
        const extension = stickerExtension(mimeType, url.pathname)
        const relativePath = `qq-market/${safeStickerPathSegment(observation.packageId)}/${safeStickerPathSegment(observation.emojiId)}${extension}`
        const file = resolve(root, relativePath)
        if (!pathInsideRoot(root, file)) continue
        await mkdir(dirname(file), { recursive: true })
        let unchanged = false
        try {
          const prior = await readFile(file)
          unchanged = prior.length > 0 && prior.equals(bytes)
        } catch { /* first import */ }
        if (!unchanged) {
          await writeFile(file, bytes)
          imported++
        }
        const semanticLabel = normalizeStickerSemanticHint(observation.summary)
        if (semanticLabel) await writeFile(`${file}.meta.json`, `${JSON.stringify({
          version: 1,
          provider: 'qq-market',
          packageId: observation.packageId,
          emojiId: observation.emojiId,
          semanticLabel,
        }, null, 2)}\n`, 'utf8')
      } catch (error) {
        this.options.log.reportStandaloneOperation('standard', 'warn', 'QQ 商城表情采集失败 表情=%s/%s 错误=%s', observation.packageId, observation.emojiId, error)
      }
    }
    if (imported) this.options.log.reportStandaloneOperation('standard', 'info', 'QQ 商城表情已导入 本次=%d 目录=qq-market', imported)
    // Also scan unchanged files: the image may exist after a previous crash
    // while its database row or visual description is still absent.
    this.options.setTimeout(() => void this.scanStickerLibrary(), 0)
    return observations.length
  }

  async scanStickerLibrary() {
    const config = this.config
    if (!config.enabled) return
    if (this.stickerScanRunning) {
      this.stickerScanRequested = true
      return
    }
    this.stickerScanRunning = true
    try {
      const root = resolve(this.options.baseDir, config.directory)
      const files = await listStickerFiles(root)
      const existing = await this.options.store.get({}) as StickerAsset[]
      const byPath = new Map(existing.map(item => [item.filePath, item]))
      const seen = new Set<string>()
      const pending: Array<{ asset: StickerAsset, bytes: Buffer, semanticHint: string }> = []
      for (const file of files) {
        const filePath = relative(root, file).replace(/\\/g, '/')
        if (!filePath || filePath.startsWith('../')) continue
        seen.add(filePath)
        try {
          const info = await stat(file)
          if (info.size > config.maxFileSizeMB * 1024 * 1024) continue
          const bytes = await readFile(file)
          const hash = createHash('sha256').update(bytes).digest('hex')
          const prior = byPath.get(filePath)
          const semanticHint = await readStickerSemanticHint(file)
          if (prior?.hash === hash && prior.status === 'active' && (!semanticHint || prior.aliases?.[0] === semanticHint)) continue
          const group = filePath.includes('/') ? filePath.split('/')[0] : 'default'
          const assetId = stableStickerAssetId(filePath, hash)
          const now = new Date()
          const base = {
            assetId, filePath, group: group.slice(0, 128), mimeType: stickerMime(filePath), animated: /\.gif$/i.test(filePath),
            size: bytes.length, hash, description: '', aliases: [], embedding: [], embeddingFingerprint: '', status: 'pending' as const, updatedAt: now,
          }
          const asset = prior
            ? await this.options.store.set({ id: prior.id }, base).then(() => ({ ...prior, ...base }))
            : await this.options.store.create({ ...base, createdAt: now }) as StickerAsset
          pending.push({ asset, bytes, semanticHint })
        } catch (error) {
          // A malformed file, old duplicate row, or transient SQLite write must
          // not starve the rest of the library for another five-minute cycle.
          this.options.log.reportStandaloneOperation('standard', 'warn', '表情包素材跳过 文件=%s 错误=%s', filePath, error)
        }
      }
      for (const asset of existing) {
        if (asset.status !== 'missing' && !seen.has(asset.filePath)) await this.options.store.set({ id: asset.id }, { status: 'missing', updatedAt: new Date() })
      }
      // File-backed assets are rebuildable. Keep a short diagnostic tail when
      // files disappear, but do not let renamed/deleted stickers accumulate
      // forever in the global (non-story) table.
      const missing = await this.options.store.get({ status: 'missing' }, { sort: { updatedAt: 'desc' } }) as StickerAsset[]
      const missingCutoff = Date.now() - 30 * Time.day
      const missingIds = missing
        .filter((asset, index) => index >= 500 || asset.updatedAt.getTime() < missingCutoff)
        .map(asset => asset.id)
      if (missingIds.length) await this.options.store.removeIds(missingIds)
      if (pending.length && !this.options.describer.available()) {
        this.options.log.reportStandalone('warn', '表情包库发现新素材，但没有配置 useForStickers 的视觉模型；已等待描述。')
      }
      const descriptionBatch = pending.slice(0, config.descriptionBatchSize)
      for (const item of descriptionBatch) {
        if (!this.options.describer.available()) break
        const visual = await this.options.imageBytesToNative(item.bytes, item.asset.mimeType)
        const description = visual && await this.options.describer.describeSticker(visual.dataUri, visual.mimeType, item.asset.filePath, item.asset.animated, config.descriptionResponseFormat, item.semanticHint)
        if (!description) continue
        const aliases = Array.from(new Set([item.semanticHint, ...description.aliases].map(alias => alias.trim()).filter(Boolean))).slice(0, 5)
        const updated = await this.options.store.set({ id: item.asset.id }, {
          description: description.description, aliases, status: 'active', updatedAt: new Date(),
        }) as StickerAsset | undefined
        if (updated && this.semanticStickerEmbeddingEnabled()) {
          // Index a freshly described asset immediately so the semantic filter
          // can consider it on the very next turn instead of the next scan.
          const embedding = await this.options.embedText(`${description.description} ${aliases.join(' ')}`.trim())
          if (embedding.length) await this.options.store.set({ id: item.asset.id }, {
            embedding, embeddingFingerprint: embeddingFingerprint(this.options.model, embedding.length), updatedAt: new Date(),
          })
        }
        this.options.log.reportStandaloneOperation('standard', 'info', '表情包描述完成 素材=%s 分组=%s', item.asset.assetId, item.asset.group)
      }
      if (pending.length > descriptionBatch.length && this.options.describer.available()) this.stickerScanRequested = true
      await this.refreshStickerCatalog()
      await this.backfillStickerEmbeddings()
      await this.refreshStickerCatalog()
    } catch (error) {
      this.options.log.reportStandalone('warn', '表情包库扫描失败：%s', error)
    } finally {
      this.stickerScanRunning = false
      if (this.stickerScanRequested) {
        this.stickerScanRequested = false
        this.options.setTimeout(() => void this.scanStickerLibrary(), 0)
      }
    }
  }

  async refreshStickerCatalog() {
    const rows = await this.options.store.get({ status: 'active' }, { sort: { updatedAt: 'desc' } }) as StickerAsset[]
    this.stickerCatalog = rows
    this.stickerById = new Map(rows.map(item => [item.assetId, item]))
  }

  semanticStickerEmbeddingEnabled() {
    return this.options.model.embedding?.semanticStickerFilter === true
  }

  async backfillStickerEmbeddings() {
    if (!this.semanticStickerEmbeddingEnabled()) return
    const pending = this.stickerCatalog
      .filter(asset => asset.description && !embeddingCompatible(asset.embedding, asset.embeddingFingerprint, embeddingFingerprintBase(this.options.model)))
      .slice(0, 8)
    for (const asset of pending) {
      const text = `${asset.description} ${(asset.aliases ?? []).join(' ')}`.trim()
      const embedding = await this.options.embedText(text)
      if (embedding.length) await this.options.store.set({ id: asset.id }, {
        embedding, embeddingFingerprint: embeddingFingerprint(this.options.model, embedding.length), updatedAt: new Date(),
      })
    }
  }

  async stickerCatalogForSession(session: Session | undefined, turnQueryEmbedding?: number[]): Promise<StickerCatalogEntry[]> {
    const config = this.config
    if (!config.enabled || !session || !isOneBotPlatform(session.platform)) return []
    const assets = await this.rankStickerAssets(turnQueryEmbedding)
    return assets.map(asset => ({
      assetId: asset.assetId, group: asset.group, description: asset.description, aliases: Array.isArray(asset.aliases) ? asset.aliases : [], animated: asset.animated,
    }))
  }

  async rankStickerAssets(turnQueryEmbedding?: number[]): Promise<StickerAsset[]> {
    const assets = this.stickerCatalog
    const promptLimit = this.config.catalogLimit
    if (!this.options.model.embedding?.semanticStickerFilter) return assets.slice(0, promptLimit)
    if (!turnQueryEmbedding?.length || assets.length <= SEMANTIC_STICKER_LIMIT) return assets.slice(0, promptLimit)
    const currentBase = embeddingFingerprintBase(this.options.model)
    const compatible = assets.map(asset => embeddingCompatible(asset.embedding, asset.embeddingFingerprint, currentBase, turnQueryEmbedding.length)
      ? asset : { ...asset, embedding: [] })
    return rankStickerCatalog(compatible, turnQueryEmbedding, Math.min(SEMANTIC_STICKER_LIMIT, promptLimit))
  }
}
