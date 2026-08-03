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

const LAYER_DANGER: Record<LayerId, number> = {
  surface: 0.2,
  perimeter: 0.4,
  intranet: 0.55,
  core: 0.7,
  kernel: 0.85,
  physical: 1,
}

export class CounterHackDirector {
  private nextCheckAt = 0

  constructor(private rng: Rng) {}

  /**
   * Call every tick with current heat (0-100) and layer. Returns a new
   * threat to spawn, or null. Danger scales with both heat and depth, so
   * the same heat level is a bigger problem the deeper you are.
   */
  tick(elapsedMs: number, heat: number, layer: LayerId, activeThreatCount: number): ThreatEvent | null {
    if (elapsedMs < this.nextCheckAt) return null
    if (activeThreatCount > 0) {
      // Don't pile threats on top of each other -- re-check soon instead.
      this.nextCheckAt = elapsedMs + 800
      return null
    }

    const danger = LAYER_DANGER[layer]
    const heatFactor = heat / 100
    const chance = Math.min(0.85, danger * 0.4 + heatFactor * 0.6)

    // Interval shrinks with danger: frequent close calls deep in a hunted
    // layer, rare on the surface.
    const [lo, hi] = [14000 - danger * 8000, 24000 - danger * 12000]
    this.nextCheckAt = elapsedMs + int(this.rng, lo, hi)

    if (this.rng() > chance) return null
    return this.rollThreat(danger)
  }

  private rollThreat(danger: number): ThreatEvent {
    const roll = this.rng()
    const kind: ThreatKind = roll < 0.4 ? 'traceback' : roll < 0.75 ? 'reverseShell' : 'lockdown'
    const hitsNeeded = 4 + Math.round(danger * 5)
    const timeoutMs = Math.max(6000, 13000 - danger * 5000)
    return { kind, hitsNeeded, timeoutMs }
  }
}

export function layerDangerLabel(layer: LayerId): string {
  const idx = LAYER_ORDER.indexOf(layer)
  return ['LOW', 'GUARDED', 'ALERT', 'HOSTILE', 'HUNTED', 'MAXIMUM'][idx] ?? 'LOW'
}
