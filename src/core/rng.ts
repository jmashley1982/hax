/**
 * Deterministic PRNG utilities.
 *
 * Every random draw in NULLSTACK must flow through an Rng instance created
 * here — never call `Math.random()` directly anywhere else in the codebase.
 * This is what lets a film crew reshoot a take with the same seed and get
 * byte-identical output (see scripts/seedCheck.ts), and it's what lets the
 * content grammar (src/content/grammar.ts) be audited for repetition.
 */

export type Rng = () => number

/**
 * mulberry32 — small, fast, statistically solid for this use case (cosmetic
 * randomness, not cryptography). Same seed -> same infinite stream of
 * floats in [0, 1).
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Derive a numeric seed from an arbitrary string (mission ids, session ids, etc). */
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Random integer in [min, max] inclusive. */
export function int(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

/** Random float in [min, max), fixed to `digits` decimal places. */
export function float(rng: Rng, min: number, max: number, digits = 1): number {
  const v = rng() * (max - min) + min
  const p = 10 ** digits
  return Math.round(v * p) / p
}

/** Pick a uniformly random element. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  const item = arr[int(rng, 0, arr.length - 1)]
  if (item === undefined) throw new Error('pick() called on empty array')
  return item
}

export interface WeightedItem {
  w?: number
}

/** Weighted pick. Items without an explicit weight default to 1. */
export function weightedPick<T extends WeightedItem>(rng: Rng, items: readonly T[]): T {
  const total = items.reduce((sum, it) => sum + (it.w ?? 1), 0)
  let roll = rng() * total
  for (const item of items) {
    roll -= item.w ?? 1
    if (roll <= 0) return item
  }
  const last = items[items.length - 1]
  if (last === undefined) throw new Error('weightedPick() called on empty array')
  return last
}

/** Fisher-Yates shuffle, seeded, non-mutating. */
export function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(rng, 0, i)
    const oi = out[i] as T
    const oj = out[j] as T
    out[i] = oj
    out[j] = oi
  }
  return out
}

/** Boolean with given probability of true (0..1). */
export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability
}

/** Random hex string of `len` characters (lowercase). */
export function hex(rng: Rng, len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) out += int(rng, 0, 15).toString(16)
  return out
}

/** Zero-padded number, e.g. pad(int(rng,0,9), 2) -> "07" */
export function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0')
}
