import type { Rng } from '@/core/rng'
import { int, pick } from '@/core/rng'

/**
 * Earned power-ups.
 *
 * These are the payoff at the end of an interactive chain (ui/chain/chain.ts)
 * and of an ally's key drop. The point is that they are *earned by playing a
 * thing*, not handed out on a timer -- a chain is several minutes of side
 * work running alongside the main hack, and this is what it buys.
 *
 * Every token can be spent two ways, deliberately: click it in the HUD, or
 * type its code and press ENTER. The typed route is what makes it feel like
 * a command you learned rather than a button you were given.
 */

export type TokenKind = 'skeleton' | 'trojan'

export interface Token {
  id: string
  kind: TokenKind
  /** Shown on the HUD chip. */
  label: string
  /** Typed at the prompt to invoke it. Always uppercase, no spaces. */
  code: string
  /** One line explaining what spending it does. */
  effect: string
}

const SKELETON_STEMS = ['HALCYON', 'DRAGONFLY', 'NIGHTJAR', 'COLDIRON', 'PALEHORSE', 'BLACKSALT', 'MERIDIAN']
const TROJAN_STEMS = ['HOLLOWPOINT', 'GLASSCUT', 'SLIPSTREAM', 'DEADBOLT', 'FALSEDAWN']

export function makeToken(rng: Rng, kind: TokenKind): Token {
  const stem = pick(rng, kind === 'skeleton' ? SKELETON_STEMS : TROJAN_STEMS)
  const code = `${stem}-${int(rng, 2, 97)}`
  return kind === 'skeleton'
    ? {
        id: `tok-${code}`,
        kind,
        label: 'SKELETON KEY',
        code,
        effect: 'burns through every lock on this layer and drops you straight to the next one',
      }
    : {
        id: `tok-${code}`,
        kind,
        label: 'TROJAN BYPASS',
        code,
        effect: 'pushes a trojan through their controls -- security drops and you move fast for a while',
      }
}

/**
 * The player's held tokens.
 *
 * Capped deliberately low: a stockpile of skeleton keys would let a player
 * skip the entire game, and the tension of "do I spend it now or save it"
 * only exists when holding one has a cost.
 */
const MAX_HELD = 2

export class TokenPouch {
  private held: Token[] = []
  private listeners: Array<() => void> = []

  onChange(fn: () => void): void {
    this.listeners.push(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  get all(): readonly Token[] {
    return this.held
  }

  /** Returns false when the pouch is full, so the caller can say so rather than silently dropping it. */
  add(token: Token): boolean {
    if (this.held.length >= MAX_HELD) return false
    this.held.push(token)
    this.emit()
    return true
  }

  /** Consume by id (HUD click). */
  take(id: string): Token | null {
    const i = this.held.findIndex((t) => t.id === id)
    if (i < 0) return null
    const [t] = this.held.splice(i, 1)
    this.emit()
    return t ?? null
  }

  /**
   * Consume by typed code, case-insensitively and ignoring the separator --
   * "halcyon 7", "HALCYON-7" and "halcyon7" all spend the same token,
   * because failing to invoke a token you earned over three windows because
   * of a hyphen would be miserable.
   */
  takeByCode(raw: string): Token | null {
    const norm = raw.replace(/[^a-z0-9]/gi, '').toUpperCase()
    if (!norm) return null
    const i = this.held.findIndex((t) => t.code.replace(/[^a-z0-9]/gi, '').toUpperCase() === norm)
    if (i < 0) return null
    const [t] = this.held.splice(i, 1)
    this.emit()
    return t ?? null
  }

  clear(): void {
    this.held = []
    this.emit()
  }
}
