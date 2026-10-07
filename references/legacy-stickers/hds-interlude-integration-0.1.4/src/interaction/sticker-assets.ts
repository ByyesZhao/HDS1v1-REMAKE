import { h } from 'koishi'
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { isOneBotPlatform, normalizeAccountId } from './onebot'

/** Number of descriptions injected after whole-library semantic ranking. */
export const SEMANTIC_STICKER_LIMIT = 12

export async function listStickerFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 3) return
    let entries: Awaited<ReturnType<typeof readdir>>
    try { entries = await readdir(directory, { withFileTypes: true }) as any } catch { return }
    for (const entry of entries as any[]) {
      const full = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(full, depth + 1)
      else if (entry.isFile() && /\.(?:png|jpe?g|webp|gif)$/i.test(entry.name)) files.push(full)
    }
  }
  await visit(root, 0)
  return files.sort()
}

export function stickerMime(filePath: string) {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  return 'image/png'
}

export interface OneBotMarketStickerObservation {
  packageId: string
  emojiId: string
  key: string
  summary: string
  url: string
}

export function normalizeStickerSemanticHint(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/^[\[【]+\s*/, '')
    .replace(/\s*[\]】]+$/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 32)
}

export async function readStickerSemanticHint(file: string) {
  try {
    const metadata = JSON.parse(await readFile(`${file}.meta.json`, 'utf8')) as Record<string, unknown>
    if (metadata.provider !== 'qq-market') return ''
    if (String(metadata.packageId ?? '') !== basename(dirname(file))) return ''
    if (String(metadata.emojiId ?? '').toLowerCase() !== basename(file, extname(file)).toLowerCase()) return ''
    return normalizeStickerSemanticHint(metadata.semanticLabel)
  } catch {
    return ''
  }
}

export function isStrictOneBotMarketCollectionEvent(session: any): boolean {
  if (!isOneBotPlatform(session?.platform)) return false
  const selfId = normalizeAccountId(session?.selfId)
  const senderId = normalizeAccountId(session?.userId)
  const raw = session?.event?._type === 'onebot' ? session.event._data : undefined
  if (!selfId || senderId !== selfId || !raw || typeof raw !== 'object') return false
  return raw.post_type === 'message_sent'
    && raw.message_sent_type === 'self'
    && raw.message_type === 'private'
    && normalizeAccountId(raw.self_id) === selfId
    && normalizeAccountId(raw.user_id) === selfId
    && Array.isArray(raw.message)
}

export function isStrictQQMarketStickerUrl(observation: OneBotMarketStickerObservation, url: URL): boolean {
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'gxh.vip.qq.com') return false
  if (!/^\d{1,20}$/.test(observation.packageId)) return false
  if (!/^[a-f0-9]{16,64}$/i.test(observation.emojiId) || !/^[a-f0-9]{8,128}$/i.test(observation.key)) return false
  const segments = url.pathname.split('/').filter(Boolean)
  return segments.length === 7
    && segments[0] === 'club'
    && segments[1] === 'item'
    && segments[2] === 'parcel'
    && segments[3] === 'item'
    && segments[5].toLowerCase() === observation.emojiId.toLowerCase()
    && /^raw\d*\.(?:gif|png|webp)$/i.test(segments[6])
}

export function extractOneBotMarketStickerObservations(content: unknown, sessionElements: any[] = []): OneBotMarketStickerObservation[] {
  const found: OneBotMarketStickerObservation[] = []
  const seen = new Set<string>()
  const pick = (record: Record<string, unknown>, ...keys: string[]) => {
    for (const key of keys) {
      const value = String(record[key] ?? '').trim()
      if (value) return value
    }
    return ''
  }
  const visit = (element: any) => {
    if (!element) return
    const type = String(element.type ?? '').toLowerCase()
    if (type === 'img' || type === 'image' || type === 'mface') {
      const attrs = { ...(element.data ?? {}), ...(element.attrs ?? {}) } as Record<string, unknown>
      const packageId = pick(attrs, 'emoji_package_id', 'emojiPackageId', 'package_id', 'packageId')
      const emojiId = pick(attrs, 'emoji_id', 'emojiId')
      const key = pick(attrs, 'key')
      const summary = pick(attrs, 'summary')
      const url = pick(attrs, 'src', 'url')
      const identity = `${packageId}:${emojiId}`
      if (packageId && emojiId && key && /^https:\/\//i.test(url) && !seen.has(identity)) {
        seen.add(identity)
        found.push({ packageId, emojiId, key, summary, url })
      }
    }
    for (const child of element.children ?? []) visit(child)
  }
  try { for (const element of h.parse(String(content ?? '')) as any[]) visit(element) } catch {}
  for (const element of sessionElements) visit(element)
  return found
}

export function safeStickerPathSegment(value: string) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96) || 'unknown'
}

export function stickerExtension(mimeType: string, pathname: string) {
  if (/gif/i.test(mimeType) || /\.gif$/i.test(pathname)) return '.gif'
  if (/webp/i.test(mimeType) || /\.webp$/i.test(pathname)) return '.webp'
  if (/jpe?g/i.test(mimeType) || /\.jpe?g$/i.test(pathname)) return '.jpg'
  return '.png'
}

export function pathInsideRoot(root: string, candidate: string) {
  const value = relative(root, candidate)
  return !!value && value !== '..' && !value.startsWith(`..${sep}`) && !value.includes(':')
}

export function stableStickerAssetId(filePath: string, hash: string) {
  const stem = String(filePath ?? '')
    .replace(/\\/g, '/')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')
    .slice(0, 220) || 'sticker'
  const suffix = String(hash ?? '').replace(/[^a-fA-F0-9]/g, '').slice(0, 16).toLowerCase() || 'unhashed'
  return `${stem}-${suffix}`.slice(0, 255)
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return undefined
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index]
    leftMagnitude += left[index] * left[index]
    rightMagnitude += right[index] * right[index]
  }
  if (!leftMagnitude || !rightMagnitude) return undefined
  return dot / Math.sqrt(leftMagnitude * rightMagnitude)
}

export function selectEquivalentStickerVariant<T extends { assetId: string, embedding?: number[] }>(
  selected: T,
  visibleAssets: T[],
  random: () => number = Math.random,
): T {
  if (!selected.embedding?.length) return selected
  const equivalents = visibleAssets.filter(asset =>
    asset.embedding?.length === selected.embedding?.length
    && (cosineSimilarity(selected.embedding!, asset.embedding) ?? -1) >= 0.94,
  )
  if (equivalents.length < 2) return selected
  const roll = Math.max(0, Math.min(0.999999999999, Number(random()) || 0))
  return equivalents[Math.floor(roll * equivalents.length)]
}

export function rankStickerCatalog<T extends { embedding?: number[] }>(assets: T[], queryEmbedding: number[], limit: number): T[] {
  if (!queryEmbedding.length || assets.length <= limit) return assets
  return assets
    .map(asset => ({ asset, score: cosineSimilarity(queryEmbedding, asset.embedding ?? []) ?? -1 }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit))
    .map(item => item.asset)
}
