import type { BrowserConfig } from '../runtime/config'
import { isSafePublicWebUrl } from './web-observation'
import { parsePublicInformationFeed } from '../world-information/feed'

export interface VisibleWebPage {
  title: string
  text: string
  articleText?: string
  authenticationRequired?: boolean
  authenticationFormVisible?: boolean
  verificationRequired?: boolean
  /** Links observed on this page; the linked page's body has not been read. */
  links?: Array<{ title: string; url: string }>
  searchResultLinks?: Array<{ title: string; url: string }>
}

/** Evaluated as plain JavaScript, without module bindings or transpiler helpers.
 * In particular, serializing a TSX-loaded function can leave __name out of scope. */
export const READ_VISIBLE_WEB_PAGE_SCRIPT = String.raw`(() => {
  const visible = element => !!element.getClientRects().length
    && getComputedStyle(element).visibility !== 'hidden';
  const articles = Array.from(document.querySelectorAll('article, [role="article"]')).filter(visible);
  const article = articles.filter(element => !articles.some(parent => parent !== element && parent.contains(element)))
    .map(element => element.innerText.trim()).filter(Boolean).join('\n\n');
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog[open]'))
    .filter(visible).map(element => element.innerText).join('\n')
  const password = Array.from(document.querySelectorAll('input[type="password"], input[autocomplete="one-time-code"]')).some(visible);
  const title = String(document.title || '').trim();
  const text = String(document.body?.innerText || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const links = Array.from(document.querySelectorAll('a[href]')).filter(visible)
    .map(element => ({ title: String(element.innerText || '').trim().slice(0, 120), url: String(element.href || '') }))
    .filter(link => link.title && link.url).slice(0, 80);
  const searchResultLinks = Array.from(document.querySelectorAll('#b_results .b_algo h2 a, .result__a, #content_left h3 a')).filter(visible)
    .map(element => ({ title: String(element.innerText || '').trim().slice(0, 120), url: String(element.href || '') }))
    .filter(link => link.title && link.url).slice(0, 20);
  return {
    title, text, articleText: article, links, searchResultLinks,
    authenticationRequired: /扫码登录|登录后(?:查看|继续)|登录即可|sign in to continue|log in to continue/i.test(dialogs)
      || (password && !article),
    authenticationFormVisible: password,
    verificationRequired: /请完成(?:安全)?验证|拖动滑块|verify (?:that )?you are human|complete the security check/i.test(dialogs),
  };
})()`

/** Limited heuristics for common access shells, not a universal article parser.
 * Navigation alone is not evidence that article text was obtained. */
export function assessWebPage(page: VisibleWebPage, url: string, httpStatus: number | undefined, mode: 'visit' | 'search' = 'visit'):
  { status: 'success'; text: string } | { status: 'blocked' | 'failed'; reason: string } {
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
    return { status: 'blocked', reason: `页面访问受限（HTTP ${httpStatus}），未取得正文。` }
  }
  // A 304 may display the browser's cached representation, but still needs a
  // valid body below. Other final redirects/no-content responses prove no read.
  if (httpStatus !== undefined && (httpStatus < 200 || httpStatus >= 300 && httpStatus !== 304 || httpStatus === 204 || httpStatus === 205)) {
    return { status: 'failed', reason: `页面响应异常（HTTP ${httpStatus}），未取得正文。` }
  }
  const path = new URL(url).pathname
  const article = page.articleText?.trim()
  const text = article || page.text.trim()
  const authenticationTitle = /^(?:sign[ -]?in|log[ -]?in|login|登录|登陆|账号登录|用户登录)(?:$|\s*[-|—:：])/i.test(page.title.trim())
  const lines = text.split(/\n/).map(line => line.trim()).filter(Boolean)
  // Match an access instruction on its own line, not prose discussing login.
  const loginLine = lines.some(line => /^(?:请先?)?(?:(?:扫码)?登录(?:后|即可)(?:查看|继续|浏览|阅读)(?:全文|完整内容|内容|此页面|页面|阅读)?|扫码登录|(?:sign|log) in to (?:read|continue|view|access)(?: (?:the )?(?:full (?:article|content)|article|content|this page))?)[。.!！…\s]*$/i.test(line))
  if (page.authenticationRequired || /^\/(?:login|signin|sign-in|passport|auth)(?:\/|$)/i.test(path)
    || page.authenticationFormVisible && authenticationTitle
    || loginLine && (article ? text.length < 500 : text.length < 1500 || authenticationTitle)) {
    return { status: 'blocked', reason: '页面要求登录，未取得正文。' }
  }
  const verificationLine = lines.some(line => /^(?:请完成(?:安全)?验证|拖动滑块(?:完成验证)?|verify (?:that )?you are human|complete the security check)[。.!！…\s]*$/i.test(line))
  if (page.verificationRequired || verificationLine && text.length < 1500
    || /^(?:just a moment|attention required|security verification|安全验证|人机验证|访问验证)(?:[.!！。.\s|_-]|$)/i.test(page.title)) {
    return { status: 'blocked', reason: '页面要求访问验证，未取得正文。' }
  }
  if (!text || /^(?:loading[.。…]*|加载中[.。…]*|正在加载[.。…]*)$/i.test(text)) {
    return { status: 'failed', reason: '页面没有可提取的正文，可能尚未加载完成。' }
  }
  if (mode === 'search' && /(?:^|\.)(?:bing|duckduckgo)\.com$/i.test(new URL(url).hostname)
    && !page.searchResultLinks?.length && !/(?:没有找到|未找到|找不到|没有结果|no results|did not find any results|couldn't find any results)/i.test(text)) {
    return { status: 'failed', reason: '搜索结果未可见，只有导航或页面框架；未取得可读结果。' }
  }
  return { status: 'success', text }
}

