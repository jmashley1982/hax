import { int, pick, mulberry32, hashSeed } from '@/core/rng'
import type { Contract, Sector } from '@/sim/contracts'

/**
 * The target's public web presence, faked convincingly.
 *
 * The TARGET window used to render a wireframe with a badge reading
 * "LIVE RENDER UNAVAILABLE -- SYNTHESIZED FROM SITE METADATA" -- a
 * leftover from when the game tried to fetch real sites through public
 * CORS relays. That path is gone, so the badge was announcing a failure
 * that no longer exists, over a skeleton of grey boxes.
 *
 * This renders something that reads as an actual screenshot instead:
 * a corporate homepage with a wordmark, nav, hero headline, a "photo"
 * built from layered gradients, product cards, a stats strip and a
 * footer -- all in the target's brand colour, all written from its
 * sector. Deterministic per domain, so the same company always has the
 * same site.
 *
 * Everything is emitted as a self-contained document for the TARGET
 * window's sandboxed (no-scripts) iframe, which keeps the fake site's
 * styling from touching the app's.
 */

interface SectorCopy {
  /** Sits under the wordmark. */
  tagline: string
  /** The hero headline. */
  hero: string
  sub: string
  nav: readonly string[]
  cards: readonly [string, string][]
  stats: readonly [string, string][]
  /** Hue rotation applied to the hero "photo" so sectors look different. */
  imagery: 'towers' | 'lab' | 'grid' | 'vault' | 'civic' | 'studio'
}

const COPY: Record<Sector, SectorCopy> = {
  finance: {
    tagline: 'CAPITAL MARKETS INFRASTRUCTURE',
    hero: 'Settlement, without the wait.',
    sub: 'Clearing and custody for institutions that move before the market does.',
    nav: ['Platform', 'Clearing', 'Custody', 'Insights', 'Careers'],
    cards: [
      ['Real-time settlement', 'Positions net continuously instead of at end of day.'],
      ['Custody at scale', 'Segregated accounts across 40 jurisdictions.'],
      ['Risk telemetry', 'Exposure surfaced the moment it forms, not the morning after.'],
    ],
    stats: [['$4.1T', 'cleared annually'], ['40', 'jurisdictions'], ['99.995%', 'uptime']],
    imagery: 'towers',
  },
  defense: {
    tagline: 'MISSION SYSTEMS & INTEGRATION',
    hero: 'Decision advantage, delivered.',
    sub: 'Sensor-to-shooter integration for allied forces and their partners.',
    nav: ['Capabilities', 'Programs', 'Partners', 'Newsroom', 'Careers'],
    cards: [
      ['Integrated ISR', 'Multi-domain sensor fusion at the tactical edge.'],
      ['Assured comms', 'Resilient links that survive a contested spectrum.'],
      ['Sustainment', 'Depot and field support across four continents.'],
    ],
    stats: [['1,900', 'cleared staff'], ['4', 'continents'], ['ITAR', 'registered']],
    imagery: 'grid',
  },
  pharma: {
    tagline: 'CLINICAL DEVELOPMENT',
    hero: 'From molecule to patient.',
    sub: 'Late-stage development in immunology, oncology and rare disease.',
    nav: ['Science', 'Pipeline', 'Trials', 'Investors', 'Careers'],
    cards: [
      ['Pipeline', 'Eleven programs in Phase II and above.'],
      ['Trial network', '340 sites across 22 countries.'],
      ['Manufacturing', 'Two GMP facilities, cold chain end to end.'],
    ],
    stats: [['11', 'late-stage programs'], ['340', 'trial sites'], ['22', 'countries']],
    imagery: 'lab',
  },
  energy: {
    tagline: 'GENERATION & GRID SERVICES',
    hero: 'Keeping the lights on. Quietly.',
    sub: 'Baseload generation, transmission and grid balancing across three regions.',
    nav: ['Generation', 'Grid', 'Sustainability', 'Investors', 'Careers'],
    cards: [
      ['Baseload', '6.2 GW of dispatchable capacity.'],
      ['Balancing', 'Sub-second frequency response across the interconnect.'],
      ['Transition', 'Storage and renewables at utility scale.'],
    ],
    stats: [['6.2 GW', 'capacity'], ['3', 'regions'], ['11M', 'customers']],
    imagery: 'grid',
  },
  gov: {
    tagline: 'PUBLIC SERVICE DELIVERY',
    hero: 'Services that work, for everyone.',
    sub: 'Identity, records and benefits delivery for national and regional agencies.',
    nav: ['Services', 'Records', 'Accessibility', 'Transparency', 'Contact'],
    cards: [
      ['Digital identity', 'One verified identity across every service.'],
      ['Records', 'Statutory retention with full audit history.'],
      ['Benefits', 'Assessment and payment in a single flow.'],
    ],
    stats: [['31M', 'citizens served'], ['1974', 'established'], ['24/7', 'availability']],
    imagery: 'civic',
  },
  media: {
    tagline: 'BROADCAST & STREAMING',
    hero: 'Stories, everywhere at once.',
    sub: 'Originals, live news and distribution across 60 markets.',
    nav: ['Shows', 'News', 'Live', 'Press', 'Careers'],
    cards: [
      ['Originals', 'Forty commissions in production this year.'],
      ['Live', 'Twelve simultaneous live feeds, globally routed.'],
      ['Distribution', 'Direct-to-consumer plus 200 affiliate partners.'],
    ],
    stats: [['60', 'markets'], ['40', 'originals'], ['18M', 'subscribers']],
    imagery: 'studio',
  },
}

