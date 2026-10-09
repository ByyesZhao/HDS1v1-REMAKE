import { h, Session } from 'koishi'
import { normalizeQQNativeFaceSegments } from './qq-face'
import { normalizeAttachmentText } from './attachment-text'
import { clip } from '../shared/value'

export const MEDIA_IO_TIMEOUT = 300_000

/** Current-message parsing deliberately ignores adapter-owned historical elements. */
export function describeVisionEvent(session: Session) {
  const raw = String(session.content ?? '')
  const sources = extractSessionImageSources(session)
  const content = normalizeAttachmentText(normalizeQQNativeFaceSegments(raw), 'incoming')
  return { content, sources }
}

export function isTrustedImageHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  const allowed = ['gchat.qpic.cn', 'c2cpicdw.qpic.cn', 'multimedia.nt.qq.com.cn', 'thirdqq.qlogo.cn', 'q.qlogo.cn', 'gxh.vip.qq.com']
  return allowed.some(domain => host === domain || host.endsWith(`.${domain}`))
}

export function extractSessionImageSources(session: Session) {
  // Remove native-face icon children before both tree traversal and fallback
  // scanning. Real adjacent images and market-sticker images stay available.
  const raw = normalizeQQNativeFaceSegments(session.content)
  const sources: string[] = []
  const add = (value: unknown, kind: 'url' | 'file' | 'adapter-url' = 'url') => {
    const source = String(value ?? '').trim()
    if (!source || sources.includes(source)) return
    if (source.length > 8 * 1024 * 1024) return
    if (/^https?:\/\//i.test(source)) sources.push(kind === 'adapter-url' ? `onebot-url:${source}` : source)
    else if (/^data:image\//i.test(source)) sources.push(source)
    else if (kind === 'file') sources.push(`onebot-file:${source}`)
  }
  const visit = (element: any) => {
    if (!element) return
    const type = String(element.type ?? '').toLowerCase()
    if (type === 'img' || type === 'image') {
      const src = element.attrs?.src ?? element.attrs?.url ?? element.data?.src ?? element.data?.url
      if (src) add(src)
      else add(element.attrs?.file ?? element.data?.file, 'file')
    }
    for (const child of element.children ?? []) visit(child)
  }
  // Session.elements is adapter-owned and can be reused or enriched by other
  // middleware. Parse this message's raw content only, otherwise an old image
  // element may be accidentally attached to a later text-only turn.
  try { for (const element of h.parse(raw) as any[]) visit(element) } catch {}
  if (!sources.length) {
    const pattern = /<(?:img|image)\b[^>]*(?:src|url)=["']([^"']+)["'][^>]*>/gi
    for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) add(match[1])
  }
  // OneBot/NapCat may leave a CQ image segment in the raw message instead of
  // converting it to an HTML image element. Prefer its CDN URL; if only the
  // file token is present, keep that token so the current bot can call
  // get_image(file) without trusting arbitrary user URLs.
  const cqPattern = /\[CQ:image,([^\]]+)\]/gi
  for (let match = cqPattern.exec(raw); match; match = cqPattern.exec(raw)) {
    const fields: Record<string, string> = {}
    for (const part of match[1].split(',')) {
      const index = part.indexOf('=')
      if (index > 0) fields[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim()
    }
    add(fields.url || fields.cache_url, 'adapter-url')
    if (!fields.url && !fields.cache_url) add(fields.file, 'file')
  }
  return sources
}

export function extractSessionVoiceCount(session: Pick<Session, 'content'>) {
  const raw = String(session.content ?? '')
  let count = 0
  const visit = (element: any) => {
    if (!element) return
    const type = String(element.type ?? '').toLowerCase()
    if (type === 'audio' || type === 'record') count++
    for (const child of element.children ?? []) visit(child)
  }
  try { for (const element of h.parse(raw) as any[]) visit(element) } catch {}
  if (count) return count
  return (raw.match(/\[CQ:record,[^\]]*\]/gi) ?? []).length
}

export function mergeUserMessageWithVoiceTranscripts(text: string, transcripts: string[], detected = 0) {
  const parts = [clip(text, 8_000)]
  for (const [index, transcript] of transcripts.slice(0, 1).entries()) {
    const value = clip(transcript, 4_000)
    if (value) parts.push(`[用户语音转写 ${index + 1}]\n${value}`)
  }
  if (detected > 0 && transcripts.length === 0) parts.push('[用户发送了一段语音；未能转写其内容。]')
  return parts.filter(Boolean).join('\n\n') || '[用户发送了一个非文本消息。]'
}

export function guessImageMime(bytes: Buffer, hinted?: unknown) {
  const hint = String(hinted ?? '').toLowerCase()
  if (hint.startsWith('image/')) return hint
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a')) return 'image/gif'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return ''
}

export function isAnimatedImageMime(mime: string) {
  return mime === 'image/gif' || mime === 'image/webp' || mime === 'image/apng'
}

export function shouldDownscaleImage(mimeType: string, dataUri: string): boolean {
  if (!/^image\/(?:jpeg|png|webp)$/i.test(mimeType)) return false
  const binaryLength = Math.floor((dataUri.split(',')[1] ?? '').length * 3 / 4)
  return binaryLength >= 150 * 1024
}
