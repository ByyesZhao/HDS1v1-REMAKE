import { stickerDescriptionMessages, imageObservationMessages } from '../narrative/visual-contracts'
import { Logger } from 'koishi'
import { NarrativeImage } from '../types'
import { ProviderResponseFormat, StickerDescription, ModelConfig, VisionDetail } from './config'
import { ChatCompletionResponse, withVisualAuxiliaryReasoning, parseJsonResponse, extractChatText, parseObject } from './transport'
import { TokenUsageRecord } from './token-usage'
import { ModelHttpClient } from './http-client'
import { ModelProviderRouter } from './provider-router'
import { TokenUsageReporter } from './usage-reporter'
import { requestModelResponse } from './task-request'

/** Transient current-image observations and reusable sticker descriptions. */
export class VisualModelClient {
  constructor(
    private http: ModelHttpClient,
    private config: ModelConfig,
    private router: ModelProviderRouter,
    private usage: TokenUsageReporter,
    private logger?: Logger,
  ) {}

  available() {
    return this.router.assignedProviders('stickers').length > 0
  }

  visionAvailable() {
    return this.router.assignedProviders('vision').length > 0
  }

  async describeSticker(dataUri: string, mimeType: string, fileName: string, animated: boolean, responseFormat: ProviderResponseFormat = 'json-object', semanticHint = ''): Promise<StickerDescription | undefined> {
    const provider = this.router.assignedProviders('stickers')[0]
    if (!provider || !dataUri) return undefined
    const requestBody = {
      ...parseObject(provider.extraBody, 'extraBody', this.logger),
      model: provider.model,
      temperature: 0.2,
      top_p: 1,
      max_tokens: this.config.vision?.stickerMaxTokens ?? 100_000,
      ...(responseFormat === 'json-object' ? { response_format: { type: 'json_object' } } : {}),
      messages: stickerDescriptionMessages(dataUri, mimeType, fileName, animated, provider.zhipuOfficial, semanticHint),
    }
    const headers = {
      'content-type': 'application/json',
      ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
      ...parseObject(provider.extraHeaders, 'extraHeaders', this.logger),
    }
    const usages: TokenUsageRecord[] = []
    const collect = (raw: unknown) => this.usage.collectUsage(usages, '贴纸描述', provider, provider.model, raw)
    try {
      const text = await (async () => {
        const response = await requestModelResponse(() => this.http.post<ChatCompletionResponse & { usage?: unknown }>(provider.endpoint, withVisualAuxiliaryReasoning(provider, requestBody, this.config.vision?.stickerReasoningEffort ?? 'high'), { headers, timeout: this.config.vision?.stickerTimeout ?? 300_000 }), collect)
        return extractChatText(response)
      })()
      if (!text) return undefined
      try {
        const parsed = parseJsonResponse<{ description?: unknown, aliases?: unknown }>(text, 'Sticker description provider')
        const description = typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 180) : ''
        const aliases = Array.isArray(parsed.aliases)
          ? Array.from(new Set(parsed.aliases.filter(item => typeof item === 'string').map(item => item.trim().slice(0, 32)).filter(Boolean))).slice(0, 5)
          : []
        return description ? { description, aliases } : undefined
      } catch {
        return undefined
      }
    } finally {
      this.usage.emitUsage('贴纸描述', usages)
    }
  }

  async describeImages(images: NarrativeImage[], userText = '', detail: VisionDetail = 'auto'): Promise<string[] | undefined> {
    const providers = this.router.assignedProviders('vision')
    if (!providers.length || !images.length) return undefined
    const usages: TokenUsageRecord[] = []
    const failures: string[] = []
    try {
      for (const provider of providers) {
        const requestBody = {
          ...parseObject(provider.extraBody, 'extraBody', this.logger),
          model: provider.model,
          temperature: 0.2,
          top_p: 1,
          max_tokens: this.config.vision?.sidecarMaxTokens ?? 100_000,
          messages: imageObservationMessages(images, userText, detail, provider.zhipuOfficial),
        }
        const headers = {
          'content-type': 'application/json',
          ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
          ...parseObject(provider.extraHeaders, 'extraHeaders', this.logger),
        }
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const response = await requestModelResponse(() => this.http.post<ChatCompletionResponse & { usage?: unknown }>(provider.endpoint, withVisualAuxiliaryReasoning(provider, { ...requestBody, stream: false }, this.config.vision?.sidecarReasoningEffort ?? 'high'), { headers, timeout: this.config.vision?.sidecarTimeout ?? 300_000 }),
              raw => this.usage.collectUsage(usages, '侧端识图', provider, provider.model, raw))
            const text = extractChatText(response).trim().slice(0, 3_000)
            if (text) return [text]
            failures.push(`${provider.label} attempt ${attempt}: empty response`)
          } catch (error) {
            failures.push(`${provider.label} attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
      if (failures.length) this.logger?.debug('侧端识图不可用：%s', failures.join(' | '))
      return undefined
    } finally {
      this.usage.emitUsage('侧端识图', usages)
    }
  }
}
