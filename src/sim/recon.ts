import { hashSeed, int, mulberry32 } from '@/core/rng'
import type { MissionFacts } from '@/content/grammar'

/**
 * Target dossiers.
 *
 * This file used to power "hack a real site": a URL the player typed was
 * parsed into MissionFacts (tier 0), then a relay chain tried to pull the
 * real page and its CSS (tier 1). The relays were free public CORS proxies
 * that were unreliable in practice, so the URL prompt was cut (plan §16B)
 * along with the entire fetch path -- the relay list, HTML sanitizer,
 * colour extraction and cache.
 *
 * What remains is the half that always worked and needs no network:
 * deterministic facts derived from a domain, and `dossierFor`, which turns
 * a generated contract into the shape the TARGET window already knows how
 * to render as a wireframe.
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
  /** Inline <style> blocks lifted from the real page. Many sites ship their critical/above-the-fold CSS inline in <head> rather than in an external file, and dropping it (as an earlier version did, by keeping only body.innerHTML) rendered those sites unstyled. */
  inlineStyles: string[]
}

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
    inlineStyles: [],
  }
}

/**
 * Build a TARGET-window dossier for a generated contract (plan §16B).
 *
 * The live-site path this file used to carry -- a public CORS relay chain,
 * an HTML snapshot and sanitizer, a localStorage cache -- is gone with the
 * URL prompt: it depended on third-party relays that came and went, which
 * is why it "never worked right". What survives is the useful half. The
 * TARGET window already renders a synthetic wireframe from org/paths/fields
 * whenever it has no live snapshot, so a contract feeds that directly and
 * the dossier keeps working with no network at all, forever.
 */
export function dossierFor(contract: {
  facts: MissionFacts
  brandColor: string
  job: { artifact: string }
}): ReconResult {
  const rng = mulberry32(hashSeed(contract.facts.domain))
  const paths = ['/', '/login', '/admin', '/api/v1', '/internal', '/exports']
    .slice(0, int(rng, 4, 6))
    .map((p) => p)
  return {
    facts: {
      ...contract.facts,
      // The wireframe reads these off `facts`, not off the result -- feeding
      // them at the top level renders an empty skeleton.
      paths,
      fields: ['username', 'password', 'otp'],
      hosts: [`www.${contract.facts.domain}`, `api.${contract.facts.domain}`],
    },
    live: false,
    title: contract.facts.org,
    description: `Internal systems -- ${contract.facts.domain}`,
    brandColor: contract.brandColor,
    faviconUrl: '',
    snapshotTextLength: 0,
    stylesheetUrls: [],
    inlineStyles: [],
  }
}
