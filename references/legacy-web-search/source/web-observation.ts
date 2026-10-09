import type { BrowserConfig } from '../runtime/config'
import type {
  BrowserIntentDraft, NarrativeDecision, NativeWebSearchTrace, WebObservation,
  WebObservationKnowledgeScope, WebObservationSourceKind,
} from '../types'

const NATIVE_WEB_TRACE = Symbol('hds-interlude.native-web-trace')
const HOUR = 60 * 60 * 1_000

export function attachNativeWebSearchTrace(decision: NarrativeDecision, traces: NativeWebSearchTrace[]) {
  if (traces.length) Object.defineProperty(decision, NATIVE_WEB_TRACE, { value: traces, enumerable: false })
  return decision
}

export function nativeWebSearchTraceOf(decision: NarrativeDecision): NativeWebSearchTrace[] {
  return ((decision as any)[NATIVE_WEB_TRACE] ?? []) as NativeWebSearchTrace[]
}

/** Extract provider-authored tool actions and URL citations separately from
 * model-authored JSON. The caller persists them only after the decision wins
 * the stale-request check. */
export function extractNativeWebSearchTraces(response: unknown, outputText: string): NativeWebSearchTrace[] {
  if (!isRecord(response) || !Array.isArray(response.output)) return []
  const traces: NativeWebSearchTrace[] = []
  for (const item of response.output) {
    if (!isRecord(item)) continue
    if (item.type === 'web_search_call' && isRecord(item.action)) {
      const action = normalizeAction(item.action.type ?? item.action.action)
      const query = bounded(item.action.query ?? item.action.search_query, 500)
      const url = bounded(item.action.url, 2_000)
      if (action || query || url) traces.push({ kind: 'action', ...(action ? { action } : {}), ...(query ? { query } : {}), ...(url ? { url } : {}) })
    }
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (!isRecord(part) || !Array.isArray(part.annotations)) continue
      for (const annotation of part.annotations) {
        if (!isRecord(annotation)) continue
        const citation = isRecord(annotation.url_citation) ? annotation.url_citation : annotation
        const url = bounded(citation.url, 2_000)
        if (!url) continue
        const title = bounded(citation.title, 500)
        const start = finiteIndex(citation.start_index)
        const end = finiteIndex(citation.end_index)
        const excerpt = start !== undefined && end !== undefined && end > start
          ? bounded(outputText.slice(start, end), 2_000)
          : ''
        traces.push({ kind: 'citation', url, ...(title ? { title } : {}), ...(excerpt ? { excerpt } : {}) })
      }
    }
  }
  const unique = new Map<string, NativeWebSearchTrace>()
  for (const trace of traces) unique.set(`${trace.kind}|${trace.action ?? ''}|${trace.query ?? ''}|${trace.url ?? ''}`, trace)
  return [...unique.values()].slice(0, 20)
}

export function webObservationExpiry(
  sourceKind: WebObservationSourceKind,
  query: string,
  url: string,
  title: string,
  now: Date,
) {
  const clue = `${query} ${url} ${title}`.toLocaleLowerCase()
  const dynamic = /(天气|气温|降雨|空气质量|weather|forecast|temperature|today|今天|现在|实时)/i.test(clue)
  const eventLike = /(新闻|最新|活动|讲座|比赛|放假|校历|课程|通知|news|latest|event|schedule|calendar)/i.test(clue)
  const hours = dynamic ? 12 : eventLike ? 72 : sourceKind === 'sensor' ? 24 : 24 * 30
  return new Date(now.getTime() + hours * HOUR)
}

export function observationFreshAt(observation: WebObservation, now: Date) {
  const expiresAt = observation.expiresAt instanceof Date
    ? observation.expiresAt
    : observation.expiresAt ? new Date(String(observation.expiresAt)) : webObservationExpiry(
      observation.sourceKind || 'browser', observation.query, observation.url, observation.title, observation.accessedAt,
    )
  return Number.isFinite(expiresAt.getTime()) && expiresAt > now
}

