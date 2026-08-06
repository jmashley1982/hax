import { int, pick, mulberry32, hashSeed, type Rng } from '@/core/rng'
import { person } from '@/content/generators/ident'
import type { Contract, Sector } from '@/sim/contracts'

/**
 * The hard targets don't have a website. They have an org chart.
 *
 * A tier 4-5 contract is a defence integrator or a ministry, not a
 * consumer brand -- rendering it as a marketing homepage undersells what
 * you are breaking into. Those get a live entity graph instead: the org
 * at the centre, its subsidiaries, facilities, systems and named people
 * fanned out around it, with the edges drawn between them.
 *
 * Built as SVG rather than more boxes-and-borders CSS: the point of this
 * window is to be the one thing on screen that isn't a rectangle. Nodes
 * are laid out on rings with a deterministic per-domain jitter, so every
 * target's structure looks different but is stable across runs.
 *
 * SMIL animation (<animate>) rather than JS, because the TARGET iframe
 * runs with scripts disabled and always will -- that sandbox is the
 * safety guarantee, so anything that moves in here has to move without
 * script.
 */

interface NodeSpec {
  label: string
  kind: 'org' | 'sub' | 'site' | 'system' | 'person'
  x: number
  y: number
  r: number
}

const SUB_SUFFIX = ['Holdings', 'Systems', 'Labs', 'Logistics', 'Analytics', 'Ventures', 'Trust']

const SITES: Record<Sector, readonly string[]> = {
  finance: ['DATA CENTRE / FRANKFURT', 'VAULT / ZURICH', 'DR SITE / SINGAPORE', 'HQ / CANARY WHARF'],
  defense: ['PLANT 4 / PALMDALE', 'RANGE / WOOMERA', 'SCIF / ARLINGTON', 'DEPOT / RAMSTEIN'],
  pharma: ['GMP LINE 2 / BASEL', 'BIOBANK / LEIDEN', 'TRIAL HUB / DURHAM', 'COLD STORE / OSAKA'],
  energy: ['SUBSTATION 11', 'TURBINE HALL B', 'CONTROL ROOM / NORTH', 'SPENT FUEL POND'],
  gov: ['RECORDS ANNEX', 'IDENTITY CENTRE', 'REGIONAL OFFICE 7', 'ARCHIVE / DEEP STORE'],
  media: ['PLAYOUT / SOHO', 'TRANSMITTER / CRYSTAL PALACE', 'STUDIO 9', 'EDGE POP / ASHBURN'],
}

const SYSTEMS: Record<Sector, readonly string[]> = {
  finance: ['SWIFT GATEWAY', 'LEDGER CLUSTER', 'KYC STORE', 'HSM POOL'],
  defense: ['C2 FABRIC', 'ITAR ENCLAVE', 'TELEMETRY BUS', 'CREW SIM'],
  pharma: ['LIMS', 'TRIAL EDC', 'COMPOUND REGISTRY', 'COLD CHAIN SCADA'],
  energy: ['SCADA HISTORIAN', 'RTU MESH', 'MARKET BIDDING', 'BREAKER CONTROL'],
  gov: ['CITIZEN INDEX', 'BENEFITS ENGINE', 'INTERCEPT STORE', 'BADGE FEDERATION'],
  media: ['PLAYOUT AUTOMATION', 'RIGHTS DB', 'SUBSCRIBER CORE', 'INGEST FARM'],
}

const ROLES = ['CISO', 'CTO', 'HEAD OF SOC', 'FACILITIES LEAD', 'DIRECTOR, OPS']

function ringNodes(
  rng: Rng,
  labels: readonly string[],
  kind: NodeSpec['kind'],
  radius: number,
  startAngle: number,
  cx: number,
  cy: number,
  r: number,
): NodeSpec[] {
  const out: NodeSpec[] = []
  const step = (Math.PI * 2) / labels.length
  labels.forEach((label, i) => {
    // Per-node jitter keeps it from reading as a clock face while staying
    // deterministic for a given domain.
    const a = startAngle + i * step + (rng() - 0.5) * step * 0.45
    const rad = radius * (0.86 + rng() * 0.28)
    out.push({ label, kind, x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad * 0.78, r })
  })
  return out
}

