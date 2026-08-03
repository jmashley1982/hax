import { hashSeed, int, mulberry32 } from '@/core/rng'
import type { MissionFacts } from '@/content/grammar'

/**
 * "Hack a real site": turns a URL the player types in into a MissionFacts
 * plus optional real page data, in tiers that degrade silently.
 *
 * Tier 0 (this file's `reconTierZero`) is pure string parsing -- no
 * network, cannot fail, always returns something usable immediately so
 * the run never blocks on a fetch. Tier 1 (`reconLive`) tries to pull the
 * real page (and its first stylesheet) through a chain of same-origin-safe
 * paths; if every attempt fails -- offline, the relay is down, the site
 * blocks embedding -- it resolves to the *same* tier-0 result with
 * `live: false`. Nothing downstream needs to know which tier it got:
 * MissionFacts.paths/hosts/fields/tech are simply absent, and every
 * grammar slot that reads them already falls back to the generic
 * generators (content/grammar.ts).
 */

export interface ReconResult {
  facts: MissionFacts
  live: boolean
  title?: string
  description?: string
  brandColor: string
  faviconUrl: string
  /** Sanitized body HTML for the TARGET window (populated only when live). */
  snapshotHtml?: string
  /** Roughly how much real text the snapshot has -- below the TARGET window's threshold, it renders a wireframe instead (real for JS-only SPA shells that serve an almost-empty body). */
  snapshotTextLength: number
  /** The actual resolved page URL -- becomes the TARGET window iframe's <base href> so relative asset/stylesheet paths in snapshotHtml resolve against the real site. */
  pageUrl?: string
  /** Absolute stylesheet URLs from the real page (up to a few) -- referenced directly via <link> in the TARGET window so the site's real CSS renders. Loading a stylesheet this way needs no CORS headers (only reading its rules via JS does, which is what dominantBrandColor's separate fetch is for). */
  stylesheetUrls: string[]
}

const CACHE_PREFIX = 'nullstack:recon:v1:'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 6000

// -- Tier 0: URL text only, no network, cannot fail ------------------------

function tryUrl(s: string): URL | null {
  try {
    return new URL(s)
  } catch {
    return null
  }
}

/**
 * Best-effort `new URL()` that also accepts a bare domain like
 * "netflix.com" or "netflix.com:8080".
 *
 * `new URL()` does NOT throw on input like "aperture-robotics.test:8931" --
 * it happily parses "aperture-robotics.test" as the URL *scheme* (the same
 * mechanism that makes "mailto:x" a valid URL) and "8931" as an opaque
 * path, which silently produces garbage instead of a real hostname. So a
 * successful parse is only trusted here if it's actually http(s); anything
 * else falls through to the https:// prefix retry same as a parse failure.
 */
function parseLoose(input: string): URL | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const direct = tryUrl(trimmed)
  if (direct && (direct.protocol === 'http:' || direct.protocol === 'https:')) return direct
  return tryUrl(`https://${trimmed}`) ?? direct
}

/** "sub.my-cool-site.co.uk" -> "my-cool-site" (strip www, common two-part TLDs, and the leading subdomain). */
function orgLabelFromHostname(hostname: string): string {
  const parts = hostname.replace(/^www\./, '').split('.').filter(Boolean)
  if (parts.length === 0) return 'unknown'
  const twoPartTld = parts.length >= 3 && (parts.at(-1)?.length ?? 0) <= 3 && (parts.at(-2)?.length ?? 0) <= 3
  const labelIdx = twoPartTld ? parts.length - 3 : parts.length - 2
  return parts[Math.max(0, labelIdx)] ?? parts[0]!
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

function pseudoBrandColor(domain: string): string {
  const hue = hashSeed(domain) % 360
  return `hsl(${hue} 68% 55%)`
}

/** Pure, synchronous, deterministic per domain -- same site always gets the same fictional network. */
export function reconTierZero(input: string): ReconResult {
  const url = parseLoose(input)
  const hostname = url?.hostname.replace(/^www\./, '') || input.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'unknown-target.net'
  const org = titleCaseFromSlug(orgLabelFromHostname(hostname)) || 'Unknown Target'

  const rng = mulberry32(hashSeed(hostname))
  const subnet = `10.${int(rng, 10, 250)}.0.0/16`

  return {
    facts: { org, domain: hostname, subnet },
    live: false,
    brandColor: pseudoBrandColor(hostname),
    faviconUrl: url ? `${url.origin}/favicon.ico` : `https://${hostname}/favicon.ico`,
    snapshotTextLength: 0,
    pageUrl: url?.toString(),
    stylesheetUrls: [],
  }
}

// -- Tier 1: real page data, via a relay chain, never throws ---------------

const RELAY_WRAPPERS: ReadonlyArray<(u: string) => string> = [
  (u) => u, // direct -- works when the target sends permissive CORS headers, or we're same-origin
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
]

async function fetchText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string | null> {
  for (const wrap of RELAY_WRAPPERS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(wrap(url), { signal: controller.signal, mode: 'cors' })
      clearTimeout(timer)
      if (!res.ok) continue
      const text = await res.text()
      if (text.length > 40) return text
    } catch {
      clearTimeout(timer)
      // This relay failed or timed out -- try the next one. Total silence
      // is the point: a player on a locked-down network should never see
      // an error, just a fictional-feeling target instead of a real one.
    }
  }
  return null
}