/** The browser visibly renders Bing's public lightweight XML results. Reuse
 * the strict feed parser to project snippets without enabling feed collection
 * or reading a hidden HTML/result container. */
export function normalizeVisibleSearchPage(page: VisibleWebPage, url: string, mode: 'visit' | 'search', config: BrowserConfig): VisibleWebPage {
  const target = new URL(url)
  if (mode !== 'search' || !/(?:^|\.)bing\.com$/i.test(target.hostname) || target.searchParams.get('format') !== 'rss') return page
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(page.text)) throw new Error('搜索 XML 包含不支持的 DTD 或实体声明。')
  const start = page.text.indexOf('<rss')
  if (start < 0) return { ...page, text: '', articleText: '', links: [], searchResultLinks: [] }
  const xml = page.text.slice(start)
  const entries = parsePublicInformationFeed(xml, 1_000_000).filter(item => item.title.trim()
    && isSafePublicWebUrl(item.url, config)).slice(0, 20)
  const channelTitle = /<channel[^>]*>\s*<title>([^<]*)<\/title>/.exec(xml)?.[1]
  const title = page.title || channelTitle || `必应：${target.searchParams.get('q') ?? ''}`
  const text = entries.length ? entries.map((item, index) => `[结果${index + 1}，目标正文未读]\n${item.title.slice(0, 300)}\n${item.url}\n${item.summary.replace(/<[^>]*>/g, '').slice(0, 800)}`).join('\n\n')
    : '未找到搜索结果。'
  const links = entries.map(item => ({ title: item.title, url: item.url }))
  return { ...page, title, text, articleText: '', links, searchResultLinks: links }
}

/** Cached observations have no separate links column. Recover only the host's
 * saved result/link section, so old navigation shells do not become new reads. */
export function assessCachedWebPage(page: VisibleWebPage, url: string, mode: 'visit' | 'search', config: BrowserConfig) {
  const links: Array<{ title: string; url: string }> = []
  if (mode === 'search') {
    for (const match of page.text.matchAll(/\[结果\d+，目标正文未读\]\n([^\n]+)\n(https?:\/\/\S+)/g)) {
      links.push({ title: match[1], url: match[2] })
    }
    const marker = '\n\n页面中的链接（未阅读目标正文）：\n'
    const position = page.text.indexOf(marker)
    if (position >= 0) for (const match of page.text.slice(position + marker.length).matchAll(/([^\n]+): (https?:\/\/\S+)/g)) {
      links.push({ title: match[1], url: match[2] })
    }
  }
  return assessWebPage({ ...page, searchResultLinks: links.filter(link => isSafePublicWebUrl(link.url, config)) }, url, undefined, mode)
}

/** Some players request their audio/video chunks as XHR rather than media. */
export function isWebMediaRequest(url: string) {
  try {
    return /\.(?:mp4|m4s|m4a|mp3|webm|ogg|wav|flv|m3u8|mpd|ts)(?:$|[/?])/i.test(new URL(url).pathname)
  } catch { return false }
}

/** Preserve real public links inside the existing excerpt budget; they are not
 * evidence that the target pages were read. No new observation column is needed. */
export function webPageExcerpt(page: VisibleWebPage, text: string, pageUrl: string, config: BrowserConfig) {
  const maximum = config.maxExcerptCharacters
  const linkBudget = Math.min(900, Math.floor(maximum * 0.4))
  const seen = new Set<string>([pageUrl])
  let links = ''
  const candidates = page.searchResultLinks?.length ? page.searchResultLinks : page.links
  for (const item of Array.isArray(candidates) ? candidates : []) {
    if (typeof item?.url !== 'string' || typeof item.title !== 'string') continue
    let url: string
    try { const parsed = new URL(item.url, pageUrl); parsed.hash = ''; url = parsed.href } catch { continue }
    if (seen.has(url) || url.length > 600 || !isSafePublicWebUrl(url, config) || isWebMediaRequest(url)) continue
    seen.add(url)
    const title = item.title.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!title) continue
    const addition = `${title}: ${url}\n`
    if (links.length + addition.length > linkBudget) continue
    links += addition
  }
  const suffix = links ? `\n\n页面中的链接（未阅读目标正文）：\n${links.trim()}` : ''
  return text.slice(0, Math.max(0, maximum - suffix.length)) + suffix
}
