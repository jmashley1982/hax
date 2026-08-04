import { int, type Rng } from '@/core/rng'
import type { LayerId } from '@/core/state'
import { LAYER_ORDER } from '@/core/state'

/**
 * The other side pushing back.
 *
 * Everything before this was you acting on a passive target. The brief
 * asked for the opposite: "it needs to feel like you're doing something
 * wrong, being sneaky... alerts that a reverse hack is in effect and you
 * have to break their attempt." Heat existed but only ever produced a
 * decorative popup and a meter reset -- nothing the player had to
 * actively fight off. This is what makes heat matter: at high heat, a
 * detection event fires on a real countdown, and ignoring it has a real
 * (but never fatal) cost.
 *
 * Frequency and severity both scale with depth, which is also the
 * biggest lever left for "every layer feels identical" -- the deeper you
 * are, the more often and the harder the other side hits back.
 */
export type ThreatKind = 'traceback' | 'reverseShell' | 'lockdown'

export interface ThreatEvent {
  kind: ThreatKind
  /** How many "hits" are needed to shut it down. */
  hitsNeeded: number
  /** ms before it resolves against the player if ignored. */
  timeoutMs: number
}

/**
 * A counter-intrusion wave: `kinds.length` threat windows spawn at once,
 * all sharing the same `timeoutMs` -- their individual countdown bars
 * animate in lockstep, reading as one shared clock rather than N unrelated
 * timers. Missing even one before it expires is a real fail state (see
 * shell.ts's handleEjection) -- "you have to break their attempt or they
 * kick you out and you have to start over," in the user's own words.
 */
export interface ThreatWaveSpec {
  kinds: ThreatKind[]
  hitsNeeded: number
  timeoutMs: number
}

const LAYER_DANGER: Record<LayerId, number> = {
  surface: 0.2,
  perimeter: 0.4,
  intranet: 0.55,
  core: 0.7,
  kernel: 0.85,
  physical: 1,
}

/** How many simultaneous threats a wave throws at this depth -- one more lever on "every layer feels identical," since a deep wave is a qualitatively bigger fight, not just a faster one. */
const WAVE_SIZE: Record<LayerId, number> = {
  surface: 1,
  perimeter: 2,
  intranet: 2,
  core: 3,
  kernel: 4,
  physical: 5,
}

const KINDS: readonly ThreatKind[] = ['traceback', 'reverseShell', 'lockdown']

export class CounterHackDirector {
  private nextCheckAt = 0

  /**
   * Push the next wave out by `ms`.
   *
   * Used after events that already put the player through the wringer --
   * chiefly a lockout, where a wave that came due while the terminal was
   * dead would otherwise fire the instant they finish rebooting, which
   * reads as the game kicking someone who just got back up.
   */
  defer(elapsedMs: number, ms: number): void {
    this.nextCheckAt = Math.max(this.nextCheckAt, elapsedMs + ms)
  }

  constructor(private rng: Rng) {}

  /**
   * Call every tick with current heat (0-100) and layer. Returns a new
   * wave to spawn, or null. Danger scales with both heat and depth, so
   * the same heat level is a bigger problem the deeper you are.
   */
  tick(elapsedMs: number, heat: number, layer: LayerId, activeThreatCount: number): ThreatWaveSpec | null {
    if (elapsedMs < this.nextCheckAt) return null
    if (activeThreatCount > 0) {
      // Don't pile a wave on top of one already running -- re-check soon instead.
      this.nextCheckAt = elapsedMs + 800
      return null
    }

    const danger = LAYER_DANGER[layer]
    const heatFactor = heat / 100
    // A real base floor, not just a heat/depth multiplier -- an earlier
    // version of this formula (danger*0.4 + heatFactor*0.6, no floor) was
    // tuned so conservatively that a full scripted descent through all six
    // layers produced ZERO periodic waves; the only counter-hack ever seen
    // was the threshold-triggered PHYSICAL finale. That directly undercut
    // the brief this system exists to satisfy ("periodically... should
    // attempt to hack us back") -- this needs to be a mechanic a player
    // reliably experiences within one run, not a rare fluke.
    const chance = Math.min(0.9, 0.25 + danger * 0.35 + heatFactor * 0.4)

    // Interval shrinks with danger: frequent close calls deep in a hunted
    // layer, still a real recurring threat (not rare) even on the surface.
    const [lo, hi] = [6000 - danger * 3000, 12000 - danger * 5000]
    this.nextCheckAt = elapsedMs + int(this.rng, lo, hi)

    if (this.rng() > chance) return null
    return this.rollWave(danger, layer)
  }

  private rollWave(danger: number, layer: LayerId): ThreatWaveSpec {
    const size = WAVE_SIZE[layer]
    const kinds: ThreatKind[] = []
    for (let i = 0; i < size; i++) kinds.push(KINDS[int(this.rng, 0, KINDS.length - 1)]!)
    const hitsNeeded = 4 + Math.round(danger * 5)
    const timeoutMs = Math.max(7000, 14000 - danger * 5000)
    return { kinds, hitsNeeded, timeoutMs }
  }
}

export function layerDangerLabel(layer: LayerId): string {
  const idx = LAYER_ORDER.indexOf(layer)
  return ['LOW', 'GUARDED', 'ALERT', 'HOSTILE', 'HUNTED', 'MAXIMUM'][idx] ?? 'LOW'
}