/** A wordmark glyph -- a simple geometric mark, so the site has a logo rather than just text. */
function markSvg(kind: number, color: string): string {
  const marks = [
    `<circle cx="14" cy="14" r="11" fill="none" stroke="${color}" stroke-width="4"/><circle cx="14" cy="14" r="3.5" fill="${color}"/>`,
    `<path d="M4 24 L14 4 L24 24 Z" fill="none" stroke="${color}" stroke-width="3.5"/>`,
    `<rect x="4" y="4" width="9" height="9" fill="${color}"/><rect x="15" y="4" width="9" height="9" fill="${color}" opacity=".55"/><rect x="4" y="15" width="9" height="9" fill="${color}" opacity=".55"/><rect x="15" y="15" width="9" height="9" fill="${color}"/>`,
    `<path d="M5 21 L14 5 L23 21" fill="none" stroke="${color}" stroke-width="3.5"/><path d="M9 21 L19 21" stroke="${color}" stroke-width="3.5"/>`,
    `<path d="M14 3 L25 9 V19 L14 25 L3 19 V9 Z" fill="none" stroke="${color}" stroke-width="3"/>`,
  ]
  return `<svg viewBox="0 0 28 28" width="26" height="26" aria-hidden="true">${marks[kind % marks.length]}</svg>`
}

/**
 * The hero "photograph".
 *
 * A real image would mean shipping stock photos for every generated org,
 * which is impossible. Layered gradients at a plausible photo aspect
 * ratio read as a corporate hero shot at a glance -- which is all the
 * window needs, since it lives at 320px wide behind CRT scanlines.
 */
function heroArt(imagery: SectorCopy['imagery'], color: string): string {
  const scenes: Record<SectorCopy['imagery'], string> = {
    towers: `linear-gradient(180deg,#0d1522 0%,#1b2a42 58%,#0a1017 100%),
             repeating-linear-gradient(90deg, rgba(255,255,255,.055) 0 6px, transparent 6px 22px)`,
    lab: `linear-gradient(180deg,#0f1a17 0%,#1d3a31 60%,#081210 100%),
          radial-gradient(60% 50% at 30% 40%, ${color}55, transparent 70%)`,
    grid: `linear-gradient(180deg,#101018 0%,#232338 62%,#08080d 100%),
           repeating-linear-gradient(115deg, rgba(255,255,255,.06) 0 2px, transparent 2px 16px)`,
    vault: `linear-gradient(180deg,#14110c 0%,#332a1b 60%,#0b0906 100%)`,
    civic: `linear-gradient(180deg,#0e131c 0%,#28313f 55%,#0a0d12 100%),
            repeating-linear-gradient(90deg, rgba(255,255,255,.07) 0 3px, transparent 3px 26px)`,
    studio: `linear-gradient(180deg,#170f16 0%,#3a1f36 58%,#0c070b 100%),
             radial-gradient(50% 60% at 70% 30%, ${color}66, transparent 72%)`,
  }
  return scenes[imagery]
}