export function buildEntityMapDoc(contract: Contract): string {
  const rng = mulberry32(hashSeed(contract.facts.domain) + 991)
  const brand = contract.brandColor
  const org = contract.facts.org
  const stem = org.split(/\s+/)[0] ?? org
  const sector = contract.sector

  const W = 460
  const H = 380
  const cx = W / 2
  const cy = H / 2

  const centre: NodeSpec = { label: org.toUpperCase(), kind: 'org', x: cx, y: cy, r: 30 }

  const subs = Array.from({ length: int(rng, 3, 4) }, () => `${stem} ${pick(rng, SUB_SUFFIX)}`)
  const sites = [...SITES[sector]].slice(0, int(rng, 3, 4))
  const systems = [...SYSTEMS[sector]].slice(0, int(rng, 3, 4))
  const people = Array.from({ length: 2 }, () => {
    const p = person(rng)
    return `${p.given[0]}. ${p.surname} -- ${pick(rng, ROLES)}`
  })

  const inner = ringNodes(rng, subs, 'sub', 88, -Math.PI / 2, cx, cy, 8)
  const mid = [
    ...ringNodes(rng, systems, 'system', 152, -Math.PI / 2 + 0.6, cx, cy, 6),
    ...ringNodes(rng, sites, 'site', 168, Math.PI / 2 + 0.3, cx, cy, 6),
  ]
  const outer = ringNodes(rng, people, 'person', 196, Math.PI * 0.15, cx, cy, 5)

  // Every mid/outer node hangs off a subsidiary, so the graph reads as a
  // structure rather than a starburst.
  const edges: Array<[NodeSpec, NodeSpec, number]> = []
  for (const n of inner) edges.push([centre, n, 1])
  for (const n of [...mid, ...outer]) {
    const parent = inner[int(rng, 0, inner.length - 1)] ?? centre
    edges.push([parent, n, 0.55])
  }

  const nodes = [centre, ...inner, ...mid, ...outer]

  const edgeSvg = edges
    .map(
      ([a, b], i) =>
        `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${brand}" stroke-opacity="${0.16 + 0.2 * (edges[i]?.[2] ?? 0.5)}" stroke-width="1"/>`,
    )
    .join('')

  // A packet travelling an edge, so the diagram is alive without script.
  const traffic = edges
    .filter((_, i) => i % 3 === 0)
    .slice(0, 6)
    .map(([a, b], i) => {
      const dur = (2.4 + i * 0.6).toFixed(1)
      return `<circle r="2" fill="${brand}">
        <animate attributeName="cx" values="${a.x.toFixed(1)};${b.x.toFixed(1)}" dur="${dur}s" repeatCount="indefinite"/>
        <animate attributeName="cy" values="${a.y.toFixed(1)};${b.y.toFixed(1)}" dur="${dur}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;1;1;0" dur="${dur}s" repeatCount="indefinite"/>
      </circle>`
    })
    .join('')

  const nodeSvg = nodes
    .map((n) => {
      const isOrg = n.kind === 'org'
      const fill = isOrg ? brand : 'none'
      const anchor = n.x < cx - 30 ? 'end' : n.x > cx + 30 ? 'start' : 'middle'
      const dx = anchor === 'end' ? -n.r - 5 : anchor === 'start' ? n.r + 5 : 0
      const dy = anchor === 'middle' ? (n.y < cy ? -n.r - 7 : n.r + 13) : 3.5
      const size = isOrg ? 11 : n.kind === 'sub' ? 8 : 7
      const opacity = isOrg ? 1 : n.kind === 'sub' ? 0.92 : 0.72
      const shape =
        n.kind === 'system'
          ? `<rect x="${(n.x - n.r).toFixed(1)}" y="${(n.y - n.r).toFixed(1)}" width="${n.r * 2}" height="${n.r * 2}" fill="${fill}" stroke="${brand}" stroke-width="1.5"/>`
          : n.kind === 'site'
            ? `<path d="M${n.x.toFixed(1)} ${(n.y - n.r).toFixed(1)} L${(n.x + n.r).toFixed(1)} ${n.y.toFixed(1)} L${n.x.toFixed(1)} ${(n.y + n.r).toFixed(1)} L${(n.x - n.r).toFixed(1)} ${n.y.toFixed(1)} Z" fill="${fill}" stroke="${brand}" stroke-width="1.5"/>`
            : `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r}" fill="${fill}" stroke="${brand}" stroke-width="${isOrg ? 2 : 1.5}"/>`
      const pulse = isOrg
        ? `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r}" fill="none" stroke="${brand}" stroke-width="1">
             <animate attributeName="r" values="${n.r};${n.r + 22}" dur="3.2s" repeatCount="indefinite"/>
             <animate attributeName="opacity" values="0.7;0" dur="3.2s" repeatCount="indefinite"/>
           </circle>`
        : ''
      return `${pulse}${shape}<text x="${(n.x + dx).toFixed(1)}" y="${(n.y + dy).toFixed(1)}" text-anchor="${anchor}" font-size="${size}" fill="${isOrg ? '#fff' : brand}" opacity="${opacity}" font-family="ui-monospace,Menlo,Consolas,monospace" letter-spacing="0.06em">${esc(n.label)}</text>`
    })
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#05070a;color:${brand};font:10px/1.4 ui-monospace,Menlo,Consolas,monospace;overflow:hidden}
    .hdr{display:flex;justify-content:space-between;padding:7px 10px;border-bottom:1px solid ${brand}44;letter-spacing:.14em;font-size:9px;opacity:.85}
    svg{display:block;width:100%;height:auto}
    .legend{display:flex;gap:12px;padding:6px 10px;border-top:1px solid ${brand}44;font-size:8px;letter-spacing:.1em;opacity:.7;flex-wrap:wrap}
    .legend i{font-style:normal;opacity:.9}
  </style></head><body>
    <div class="hdr"><span>ENTITY GRAPH :: ${esc(contract.facts.domain)}</span><span>TIER ${contract.tier} -- NO PUBLIC PRESENCE</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img">
      <g>${edgeSvg}</g>
      <g>${traffic}</g>
      <g>${nodeSvg}</g>
    </svg>
    <div class="legend"><i>&#9679; SUBSIDIARY</i><i>&#9632; SYSTEM</i><i>&#9670; FACILITY</i><i>&#9679; PERSONNEL</i></div>
  </body></html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Tier 4-5 targets are institutions, not brands -- they get the graph. */
export function usesEntityMap(contract: Contract): boolean {
  return contract.tier >= 4
}
