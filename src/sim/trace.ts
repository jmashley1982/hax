import type { GameState } from '@/core/state'

/**
 * TRACE -- the run-level pursuit meter (the "real danger" the brief asked
 * for: exhilaration needs an ending that can actually happen to you).
 *
 * Heat (sim/heat.ts) is weather: it rises with noise, decays on its own
 * every second, and never ends a run by itself -- it asks "how loud are
 * you RIGHT NOW". Integrity is the counterweight to that, and it too
 * regenerates in clean play. Trace is neither. It NEVER decays on its
 * own -- it only rises from mistakes and falls from things you actually
 * earned (a breakthrough, a won manhunt, a spent purge token) -- and it
 * persists across the whole run. It answers a different question: "how
 * much of a case do they have on you by now". Once that case is
 * complete, at 100, the run is over -- in CASUAL and DEEP alike. INFINITE
 * HACK has no ending to reach, so there it rolls you onto a fresh target
 * instead of closing the session.
 */
export const TRACE_GAIN = {
  gateFailed: 12,
  threatWaveLost: 7,
  lockout: 6,
  reverseHackLanded: 5,
} as const

export const TRACE_RELIEF = {
  breakthrough: 6,
  manhuntWon: 10,
  tokenPurge: 15,
} as const

/** Continuous sources, applied per second in `tick`. */
const HEAT_PIN_THRESHOLD = 85
const HEAT_PIN_RATE_PER_SEC = 0.4
const IDLE_BLEED_RATE_PER_SEC = 0.3

const THRESHOLDS = [50, 75, 90, 100] as const
export type TraceThreshold = (typeof THRESHOLDS)[number]

export interface TraceEvents {
  /** Any thresholds newly crossed this tick, in ascending order. */
  crossed: TraceThreshold[]
}

export class TraceSystem {
  private fired = new Set<TraceThreshold>()
  /** From the play mode's `traceRate` -- scales every gain, not the value itself. */
  private rate = 1

  constructor(private state: GameState) {
    // Guards a save/state shape written before this field existed, same
    // rule core/state.ts already applies to soundOn and filmMode.
    if (typeof this.state.trace !== 'number' || !Number.isFinite(this.state.trace)) {
      this.state.trace = 0
    }
  }

  setRate(rate: number): void {
    this.rate = rate
  }

  get value(): number {
    return this.state.trace
  }

  add(amount: number): void {
    this.state.trace = clamp(this.state.trace + amount * this.rate, 0, 100)
  }

  /** Earned relief -- not scaled by `rate`, so clawing back is the same size everywhere. */
  relieve(amount: number): void {
    this.state.trace = clamp(this.state.trace - amount, 0, 100)
  }

  /**
   * @param heat Current heat value -- pinned-hot is itself a trace source.
   * @param idleBleeding DEEP HACK's standing-still penalty is already
   *   damaging integrity elsewhere (shell.tickIdlePressure); while it is
   *   active, trace climbs too, on the theory that the thing giving away
   *   your position is exactly the thing that stopped moving.
   */
  tick(dtMs: number, heat: number, idleBleeding: boolean): TraceEvents {
    if (heat > HEAT_PIN_THRESHOLD) this.add((HEAT_PIN_RATE_PER_SEC * dtMs) / 1000)
    if (idleBleeding) this.add((IDLE_BLEED_RATE_PER_SEC * dtMs) / 1000)

    const crossed: TraceThreshold[] = []
    for (const t of THRESHOLDS) {
      if (this.state.trace >= t && !this.fired.has(t)) {
        this.fired.add(t)
        crossed.push(t)
      }
    }
    // Re-arm once clawed all the way back under the lowest rung, so a run
    // that genuinely turns itself around (a manhunt won, a couple of
    // purges) can climb and warn again rather than being permanently
    // "already warned" for the rest of the contract.
    if (this.state.trace < THRESHOLDS[0]) this.fired.clear()
    return { crossed }
  }

  reset(): void {
    this.state.trace = 0
    this.fired.clear()
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
