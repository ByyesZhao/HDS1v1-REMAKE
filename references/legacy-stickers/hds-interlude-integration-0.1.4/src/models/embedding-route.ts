import { configuredProviders, isAssignedTo, resolveModelTarget } from './config'
import type { ModelConfig, ProviderConfig } from './config'

/** Requests and vector identity must resolve the same normalized connection.
 * An explicit embedding URL may reuse credentials without a chat endpoint. */
export function resolveEmbeddingRoute(config: ModelConfig, providers = configuredProviders(config)):
  { provider: ProviderConfig; model: string; endpoint: string; identityEndpoint: string } | undefined {
  const embedding = config.embedding
  if (!embedding?.enabled) return undefined
  const assigned = providers.find(provider => provider.enabled && provider.endpoint && provider.model && isAssignedTo(provider, 'embedding'))
  if (!assigned && !embedding.modelId?.trim() && !embedding.model?.trim()) return undefined
  const target = resolveModelTarget(config, embedding.modelId, embedding.providerId, embedding.model)
  const enabled = providers.filter(provider => provider.enabled)
  const provider = assigned ?? (target.providerId?.trim()
    ? enabled.find(provider => provider.id === target.providerId) : enabled[0])
  const model = (assigned?.model || target.model).trim()
  if (!provider || !model) return undefined
  const explicitEndpoint = embedding.endpoint?.trim() ?? ''
  const endpoint = explicitEndpoint || deriveEmbeddingEndpoint(provider.endpoint)
  if (!endpoint) return undefined
  // Preserve existing valid v1 identities. The normalized chat URL uniquely
  // determines its derived embeddings URL; explicit URLs identify themselves.
  return { provider, model, endpoint, identityEndpoint: explicitEndpoint || provider.endpoint }
}

export function deriveEmbeddingEndpoint(chatEndpoint: string) {
  // Non-standard gateways need model.embedding.endpoint explicitly.
  const endpoint = chatEndpoint.trim()
  return /\/chat\/completions\/?(?:\?.*)?$/i.test(endpoint)
    ? endpoint.replace(/\/chat\/completions\/?(?:\?.*)?$/i, '/embeddings')
    : ''
}
