import { Context, Session } from 'koishi'
import { readFile } from 'node:fs/promises'
import type { ModelConfig, VisionDescriber } from '../models/config'
import type { InterludeStory, NarrativeImage, NarrativeRequest } from '../types'
import type { VoiceTranscriptionConfig } from '../runtime/config'
import { clip, withTimeout } from '../shared/value'
import { isOneBotPlatform, oneBotMessageId } from './onebot'
import { describeVisionEvent, extractSessionVoiceCount, guessImageMime, isAnimatedImageMime, isTrustedImageHost, MEDIA_IO_TIMEOUT, mergeUserMessageWithVoiceTranscripts, shouldDownscaleImage } from './media-input'
import { readForwardContent, stripForwardControls } from './forward-message'
import { PUBLIC_PARAMETERS } from '../shared/public-parameters'

export interface InteractionLog {
  report(level: 'error' | 'warn' | 'info' | 'debug', story: InterludeStory, phase: NarrativeRequest['phase'], message: string, ...args: unknown[]): void
  reportOperation(verbosity: 'summary' | 'standard' | 'diagnostic', level: 'error' | 'warn' | 'info' | 'debug', story: InterludeStory, phase: NarrativeRequest['phase'], message: string, ...args: unknown[]): void
  reportStandalone(level: 'error' | 'warn' | 'info' | 'debug', message: string, ...args: unknown[]): void
  reportStandaloneOperation(verbosity: 'summary' | 'standard' | 'diagnostic', level: 'error' | 'warn' | 'info' | 'debug', message: string, ...args: unknown[]): void
}

export interface ConversationMediaOptions {
  model: ModelConfig
  voiceTranscription?: VoiceTranscriptionConfig
  http: Context['http']
  browser(): { page(): Promise<any> } | undefined
  withBrowserSlot<T>(callback: () => Promise<T>): Promise<T>
  visionDescriber: VisionDescriber
  log: InteractionLog
}

/** Transient transport resources have no access to story storage or scheduling. */
export class ConversationMedia {
  readonly voiceConfig: VoiceTranscriptionConfig

  constructor(private readonly options: ConversationMediaOptions) {
    const configured = options.voiceTranscription
    this.voiceConfig = {
      enabled: configured?.enabled === true,
      timeoutMs: Math.max(1_000, Math.min(600_000, Number(configured?.timeoutMs) || 300_000)),
    }
  }

  async describeUserEvent(story: InterludeStory, session: Session) {
    const visual = describeVisionEvent(session)
    const voice = await this.transcribeVoiceEvent(story, session)
    const forward = await readForwardContent(session)
    const { content: forwardContent, ...forwardMetadata } = forward ?? { content: '' }
    const ownContent = mergeUserMessageWithVoiceTranscripts(forward ? stripForwardControls(visual.content) : visual.content, voice.transcripts, voice.detected)
    const content = ownContent + (forwardContent ? `\n\n${forwardContent}` : '')
    return {
      content,
      forward: forward ? { ...forwardMetadata, quoteRange: { start: ownContent.length + 2, end: content.length } } : undefined,
      sources: visual.sources,
      voice: { detected: voice.detected, transcribed: voice.transcripts.length > 0, provider: voice.provider },
    }
  }

  async transcribeVoiceEvent(story: InterludeStory, session: Session) {
    const detected = extractSessionVoiceCount(session)
    const config = this.voiceConfig
    if (!detected || !config.enabled || !isOneBotPlatform(session.platform)) {
      return { detected, transcripts: [] as string[], provider: config.enabled ? 'unsupported' : 'disabled' }
    }
    const messageId = oneBotMessageId(session.messageId)
    const internal = (session as any).bot?.internal
    if (messageId == null || typeof internal?._request !== 'function') {
      this.options.log.reportOperation('diagnostic', 'warn', story, 'user-message', '语音转写跳过：当前 OneBot 适配器未提供 SnowLuma 原始动作通道')
      return { detected, transcripts: [] as string[], provider: 'unsupported' }
    }
    try {
      const response = await withTimeout(
        Promise.resolve(internal._request('fetch_ptt_text', { message_id: messageId })),
        config.timeoutMs,
      ) as any
      if (response?.retcode != null && Number(response.retcode) !== 0) throw new Error(String(response?.wording || response?.message || `retcode=${response.retcode}`))
      if (response?.status && response.status !== 'ok') throw new Error(String(response?.wording || response?.message || response.status))
      const data = response?.data ?? response
      const text = typeof data?.text === 'string' ? clip(data.text, 4_000) : ''
      if (!text) throw new Error('SnowLuma returned an empty transcription')
      return { detected, transcripts: [text], provider: 'snowluma' }
    } catch (error) {
      this.options.log.reportOperation('diagnostic', 'warn', story, 'user-message', '语音转写失败，已保留语音事实 错误=%s', error)
      return { detected, transcripts: [] as string[], provider: 'failed' }
    }
  }

