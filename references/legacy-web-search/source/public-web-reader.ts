import type { BrowserConfig } from '../runtime/config'
import type { BrowserIntentDraft, WebObservation } from '../types'
import { HDS_INTERLUDE_VERSION } from '../meta'
import { awaitWithAbortSignal } from '../models/request-context'
import { isSafePublicWebUrl, normalizeBrowserIntentDraft, resolveBrowserTarget } from './web-observation'
import { assessWebPage, isWebMediaRequest, normalizeVisibleSearchPage, READ_VISIBLE_WEB_PAGE_SCRIPT, webPageExcerpt, type VisibleWebPage } from './web-page'

export interface PublicWebPageResult {
  mode: 'search' | 'visit'
  query: string
  url: string
  title: string
  excerpt: string
  status: Exclude<WebObservation['status'], 'trace'>
  reason: string
}
export interface PublicWebReadOptions { signal: AbortSignal; timeoutMs: number }
export type PublicWebReader = (draft: BrowserIntentDraft, options: PublicWebReadOptions) => Promise<PublicWebPageResult>
export interface PublicWebReaderHost {
  config: BrowserConfig
  browser(): { page(): Promise<any> } | undefined
  withBrowserSlot<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>
}

/** Shared by all browser consumers. Reservations happen before waking a waiter. */
export class BrowserPageSlots {
  private active = 0
  private waiters: Array<() => void> = []
  constructor(private maximum: () => number) {}

  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        this.waiters = this.waiters.filter(waiter => waiter !== acquire)
        reject(signal?.reason ?? new Error('Browser slot cancelled.'))
      }
      const acquire = () => {
        signal?.removeEventListener('abort', abort)
        this.active++
        resolve()
      }
      if (this.active < Math.max(1, Math.floor(this.maximum()) || 1)) acquire()
      else {
        this.waiters.push(acquire)
        signal?.addEventListener('abort', abort, { once: true })
      }
    })
    try {
      signal?.throwIfAborted()
      return signal ? await awaitWithAbortSignal(signal, work) : await work()
    } finally {
      this.active--
      this.waiters.shift()?.()
    }
  }
}

/** Pure public-page port: never accesses story, character caches, or persistence. */
export async function readPublicWebPage(host: PublicWebReaderHost, draft: BrowserIntentDraft, options: PublicWebReadOptions): Promise<PublicWebPageResult> {
  options.signal.throwIfAborted()
  const { config } = host
  const normalized = normalizeBrowserIntentDraft(draft, config)
  const target = normalized && resolveBrowserTarget(normalized, config)
  const base: PublicWebPageResult = { mode: normalized?.mode ?? 'visit', query: normalized?.query ?? '',
    url: target ?? normalized?.url ?? '', title: '', excerpt: '', status: 'blocked', reason: '' }
  if (!normalized || !config.enabled || !target) return { ...base, reason: '浏览目标未通过公开网页安全校验或功能未启用。' }
  const browser = host.browser()
  if (!browser?.page) return { ...base, status: 'failed', reason: '浏览器服务不可用。' }

  const controller = new AbortController()
  const parentAbort = () => controller.abort(options.signal.reason)
  options.signal.addEventListener('abort', parentAbort, { once: true })
  const timeoutMs = Math.max(1, Math.min(60_000, Number(options.timeoutMs) || 60_000))
  const deadline = Date.now() + timeoutMs
  const expire = () => controller.abort(new Error(`Public page read timed out after ${timeoutMs}ms.`))
  const timer = setTimeout(expire, timeoutMs)
  const signal = controller.signal
  let page: any
  let closed = false
  const close = () => {
    if (!page || closed) return
    closed = true
    try { void Promise.resolve(page.close()).catch(() => undefined) } catch { /* Already closed/disconnected. */ }
  }
  const active = () => {
    if (Date.now() >= deadline && !signal.aborted) expire()
    signal.throwIfAborted()
  }
  const step = <T>(work: () => Promise<T>) => {
    active()
    return awaitWithAbortSignal(signal, work)
  }
  signal.addEventListener('abort', close, { once: true })
  try {
    return await step(() => host.withBrowserSlot(async () => {
      try {
        await step(async () => {
          page = await browser.page()
          // newPage itself is not cancellable; a late page must never navigate.
          if (signal.aborted) close()
          active()
        })
        await step(() => page.setUserAgent(`Mozilla/5.0 (compatible; HDS-Interlude/${HDS_INTERLUDE_VERSION}; +https://koishi.chat/)`))
        await step(() => page.setRequestInterception(true))
        active()
        page.on('request', (request: any) => {
          const resourceType = request.resourceType?.() ?? 'document'
          const requestUrl = request.url?.() ?? ''
          const allowed = !signal.aborted && ['document', 'stylesheet', 'script', 'xhr', 'fetch', 'image'].includes(resourceType)
            && !isWebMediaRequest(requestUrl) && isSafePublicWebUrl(requestUrl, config)
          try { void Promise.resolve(allowed ? request.continue() : request.abort('blocked')).catch(() => undefined) } catch { /* Page may already be closed. */ }
        })
        page.on('popup', (popup: any) => void Promise.resolve().then(() => popup.close()).catch(() => undefined))
        const response: any = await step(() => page.goto(target, { waitUntil: config.waitUntil,
          timeout: Math.max(1, Math.min(config.navigationTimeout, deadline - Date.now())) }))
        active()
        const finalUrl = String(page.url?.() ?? target)
        if (!isSafePublicWebUrl(finalUrl, config)) throw new Error('页面重定向到了不允许的地址。')
        const raw = await step<VisibleWebPage>(() => page.evaluate(READ_VISIBLE_WEB_PAGE_SCRIPT))
        active()
        const result = normalizeVisibleSearchPage(raw, finalUrl, normalized.mode, config)
        const assessment = assessWebPage(result, finalUrl, response?.status?.(), normalized.mode)
        const title = String(result?.title ?? '').slice(0, 500)
        if (assessment.status !== 'success') return { ...base, url: finalUrl, title, status: assessment.status, reason: assessment.reason }
        const excerpt = webPageExcerpt(result, assessment.text.slice(0, config.maxTextCharacters), finalUrl, config)
        return { ...base, url: finalUrl, title, excerpt, status: 'success' as const, reason: '' }
      } finally { close() }
    }, signal))
  } catch (error) {
    options.signal.throwIfAborted()
    return { ...base, status: 'failed', reason: `网页读取失败：${String(error instanceof Error ? error.message : error).slice(0, 500)}` }
  } finally {
    clearTimeout(timer)
    options.signal.removeEventListener('abort', parentAbort)
    signal.removeEventListener('abort', close)
    close()
  }
}