export function buildFakeSiteDoc(contract: Contract): string {
  const rng = mulberry32(hashSeed(contract.facts.domain))
  const copy = COPY[contract.sector]
  const brand = contract.brandColor
  const org = contract.facts.org
  const year = int(rng, 1948, 2009)
  const mark = markSvg(int(rng, 0, 40), brand)
  const cta = pick(rng, ['Request a briefing', 'Talk to sales', 'See the platform', 'Partner with us'])

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{
      background:#fff;color:#12161c;
      font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
      -webkit-font-smoothing:antialiased;
    }
    .top{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid #e6e9ee}
    .brand{display:flex;align-items:center;gap:8px;flex:0 0 auto}
    .brand b{font-size:15px;letter-spacing:-.02em;white-space:nowrap}
    .nav{display:flex;gap:14px;font-size:11px;color:#5a636f;flex:1 1 auto;flex-wrap:wrap}
    .cta{flex:0 0 auto;background:${brand};color:#fff;font-size:11px;padding:6px 11px;border-radius:3px;white-space:nowrap}
    .hero{position:relative;height:190px;background-image:${heroArt(copy.imagery, brand)};background-blend-mode:normal;overflow:hidden}
    .hero:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.72) 0%,rgba(0,0,0,.15) 75%)}
    .hero-copy{position:absolute;z-index:2;left:20px;bottom:20px;right:20px;color:#fff}
    .kicker{font-size:9px;letter-spacing:.22em;color:${brand};margin-bottom:8px}
    h1{font-size:24px;line-height:1.15;letter-spacing:-.02em;margin-bottom:8px;font-weight:600}
    .sub{font-size:12px;color:#d7dce3;max-width:44ch}
    .cards{display:grid;grid-template-columns:1fr;gap:1px;background:#e6e9ee;border-bottom:1px solid #e6e9ee}
    .card{background:#fff;padding:14px 18px}
    .card h3{font-size:12px;margin-bottom:4px;letter-spacing:-.01em}
    .card p{font-size:11px;color:#5a636f}
    .card .rule{width:26px;height:2px;background:${brand};margin-bottom:9px}
    .stats{display:flex;gap:18px;padding:16px 18px;background:#f6f8fa;flex-wrap:wrap}
    .stat b{display:block;font-size:19px;color:${brand};letter-spacing:-.02em}
    .stat span{font-size:9px;letter-spacing:.12em;color:#6b7482;text-transform:uppercase}
    .foot{padding:14px 18px;font-size:10px;color:#8a939f;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .cookie{margin:0 18px 14px;padding:9px 11px;border:1px solid #e6e9ee;border-radius:3px;font-size:10px;color:#5a636f;display:flex;gap:10px;align-items:center}
    .cookie span{flex:1 1 auto}
    .cookie i{font-style:normal;background:${brand};color:#fff;padding:4px 9px;border-radius:2px;white-space:nowrap}
  </style></head><body>
    <div class="top">
      <div class="brand">${mark}<b>${esc(org)}</b></div>
      <div class="nav">${copy.nav.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
      <div class="cta">${esc(cta)}</div>
    </div>
    <div class="hero">
      <div class="hero-copy">
        <div class="kicker">${esc(copy.tagline)}</div>
        <h1>${esc(copy.hero)}</h1>
        <div class="sub">${esc(copy.sub)}</div>
      </div>
    </div>
    <div class="cards">
      ${copy.cards
        .map(
          ([h, p]) => `<div class="card"><div class="rule"></div><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`,
        )
        .join('')}
    </div>
    <div class="stats">
      ${copy.stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}
    </div>
    <div class="cookie"><span>We use cookies to understand how you use ${esc(org)}.</span><i>Accept all</i></div>
    <div class="foot">
      <span>&copy; ${esc(org)} ${year}&ndash;2031</span>
      <span>${esc(contract.facts.domain)}</span>
    </div>
  </body></html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