  async loadNativeImages(story: InterludeStory, sources: string[], session?: Session): Promise<NarrativeImage[]> {
    if (!this.options.model.vision?.enabled || !sources.length) return []
    const images: NarrativeImage[] = []
    for (const [index, source] of sources.slice(0, 3).entries()) {
      try {
        const image = await this.fetchNativeImage(source, (session as any)?.bot)
        if (image) images.push({ id: `turn-image-${index + 1}`, ...image })
      } catch (error) {
        this.options.log.report('warn', story, 'user-message', '图片读取失败，已继续处理文字消息 错误=%s', error)
      }
    }
    return images
  }

  async describeCurrentImages(story: InterludeStory, images: NarrativeImage[], userMessage: string | undefined) {
    if (!images.length) return undefined
    if (!this.options.visionDescriber.available()) {
      this.options.log.reportOperation('diagnostic', 'warn', story, 'user-message', '侧端识图跳过：没有配置 useForVision 的视觉模型')
      return undefined
    }
    try {
      const observations = await this.options.visionDescriber.describeImages(images, userMessage, this.options.model.vision?.detail ?? 'auto')
      if (observations?.length) {
        this.options.log.reportOperation('diagnostic', 'debug', story, 'user-message', '侧端识图完成 图片=%d 观察=%d', images.length, observations.length)
      } else {
        this.options.log.reportOperation('diagnostic', 'warn', story, 'user-message', '侧端识图未返回内容，已继续处理文字消息')
      }
      return observations
    } catch (error) {
      this.options.log.reportOperation('diagnostic', 'warn', story, 'user-message', '侧端识图失败，已继续处理文字消息 错误=%s', error)
      return undefined
    }
  }

