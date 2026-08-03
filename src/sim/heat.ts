import type { GameState } from '@/core/state'

/**
 * The detection meter. Rises from risky actions (nonsense commands, IDS
 * ambient events), decays slowly on its own, and edge-triggers two
 * one-shot events per threshold crossing (warn, critical) rather than
 * firing every tick while above a threshold.
 *
 * By design there is no lose state here (plan §12, §13 -- "not strict"):
 * `critical` is meant to trigger a spectacular setback (a countermeasure
 * beat, a heat reset) in the caller, never a game over.
 */
const DECAY_PER_SEC = 1.4
const THRESHOLD_WARN = 55
const THRESHOLD_CRITICAL = 88
const HYSTERESIS = 15

export interface HeatEvents {
  warn: boolean
  critical: boolean
}

export class HeatSystem {
  private warnFired = false
  private criticalFired = false

  constructor(private state: GameState) {}

  add(amount: number): void {
    this.state.heat = clamp(this.state.heat + amount, 0, 100)
  }

  /** Used by the "you got burned" countermeasure beat -- a setback, not a loss. */
  resetAfterCountermeasure(to = 15): void {
    this.state.heat = to
    this.warnFired = false
    this.criticalFired = false
  }

  tick(dtMs: number): HeatEvents {
    this.state.heat = clamp(this.state.heat - (DECAY_PER_SEC * dtMs) / 1000, 0, 100)

    let warn = false
    let critical = false
    if (this.state.heat >= THRESHOLD_CRITICAL && !this.criticalFired) {
      this.criticalFired = true
      critical = true
    } else if (this.state.heat >= THRESHOLD_WARN && !this.warnFired) {
      this.warnFired = true
      warn = true
    }
    if (this.state.heat < THRESHOLD_WARN - HYSTERESIS) this.warnFired = false
    if (this.state.heat < THRESHOLD_CRITICAL - HYSTERESIS) this.criticalFired = false

    return { warn, critical }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
