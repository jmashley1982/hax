import { int, type Rng } from '@/core/rng'
import type { LayerId } from '@/core/state'

/**
 * Decides when the target pulls the plug on the player's terminal
 * (ui/lockout.ts).
 *
 * This is the rarest event in the game on purpose. Counter-intrusions are
 * frequent and survivable; a lockout stops everything and costs ~15
 * seconds of ceremony, so firing it often would be tedious rather than
 * dramatic. Hence a hard floor between occurrences and a grace period at
 * the start of a run -- a lockout in the first few seconds, before the
 * player has done anything, would read as the game being broken rather
 * than as retaliation.
 *
 * Odds rise with depth and heat, so it lands as a consequence of pushing
 * deep and getting noticed rather than as a random punishment.
 */
const LAYER_RISK: Record<LayerId, number> = {
  surface: 0,
  perimeter: 0.25,
  intranet: 0.45,
  core: 0.65,
  kernel: 0.85,
  physical: 1,
}

/**
 * No lockout at all before this -- the opening of a run must be clean.
 *
 * These numbers are tuned against the actual arrival rate, not by feel.
 * The first pass (70s grace, checks every 18-34s, ~0.15 per check) worked
 * out to roughly a coin flip on whether a player saw a lockout at all in
 * their first three minutes -- far too rare for something this central.
 * At the values below a check comes every ~17s from 45s onward at ~0.2-0.4
 * each, which puts the first lockout inside the first couple of minutes
 * around 90% of the time while MIN_GAP_MS still keeps them from stacking.
 */
const GRACE_MS = 45_000
/** Minimum gap between lockouts, regardless of how hot things get. */
const MIN_GAP_MS = 95_000

export class LockoutDirector {
  private nextCheckAt = GRACE_MS
  private lastFiredAt = 0

  constructor(private rng: Rng) {}

  /** Returns true exactly when a lockout should seize the screen. */
  tick(elapsedMs: number, heat: number, layer: LayerId, busy: boolean): boolean {
    if (elapsedMs < GRACE_MS) return false
    if (elapsedMs < this.nextCheckAt) return false
    // Never interrupt a threat wave or the finale -- stacking two
    // full-screen emergencies would just read as chaos, and it would steal
    // a wave the player was actively winning.
    if (busy) {
      this.nextCheckAt = elapsedMs + 4000
      return false
    }
    if (elapsedMs - this.lastFiredAt < MIN_GAP_MS) {
      this.nextCheckAt = elapsedMs + 8000
      return false
    }

    this.nextCheckAt = elapsedMs + int(this.rng, 12_000, 22_000)

    const risk = LAYER_RISK[layer]
    if (risk <= 0) return false
    const chance = Math.min(0.6, risk * 0.5 + (heat / 100) * 0.35)
    if (this.rng() > chance) return false

    this.lastFiredAt = elapsedMs
    return true
  }

  /**
   * Push the next check out by `delayMs` -- used after a lockout finishes
   * and when a fresh contract starts, so neither is immediately followed
   * by another blackout.
   *
   * Deliberately does NOT touch `lastFiredAt`: that marks a real lockout,
   * and MIN_GAP_MS is measured from it. An earlier version stamped it here
   * and re-armed the full session grace on every new contract -- and since
   * a whole contract runs about 45 seconds at speed, both timers were
   * being reset faster than they could ever elapse. The result was a
   * feature that could essentially never fire, which is exactly what the
   * arrival-rate testing turned up.
   */
  rearm(elapsedMs: number, delayMs: number): void {
    this.nextCheckAt = Math.max(this.nextCheckAt, elapsedMs + delayMs)
  }
}
