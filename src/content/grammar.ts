import { float, int, pad, weightedPick, type Rng } from '@/core/rng'
import * as netGen from './generators/net'
import * as hexGen from './generators/hex'

/**
 * The anti-repetition content engine (plan §4).
 *
 * A "bank" is a named set of template rules. `expand(bankId, ctx)` weighted-
 * picks a rule, recursively resolves any `{slot}` references inside it
 * against other banks or built-in generators, and returns plain text.
 *
 * Two things make this not visibly repeat over a long session:
 *   1. Recent-use suppression — each bank remembers the last K rules it
 *      picked and near-zeroes their weight until the pool cycles.
 *   2. Mission-scoped context (`ctx.facts`) — slots like {ip} or {host}
 *      resolve consistently within one target's fictional network instead
 *      of independently randomizing every time, which is what makes
 *      output read as *one coherent break-in* instead of noise.
 *
 * Phase 1 ships the engine + a couple of banks to prove it out end-to-end.
 * Phase 2 adds ~10 more banks, the full filler set, and a content-audit
 * script that samples tens of thousands of expansions to verify the
 * collision rate stays low — see plan §4 and §11.
 */

export interface Rule {
  /** Template string, e.g. '{ts}  scanning {cidr}' */
  t: string
  /** Relative weight, default 1 */
  w?: number
}

export type RuleLike = Rule | string
export type Bank = Record<string, RuleLike[]>

export interface MissionFacts {
  /** Fictional target organization/domain/subnet, pinning generated entities. */
  domain: string
  subnet: string
}

export interface GenContext {
  rng: Rng
  /** All registered banks, keyed by bank id (e.g. "netops"). */
  banks: Map<string, Bank>
  facts?: MissionFacts
}

const SLOT_RE = /\{([^{}]+)\}/g
const MAX_DEPTH = 10

interface RecentTracker {
  buf: number[]
  cap: number
}

const recentByKey = new Map<string, RecentTracker>()

function toRule(item: RuleLike): Rule {
  return typeof item === 'string' ? { t: item } : item
}

function pickRule(trackerKey: string, rules: readonly RuleLike[], rng: Rng): Rule {
  const normalized = rules.map(toRule)
  let tracker = recentByKey.get(trackerKey)
  if (!tracker) {
    tracker = { buf: [], cap: Math.max(1, Math.ceil(normalized.length / 2)) }
    recentByKey.set(trackerKey, tracker)
  }
  const weighted = normalized.map((r, i) => ({
    rule: r,
    w: tracker!.buf.includes(i) ? (r.w ?? 1) * 0.05 : (r.w ?? 1),
    idx: i,
  }))
  const chosen = weightedPick(rng, weighted)
  tracker.buf.push(chosen.idx)
  if (tracker.buf.length > tracker.cap) tracker.buf.shift()
  return chosen.rule
}

/** Expand a specific rule key within a bank into text, resolving all slots. */
export function expand(bankId: string, key: string, ctx: GenContext, depth = 0): string {
  if (depth > MAX_DEPTH) return '…'
  const bank = ctx.banks.get(bankId)
  const rules = bank?.[key]
  if (!rules || rules.length === 0) return `⟨${bankId}.${key}⟩`
  const rule = pickRule(`${bankId}.${key}`, rules, ctx.rng)
  return resolveSlots(rule.t, ctx, depth)
}

function resolveSlots(template: string, ctx: GenContext, depth: number): string {
  return template.replace(SLOT_RE, (_match, rawSlot: string) => {
    const [name, arg] = rawSlot.split(':') as [string, string | undefined]
    return resolveSlot(name!.trim(), arg, ctx, depth)
  })
}

function resolveSlot(name: string, arg: string | undefined, ctx: GenContext, depth: number): string {
  const { rng } = ctx

  // Built-in fillers with a numeric-range or length argument.
  if (name === 'int' && arg) {
    const [lo, hi] = arg.split('-').map(Number)
    return String(int(rng, lo ?? 0, hi ?? 100))
  }
  if (name === 'float' && arg) {
    const [lo, hi] = arg.split('-').map(Number)
    return String(float(rng, lo ?? 0, hi ?? 1))
  }
  if (name === 'hex' && arg) return hexGen.hex(rng, Number(arg))
  if (name === 'b64' && arg) return hexGen.b64(rng, Number(arg))

  // Built-in fillers with no argument.
  switch (name) {
    case 'ip':
      return ctx.facts ? netGen.ipInSubnet(rng, ctx.facts.subnet) : netGen.ip(rng)
    case 'ip2':
      return netGen.ip(rng)
    case 'mac':
      return netGen.mac(rng)
    case 'cidr':
      return ctx.facts?.subnet ?? netGen.cidr(rng)
    case 'host':
      return netGen.hostname(rng, ctx.facts?.domain)
    case 'port':
      return String(netGen.port(rng))
    case 'asn':
      return netGen.asn(rng)
    case 'uuid':
      return hexGen.uuid(rng)
    case 'sha':
      return hexGen.sha(rng)
    case 'ts':
      return timestamp(rng)
    default:
      break
  }

  // Otherwise: a reference to another bank.key, e.g. {netops.banner}.
  if (name.includes('.')) {
    const [refBank, refKey] = name.split('.') as [string, string]
    return expand(refBank, refKey, ctx, depth + 1)
  }

  // Bare name: search every registered bank for a matching key. This lets
  // small shared banks like "banner" or "relay" be referenced tersely from
  // any other bank without qualifying the bank id.
  for (const [bankId, bank] of ctx.banks) {
    if (bank[name]) return expand(bankId, name, ctx, depth + 1)
  }

  return `⟨${name}⟩`
}

function timestamp(rng: Rng): string {
  // Cosmetic — not wall-clock-derived, so output stays deterministic per
  // seed. Drifts forward pseudo-randomly to look like a live log.
  const h = int(rng, 0, 23)
  const m = int(rng, 0, 59)
  const s = int(rng, 0, 59)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}`
}

/** Registry so banks can be added without touching the engine. */
export class BankRegistry {
  private banks = new Map<string, Bank>()

  register(id: string, bank: Bank): void {
    this.banks.set(id, bank)
  }

  toMap(): Map<string, Bank> {
    return this.banks
  }
}
