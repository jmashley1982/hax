import type { GameState } from '@/core/state'

/**
 * INTEGRITY -- the player's own machine's security posture (plan §16C).
 *
 * This is the counterweight to heat, and the two together are the "tug of
 * war" the brief asks for:
 *
 *   HEAT      how much the target has noticed you.  Rises from noise.
 *   INTEGRITY how intact *you* are.                 Falls from mistakes.
 *
 * Crucially it regenerates during clean, active play, so "consistent game
 * play and action will keep it high" is literally what the code does --
 * and low integrity feeds back into the threat and lockout directors as an
 * extra risk term, so a bad patch compounds into a worse one while a good
 * stretch pulls you back out. That feedback loop is the oscillation; it is
 * not decoration on top of a linear difficulty curve.
 *
 * Unlike heat, this one CAN end a run (zero = workstation overrun), which
 * is the agreed shift to "tense but recoverable": individual task panels
 * stay easy, but the run as a whole can now be lost.
 */

/** Named costs, so the balance of the whole economy is legible in one place. */
export const INTEGRITY_COST = {
  corruptedFile: 25,
  wrongRoute: 20,
  lostWave: 15,
  lockout: 10,
  hostileExpired: 8,
  heatCritical: 5,
} as const

export const INTEGRITY_GAIN = {
  panelCleared: 2,
  waveRepelled: 8,
  correctRoute: 6,
  cleanExfil: 5,
} as const

/** Per second, and only while nothing hostile is on screen. */
const REGEN_PER_SEC = 0.9
const THRESHOLD_WARN = 55
const THRESHOLD_CRITICAL = 25
const HYSTERESIS = 10

export interface IntegrityEvents {
  warn: boolean
  critical: boolean
  overrun: boolean
}

export class IntegritySystem {
  private warnFired = false
  private criticalFired = false
  private overrunFired = false

  constructor(private state: GameState) {}

  get value(): number {
    return this.state.integrity
  }

  /** 0..1, how exposed the player currently is -- consumed by the threat directors. */
  get exposure(): number {
    return 1 - this.state.integrity / 100
  }

  damage(amount: number): void {
    this.state.integrity = clamp(this.state.integrity - amount, 0, 100)
  }

  repair(amount: number): void {
    this.state.integrity = clamp(this.state.integrity + amount, 0, 100)
  }

  /**
   * @param underPressure true while a wave / reverse-hack / lockout is live.
   *        Regen pauses then, so you cannot idle your way out of trouble --
   *        you have to actually clear the threat first.
   */
  tick(dtMs: number, underPressure: boolean): IntegrityEvents {
    if (!underPressure) this.repair((REGEN_PER_SEC * dtMs) / 1000)

    let warn = false
    let critical = false
    let overrun = false

    if (this.state.integrity <= 0 && !this.overrunFired) {
      this.overrunFired = true
      overrun = true
    } else if (this.state.integrity <= THRESHOLD_CRITICAL && !this.criticalFired) {
      this.criticalFired = true
      critical = true
    } else if (this.state.integrity <= THRESHOLD_WARN && !this.warnFired) {
      this.warnFired = true
      warn = true
    }

    // Re-arm once recovered, so a run that claws its way back can be warned
    // again if it slides a second time.
    if (this.state.integrity > THRESHOLD_WARN + HYSTERESIS) this.warnFired = false
    if (this.state.integrity > THRESHOLD_CRITICAL + HYSTERESIS) this.criticalFired = false

    return { warn, critical, overrun }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
