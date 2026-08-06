import { int, pick, hex, mulberry32, hashSeed, type Rng } from '@/core/rng'
import { orgName, person } from '@/content/generators/ident'
import type { MissionFacts } from '@/content/grammar'
import type { LayerId } from '@/core/state'
import { LAYER_ORDER } from '@/core/state'

/**
 * The contract board.
 *
 * Replaces the URL prompt (plan §16B). Pointing the game at a real site
 * never worked reliably -- it depended on public CORS relays that came and
 * went -- so targets are generated instead, a fresh dozen every time the
 * player returns to the dashboard.
 *
 * A contract is not just a name and a colour: it carries a JOB (plan §16J),
 * and the job decides what winning means. That is the structural fix for
 * "every run is the same shape" -- an EXFILTRATE job can complete at
 * INTRANET while a SABOTAGE job still needs the full descent, so short and
 * long contracts coexist.
 */
export type Sector = 'finance' | 'defense' | 'pharma' | 'energy' | 'gov' | 'media'

export type JobKind = 'exfiltrate' | 'sabotage'

export interface ContractJob {
  kind: JobKind
  /** What the player is actually after -- a filename, a record, a system. */
  artifact: string
  /** Shallowest layer at which the job can complete. SABOTAGE is always the full descent. */
  completesAt: LayerId
  /** One line shown as the standing objective. */
  brief: string
}

export interface Contract {
  id: string
  facts: MissionFacts
  sector: Sector
  /** 1-5. Drives threat frequency, counter-intrusion size, and reward. */
  tier: number
  /** Score multiplier, derived from tier. */
  reward: number
  /** One-line intel blurb shown on the board. */
  intel: string
  job: ContractJob
  brandColor: string
}

const SECTORS: readonly Sector[] = ['finance', 'defense', 'pharma', 'energy', 'gov', 'media']

const SECTOR_LABEL: Record<Sector, string> = {
  finance: 'FINANCIAL',
  defense: 'DEFENSE',
  pharma: 'PHARMA',
  energy: 'ENERGY',
  gov: 'GOVERNMENT',
  media: 'MEDIA',
}

const SECTOR_FILES: Record<Sector, readonly string[]> = {
  finance: ['wire_ledger.db', 'offshore_accts.sql', 'audit_2031.xlsx', 'swift_keys.pem'],
  defense: ['payload_specs.pdf', 'clearance_roll.db', 'sat_uplink.cfg', 'blacksite_manifest.csv'],
  pharma: ['trial_phase3.sql', 'compound_notes.tar', 'adverse_events.csv', 'patent_draft.docx'],
  energy: ['grid_topology.dwg', 'scada_creds.pem', 'turbine_logs.tar', 'reactor_setpoints.cfg'],
  gov: ['citizen_index.db', 'intercept_log.sql', 'asset_registry.csv', 'briefing_pack.pdf'],
  media: ['source_list.db', 'unaired_cut.mov', 'contract_terms.pdf', 'subscriber_dump.sql'],
}

const SECTOR_SABOTAGE: Record<Sector, readonly string[]> = {
  finance: ['the clearing house settlement run', 'the overnight batch processor'],
  defense: ['the perimeter sensor grid', 'the hangar door controllers'],
  pharma: ['the cold-chain freezer array', 'the clean-room pressure system'],
  energy: ['the substation breakers', 'the turbine governor'],
  gov: ['the building access control', 'the records archive HVAC'],
  media: ['the broadcast playout chain', 'the transmitter array'],
}

const INTEL_LINES: readonly string[] = [
  'Perimeter gear is two firmware generations behind.',
  'Half their SOC was laid off last quarter.',
  'Known to run an unpatched edge appliance.',
  'Aggressive blue team -- they hunt, they do not just watch.',
  'Recent breach made them paranoid. Expect canaries.',
  'Contractor VPN still trusts an expired CA.',
  'They mirror every session to cold storage.',
  'Night shift is one operator and a lot of coffee.',
  'Runs an EDR agent that phones home constantly.',
  'Legacy mainframe bridged to the corporate LAN.',
]

/** Deeper jobs are worth more; tier compounds it. */
function rewardFor(tier: number): number {
  return Math.round((1 + (tier - 1) * 0.55) * 100) / 100
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function makeJob(rng: Rng, sector: Sector, tier: number): ContractJob {
  // Higher tiers lean toward the full descent; low tiers are more often a
  // quick grab. This is what keeps run length varied across the board.
  const kind: JobKind = rng() < 0.35 + tier * 0.08 ? 'sabotage' : 'exfiltrate'

  if (kind === 'sabotage') {
    const system = pick(rng, SECTOR_SABOTAGE[sector])
    return {
      kind,
      artifact: system,
      completesAt: 'physical',
      brief: `Reach building control and trip ${system}.`,
    }
  }

  const artifact = pick(rng, SECTOR_FILES[sector])
  // An exfil job lives somewhere between the intranet and the kernel -- deep
  // enough to be a descent, shallow enough that not every run is six layers.
  const depthIdx = int(rng, 2, Math.min(4, 2 + tier))
  const completesAt = LAYER_ORDER[depthIdx] ?? 'core'
  return {
    kind,
    artifact,
    completesAt,
    brief: `Locate and exfiltrate ${artifact}.`,
  }
}

function makeContract(rng: Rng, index: number): Contract {
  const org = orgName(rng)
  const domain = `${slugify(org)}.${pick(rng, ['net', 'com', 'io', 'systems'] as const)}`
  const sector = pick(rng, SECTORS)
  const tier = int(rng, 1, 5)
  const subnet = `10.${int(rng, 10, 250)}.0.0/16`

  return {
    id: `c-${index}-${hex(rng, 3)}`,
    facts: { org, domain, subnet },
    sector,
    tier,
    reward: rewardFor(tier),
    intel: pick(rng, INTEL_LINES),
    job: makeJob(rng, sector, tier),
    brandColor: `hsl(${hashSeed(domain) % 360} 62% 55%)`,
  }
}

/** A fresh board. Called on every return to the dashboard, per the brief's "generated anew on every new start". */
export function generateContracts(seed: number, count = 12): Contract[] {
  const rng = mulberry32(seed)
  const out: Contract[] = []
  const usedStems = new Set<string>()
  let guard = 0
  while (out.length < count && guard < count * 30) {
    guard += 1
    const c = makeContract(rng, out.length)
    // Dedupe on the org's FIRST WORD, not the full name. orgName() builds
    // names from a prefix + suffix pool, so exact-name dedupe still let
    // "Halcyon Biotech", "Halcyon Industries" and "Halcyon Networks" share
    // one board -- which reads as a broken generator rather than as a
    // coincidence.
    const stem = (c.facts.org.split(/\s+/)[0] ?? c.facts.org).toLowerCase()
    if (usedStems.has(stem)) continue
    usedStems.add(stem)
    out.push(c)
  }
  return out
}

export function sectorLabel(sector: Sector): string {
  return SECTOR_LABEL[sector]
}

/** A named employee for dossier/intel flavour, stable per contract. */
export function contractContact(contract: Contract): string {
  const rng = mulberry32(hashSeed(contract.id))
  const p = person(rng)
  return `${p.given} ${p.surname}`
}