function resolveUrl(href: string | null, base: string): URL | null {
  if (!href) return null
  try {
    return new URL(href, base)
  } catch {
    return null
  }
}

interface ColorSample {
  r: number
  g: number
  b: number
}

function parseCssColor(token: string): ColorSample | null {
  const hex = token.match(/^#([0-9a-fA-F]{6})$/)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  const rgb = token.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
  return null
}

/** Most-frequent saturated, mid-luminance color in a stylesheet -- a cheap stand-in for "brand color" that doesn't need a real CSS parser. */
function dominantBrandColor(css: string): string | null {
  const tokens = css.match(/#[0-9a-fA-F]{6}\b|rgba?\([^)]+\)/g) ?? []
  const counts = new Map<string, number>()
  for (const t of tokens) {
    const rgb = parseCssColor(t)
    if (!rgb) continue
    const max = Math.max(rgb.r, rgb.g, rgb.b)
    const min = Math.min(rgb.r, rgb.g, rgb.b)
    const lum = (max + min) / 2 / 255
    const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))
    if (sat < 0.28 || lum < 0.12 || lum > 0.88) continue // skip grays/near-black/near-white
    const key = `${rgb.r},${rgb.g},${rgb.b}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      best = key
    }
  }
  if (!best) return null
  const [r, g, b] = best.split(',').map(Number)
  return `rgb(${r}, ${g}, ${b})`
}

const TECH_SIGNATURES: ReadonlyArray<readonly [RegExp, string]> = [
  [/_next\/static|\bnext\.js\b/i, 'next.js'],
  [/react(-dom)?[.-]/i, 'react'],
  [/wp-content|wp-includes/i, 'wordpress'],
  [/cdn\.shopify\.com|shopify/i, 'shopify'],
  [/squarespace/i, 'squarespace'],
  [/static\.wixstatic|wix\.com/i, 'wix'],
  [/cloudflare/i, 'cloudflare'],
  [/vue(\.global)?\.js/i, 'vue'],
  [/angular/i, 'angular'],
  [/jquery/i, 'jquery'],
]

/** Strip everything from a snapshot that could execute or navigate -- the TARGET window (R7-B) renders this with scripting disabled anyway, but this is the belt to that iframe sandbox's braces. */
function sanitizeSnapshot(doc: Document): string {
  const body = doc.body?.cloneNode(true) as HTMLElement | undefined
  if (!body) return ''
  body.querySelectorAll('script, iframe, object, embed, noscript').forEach((el) => el.remove())
  body.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name)
    }
    if (el.tagName === 'FORM') el.removeAttribute('action')
    if (el.tagName === 'A') el.setAttribute('href', 'javascript:void(0)')
  })
  return body.innerHTML.slice(0, 400_000)
}

async function enrichFromHtml(html: string, targetUrl: string, tierZero: ReconResult): Promise<ReconResult> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const base = new URL(targetUrl)

  const ogSiteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim()
  const title = doc.title?.trim() || undefined
  const description =
    doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ??
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim()

  const paths = new Set<string>()
  doc.querySelectorAll('a[href]').forEach((a) => {
    const u = resolveUrl(a.getAttribute('href'), targetUrl)
    if (u && u.hostname === base.hostname && u.pathname.length > 1) paths.add(u.pathname)
  })

  const hosts = new Set<string>()
  doc.querySelectorAll('script[src], img[src], link[href]').forEach((el) => {
    const u = resolveUrl(el.getAttribute('src') ?? el.getAttribute('href'), targetUrl)
    if (u && u.hostname !== base.hostname) hosts.add(u.hostname)
  })

  const fields = new Set<string>()
  doc.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
    const name = el.getAttribute('name')?.trim()
    if (name) fields.add(name)
  })

  const tech = new Set<string>()
  const generator = doc.querySelector('meta[name="generator"]')?.getAttribute('content')
  if (generator) tech.add(generator.split(' ')[0]!.toLowerCase())
  const scriptSrcs = Array.from(doc.querySelectorAll('script[src]')).map((s) => s.getAttribute('src') ?? '')
  for (const [re, label] of TECH_SIGNATURES) {
    if (scriptSrcs.some((s) => re.test(s)) || re.test(html.slice(0, 20_000))) tech.add(label)
  }

  const faviconHref = doc.querySelector('link[rel~="icon"]')?.getAttribute('href') ?? null
  const faviconUrl = resolveUrl(faviconHref, targetUrl)?.toString() ?? tierZero.faviconUrl

  let brandColor =
    doc.querySelector('meta[name="theme-color"]')?.getAttribute('content')?.trim() || tierZero.brandColor

  const stylesheetUrls = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
    .map((el) => resolveUrl(el.getAttribute('href'), targetUrl))
    .filter((u): u is URL => u !== null)
    .slice(0, 4)
    .map((u) => u.toString())

  if (stylesheetUrls[0]) {
    // Only fetched to sniff a dominant color (CSSOM reading needs the text
    // in hand); the TARGET window itself references stylesheetUrls
    // directly via <link>, which needs no CORS success at all -- browsers
    // don't gate *applying* an external stylesheet visually, only
    // programmatically reading its rules cross-origin.
    const css = await fetchText(stylesheetUrls[0], 4000)
    if (css) {
      const dominant = dominantBrandColor(css)
      if (dominant) brandColor = dominant
    }
  }

  const snapshotHtml = sanitizeSnapshot(doc)
  const bodyText = doc.body?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

  const facts: MissionFacts = {
    org: ogSiteName || tierZero.facts.org,
    domain: tierZero.facts.domain,
    subnet: tierZero.facts.subnet,
    paths: paths.size ? Array.from(paths).slice(0, 24) : undefined,
    hosts: hosts.size ? Array.from(hosts).slice(0, 10) : undefined,
    fields: fields.size ? Array.from(fields).slice(0, 12) : undefined,
    tech: tech.size ? Array.from(tech) : undefined,
  }

  return {
    facts,
    live: true,
    title,
    description,
    brandColor,
    faviconUrl,
    snapshotHtml,
    snapshotTextLength: bodyText.length,
    pageUrl: targetUrl,
    stylesheetUrls,
  }
}

function cacheKey(hostname: string): string {
  return `${CACHE_PREFIX}${hostname}`
}

function readCache(hostname: string): ReconResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(hostname))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt: number; result: ReconResult }
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) return null
    return parsed.result
  } catch {
    return null
  }
}

function writeCache(hostname: string, result: ReconResult): void {
  try {
    localStorage.setItem(cacheKey(hostname), JSON.stringify({ savedAt: Date.now(), result }))
  } catch {
    // Storage unavailable (private browsing, file://, quota) -- non-fatal, just means no cache next time.
  }
}

/**
 * Attempts to enrich a tier-0 result with real page data. Always resolves
 * (never rejects) -- on total failure it resolves to `tierZero` unchanged,
 * which is what "silently degrade, never block" means in practice: the
 * caller doesn't need a try/catch, it just gets back live:true or
 * live:false and proceeds identically either way.
 */
export async function reconLive(input: string, tierZero: ReconResult): Promise<ReconResult> {
  const url = parseLoose(input)
  if (!url) return tierZero

  const cached = readCache(tierZero.facts.domain)
  if (cached) return cached

  const html = await fetchText(url.toString())
  if (!html) return tierZero

  try {
    const result = await enrichFromHtml(html, url.toString(), tierZero)
    writeCache(tierZero.facts.domain, result)
    return result
  } catch {
    return tierZero
  }
}