export function normalizeObservationProvenance(observation: WebObservation): WebObservation {
  const sourceKind: WebObservationSourceKind = ['browser', 'native-search', 'sensor'].includes(observation.sourceKind)
    ? observation.sourceKind
    : 'browser'
  const knowledgeScope: WebObservationKnowledgeScope = ['narrator-world', 'protagonist-observed', 'participant-observed'].includes(observation.knowledgeScope)
    ? observation.knowledgeScope
    : 'protagonist-observed'
  const expiresAt = observation.expiresAt instanceof Date
    ? new Date(observation.expiresAt.getTime())
    : observation.expiresAt ? new Date(String(observation.expiresAt)) : webObservationExpiry(sourceKind, observation.query, observation.url, observation.title, observation.accessedAt)
  return { ...observation, sourceKind, knowledgeScope, expiresAt }
}

export function normalizeBrowserIntentDraftLoose(value: unknown): BrowserIntentDraft | undefined {
  if (!isRecord(value) || (value.mode !== 'search' && value.mode !== 'visit') || typeof value.purpose !== 'string') return undefined
  const query = bounded(value.query, 500)
  const url = bounded(value.url, 2_000)
  if (value.mode === 'search' && !query) return undefined
  if (value.mode === 'visit' && !url) return undefined
  return {
    mode: value.mode,
    ...(query ? { query } : {}), ...(url ? { url } : {}),
    purpose: bounded(value.purpose, 500),
    timing: value.timing === 'immediate' ? 'immediate' : 'deferred',
    ...(typeof value.participantId === 'string' ? { participantId: value.participantId.trim() } : {}),
  }
}

export function normalizeBrowserIntentDraft(draft: BrowserIntentDraft, config: BrowserConfig) {
  const normalized = normalizeBrowserIntentDraftLoose(draft)
  if (!normalized) return undefined
  if (normalized.mode === 'search' && !config.allowSearch) return undefined
  if (normalized.mode === 'visit' && !config.allowVisit) return undefined
  return normalized
}

export function browserIntentFromPayload(payload: Record<string, unknown>) {
  return normalizeBrowserIntentDraftLoose({
    mode: payload?.mode,
    query: payload?.query,
    url: payload?.url,
    purpose: payload?.purpose || 'The character planned to read a public web page.',
    timing: 'deferred',
  }) ?? null
}

export function resolveBrowserTarget(draft: BrowserIntentDraft, config: BrowserConfig) {
  if (draft.mode === 'search') {
    const template = config.searchUrlTemplate?.trim()
    if (!template || !template.includes('{query}')) return undefined
    const target = template.replaceAll('{query}', encodeURIComponent(draft.query ?? ''))
    return isSafePublicWebUrl(target, config) ? target : undefined
  }
  return draft.url && isSafePublicWebUrl(draft.url, config) ? draft.url : undefined
}

export function isSafePublicWebUrl(value: string, config: BrowserConfig) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    if (url.username || url.password) return false
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host === '::1' || isPrivateHost(host)) return false
    const blocked = normalizeDomains(config.blockedDomains)
    const allowed = normalizeDomains(config.allowedDomains)
    if (blocked.some(domain => domainMatches(host, domain))) return false
    return !allowed.length || allowed.some(domain => domainMatches(host, domain))
  } catch {
    return false
  }
}

export function webObservationEntryContent(observation: WebObservation) {
  if (observation.status === 'trace') return 'The narrator checked current public information without making it character knowledge.'
  if (observation.status === 'success') {
    const source = observation.title || observation.url || 'a public web page'
    return observation.knowledgeScope === 'narrator-world'
      ? `The narrator verified public world information from: ${source}.`
      : `The character read a public web page: ${source}.`
  }
  return `The character's attempted web lookup did not complete: ${bounded(observation.summary, 800)}`
}

function isPrivateHost(host: string) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168
  }
  return host.includes(':')
}

function normalizeDomains(values: string[] | undefined) {
  return (values ?? []).map(value => String(value ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')).filter(Boolean)
}

function domainMatches(host: string, domain: string) { return host === domain || host.endsWith(`.${domain}`) }

function normalizeAction(value: unknown): NativeWebSearchTrace['action'] | undefined {
  if (value === 'search' || value === 'open_page' || value === 'find_in_page') return value
  return undefined
}

function finiteIndex(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function bounded(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
