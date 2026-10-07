import { Context } from 'koishi'
import { NarrativeEmbedder } from '../types'
import { ProviderConfig, ModelConfig, configuredProviders } from './config'
import { parseObject } from './transport'
import { budgetedModelHttpClient, ModelHttpClient } from './http-client'
import { resolveEmbeddingRoute } from './embedding-route'

export interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>
}

export class SilentEmbedder implements NarrativeEmbedder {
  async embed(): Promise<number[]> { return [] }
}

export class OpenAICompatibleEmbedder implements NarrativeEmbedder {
  private readonly providers: ProviderConfig[]
  private readonly http: ModelHttpClient

  constructor(ctx: Context, private config: ModelConfig) {
    this.providers = configuredProviders(config)
    this.http = budgetedModelHttpClient(ctx.http)
  }

  async embed(input: string): Promise<number[]> {
    const route = resolveEmbeddingRoute(this.config, this.providers)
    if (!route) return []
    const embedding = this.config.embedding!
    const { provider, model, endpoint } = route

    const text = input.trim().slice(0, Math.max(1, embedding.maxInputCharacters))
    if (!text) return []
    const response = await this.http.post<EmbeddingResponse>(endpoint, {
      model,
      input: text,
      ...(embedding.dimensions > 0 ? { dimensions: embedding.dimensions } : {}),
    }, {
      headers: {
        'content-type': 'application/json',
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
        ...parseObject(provider.extraHeaders, 'extraHeaders'),
      },
      timeout: embedding.timeout,
    })
    const vector = response.data?.[0]?.embedding
    if (!Array.isArray(vector) || !vector.length || !vector.every(value => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error('Embedding provider returned an invalid vector.')
    }
    return vector
  }

}

export { deriveEmbeddingEndpoint } from './embedding-route'