  async fetchNativeImage(source: string, bot?: any, adapterProvided = false): Promise<{ mimeType: string, dataUri: string } | undefined> {
    const value = String(source ?? '').trim()
    if (value.startsWith('onebot-url:')) {
      const url = value.slice('onebot-url:'.length)
      return this.fetchNativeImage(url, bot, true)
    }
    if (value.startsWith('onebot-file:')) {
      const file = value.slice('onebot-file:'.length)
      if (!file || !bot?.getImage) return undefined
      const info = await bot.getImage(file)
      const candidates = [info?.url, info?.file, info?.path].map(item => String(item ?? '').trim()).filter(Boolean)
      for (const candidate of candidates) {
        if (/^https?:\/\//i.test(candidate)) {
          const image = await this.fetchNativeImage(candidate, undefined, true)
          if (image) return image
        } else {
          try {
            const bytes = await readFile(candidate)
            const image = await this.imageBytesToNative(bytes, guessImageMime(bytes, info?.type))
            if (image) return image
          } catch { /* adapter may return a non-local alias; try its next field */ }
        }
      }
      return undefined
    }
    if (/^data:image\//i.test(value)) {
      const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value)
      if (!match) return undefined
      const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
      if (!bytes.length || bytes.length > PUBLIC_PARAMETERS.media.imageBytes.default) return undefined
      const mimeType = match[1].toLowerCase()
      return this.imageBytesToNative(bytes, mimeType)
    }
    let url: URL
    try { url = new URL(value) } catch { return undefined }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (!adapterProvided && !isTrustedImageHost(url.hostname)) return undefined
    const response = await this.options.http('GET', url.href, { responseType: 'arraybuffer', timeout: MEDIA_IO_TIMEOUT, redirect: 'error' })
    const bytes = Buffer.from(response.data)
    if (!bytes.length || bytes.length > PUBLIC_PARAMETERS.media.imageBytes.default) return undefined
    const mimeType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || guessImageMime(bytes)
    return this.imageBytesToNative(bytes, mimeType)
  }

  async imageBytesToNative(bytes: Buffer, mimeType: string): Promise<{ mimeType: string, dataUri: string } | undefined> {
    if (!bytes.length || bytes.length > PUBLIC_PARAMETERS.media.imageBytes.default) return undefined
    const normalized = String(mimeType || guessImageMime(bytes) || '').toLowerCase()
    if (!normalized.startsWith('image/')) return undefined
    const dataUri = `data:${normalized};base64,${bytes.toString('base64')}`
    if (isAnimatedImageMime(normalized)) {
      const frame = await this.renderAnimatedImageFrame(dataUri)
      if (frame) return frame
      this.options.log.reportStandalone('warn', '动态图片未能抽帧，已使用原始图片输入；请启用 Puppeteer 以提高识别兼容性。')
    }
    const scaled = await this.downscaleImageForVision({ mimeType: normalized, dataUri })
    return scaled ?? { mimeType: normalized, dataUri }
  }

  async downscaleImageForVision(image: { mimeType: string, dataUri: string }): Promise<{ mimeType: string, dataUri: string } | undefined> {
    const maxDimension = this.options.model.vision?.maxImageDimension ?? 0
    if (!maxDimension || !shouldDownscaleImage(image.mimeType, image.dataUri)) return undefined
    const puppeteer = this.options.browser()
    if (!puppeteer?.page) return undefined
    return this.options.withBrowserSlot(async () => {
      let page: any
      try {
        page = await puppeteer.page()
        await page.setViewport({ width: maxDimension, height: maxDimension, deviceScaleFactor: 1 })
        await page.setContent(`<img id="hdsi-vision" src="${image.dataUri}" style="display:block;max-width:${maxDimension}px;max-height:${maxDimension}px">`, { waitUntil: 'load', timeout: MEDIA_IO_TIMEOUT })
        await page.evaluate(() => new Promise<void>(resolve => {
          const imageElement = document.querySelector('#hdsi-vision') as HTMLImageElement | null
          if (!imageElement || imageElement.complete) return resolve()
          imageElement.addEventListener('load', () => resolve(), { once: true })
          imageElement.addEventListener('error', () => resolve(), { once: true })
        }))
        const element = await page.$('#hdsi-vision')
        if (!element) return undefined
        const buffer = Buffer.from(await element.screenshot({ type: 'jpeg', quality: 85 }))
        if (!buffer.length) return undefined
        const originalBytes = Buffer.from(image.dataUri.split(',')[1] ?? '', 'base64').length
        if (buffer.length >= originalBytes) return undefined
        this.options.log.reportStandaloneOperation('diagnostic', 'debug', '视觉图片已降采样 原始=%dB 降采样后=%dB 上限=%dpx', originalBytes, buffer.length, maxDimension)
        return { mimeType: 'image/jpeg', dataUri: `data:image/jpeg;base64,${buffer.toString('base64')}` }
      } catch (error) {
        this.options.log.reportStandalone('debug', '视觉图片降采样失败，已透传原图：%s', error)
        return undefined
      } finally {
        if (page) await page.close().catch(() => undefined)
      }
    })
  }

  async renderAnimatedImageFrame(dataUri: string) {
    const puppeteer = this.options.browser()
    if (!puppeteer?.page) return undefined
    return this.options.withBrowserSlot(async () => {
      let page: any
      try {
        page = await puppeteer.page()
        await page.setContent(`<img id="hdsi-image" src="${dataUri}" style="display:block;max-width:4096px;max-height:4096px">`, { waitUntil: 'load', timeout: MEDIA_IO_TIMEOUT })
        await page.evaluate(() => new Promise<void>(resolve => {
          const image = document.querySelector('#hdsi-image') as HTMLImageElement | null
          if (!image || image.complete) return resolve()
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => resolve(), { once: true })
        }))
        const element = await page.$('#hdsi-image')
        if (!element) return undefined
        const buffer = Buffer.from(await element.screenshot({ type: 'png' }))
        if (!buffer.length || buffer.length > PUBLIC_PARAMETERS.media.imageBytes.default) return undefined
        return { mimeType: 'image/png', dataUri: `data:image/png;base64,${buffer.toString('base64')}` }
      } catch (error) {
        this.options.log.reportStandalone('debug', '动态图片抽帧失败：%s', error)
        return undefined
      } finally {
        if (page) await page.close().catch(() => undefined)
      }
    })
  }
}
