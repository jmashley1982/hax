import type { GameState, LayerId } from '@/core/state'
import { LAYER_ORDER } from '@/core/state'

/**
 * The depth-progression system, pulled forward after the first playtest
 * made clear it was the missing core loop (see plan §13a): input needs to
 * visibly build toward something, or "doing anything gives the same
 * result" is literally true, not just a feeling.
 *
 * Each layer has a progress threshold. `tension` (0..~1.3) is proximity to
 * breakthrough and is the single number that drives the intensity curve
 * (ambient pacing, burst size, how often decision popups fire) -- so
 * "hectic and complex, then simplifying, then busy again" is a direct
 * consequence of this number resetting to 0 on breakthrough and climbing
 * again, not a scripted animation.
 *
 * Thresholds grow with depth and each layer draws from different content
 * banks (see LAYER_DEFS) so a full descent reads as six distinct
 * stretches, not one short loop repeated six times (per the user's
 * "not just the same loop every minute or two" note).
 */
export interface LayerDef {
  id: LayerId
  title: string
  threshold: number
  /** Ambient burst sources specific to this layer's texture. */
  burstSources: ReadonlyArray<readonly [string, string]>
  /** Bank/key drawn from for the breakthrough-moment burst. */
  breachBank: readonly [string, string]
  /** Human-readable target name used in generated demand-popup copy. */
  demandFlavor: string
}

const LAYER_DEFS: Record<LayerId, LayerDef> = {
  surface: {
    id: 'surface',
    title: 'SURFACE',
    threshold: 240,
    burstSources: [
      ['netops', 'scanLine'],
      ['kernel', 'dmesg'],
    ],
    breachBank: ['flavor', 'ambientSuccess'],
    demandFlavor: 'perimeter gateway',
  },
  perimeter: {
    id: 'perimeter',
    title: 'PERIMETER',
    threshold: 340,
    burstSources: [
      ['exploit', 'stage'],
      ['warnings', 'idsAlert'],
    ],
    breachBank: ['exploit', 'shell'],
    demandFlavor: 'firewall cluster',
  },
  intranet: {
    id: 'intranet',
    title: 'INTRANET',
    threshold: 440,
    burstSources: [
      ['filesystem', 'dirEntry'],
      ['filesystem', 'grepHit'],
    ],
    breachBank: ['crypto', 'decrypt'],
    demandFlavor: 'internal directory service',
  },
  core: {
    id: 'core',
    title: 'CORE',
    threshold: 540,
    burstSources: [
      ['crypto', 'decrypt'],
      ['crypto', 'keygen'],
    ],
    breachBank: ['exploit', 'privesc'],
    demandFlavor: 'core database cluster',
  },
  kernel: {
    id: 'kernel',
    title: 'KERNEL',
    threshold: 640,
    burstSources: [
      ['exploit', 'privesc'],
      ['kernel', 'dmesg'],
    ],
    breachBank: ['physical', 'scada'],
    demandFlavor: 'hypervisor control plane',
  },
  physical: {
    id: 'physical',
    title: 'PHYSICAL',
    // Final layer -- no further breakthrough via this mechanism yet.
    // Phase 7's finale cinematic is the eventual payoff for reaching here;
    // until then it plateaus at full intensity, which is an acceptable
    // "you made it" state on its own.
    threshold: Infinity,
    burstSources: [
      ['physical', 'scada'],
      ['physical', 'camera'],
    ],
    breachBank: ['physical', 'blackout'],
    demandFlavor: 'building control systems',
  },
}

export function layerDef(id: LayerId): LayerDef {
  return LAYER_DEFS[id]
}

export class LayerSystem {
  progressInLayer = 0
  private firedFractions = new Set<number>()
  private static readonly DEMAND_FRACTIONS = [0.3, 0.6, 0.9]

  constructor(private state: GameState) {}

  get current(): LayerDef {
    return LAYER_DEFS[this.state.layer]
  }

  /** Proximity to breakthrough, 0..~1.3 (clamped past 1 so a lagging tick doesn't overshoot wildly). */
  get tension(): number {
    if (!Number.isFinite(this.current.threshold)) return 0.5 // physical: steady mid-intensity plateau
    return Math.min(1.3, this.progressInLayer / this.current.threshold)
  }

  get isFinalLayer(): boolean {
    return this.state.layer === 'physical'
  }

  /** Returns true if this addition crossed the breakthrough threshold. */
  addProgress(amount: number): boolean {
    if (this.isFinalLayer) return false
    this.progressInLayer += amount
    return this.progressInLayer >= this.current.threshold
  }

  /**
   * Call once after addProgress() to check whether a new demand-popup
   * fraction boundary was just crossed (0.3 / 0.6 / 0.9 of the way to
   * breakthrough) -- this is what ties popup frequency directly to player
   * engagement instead of a wall clock.
   */
  checkDemandTrigger(): boolean {
    const t = this.tension
    for (const frac of LayerSystem.DEMAND_FRACTIONS) {
      if (t >= frac && !this.firedFractions.has(frac)) {
        this.firedFractions.add(frac)
        return true
      }
    }
    return false
  }

  /** Advance to the next layer, resetting progress and the demand-fraction tracker. */
  breakthrough(): LayerDef {
    const idx = LAYER_ORDER.indexOf(this.state.layer)
    const next = LAYER_ORDER[Math.min(idx + 1, LAYER_ORDER.length - 1)] ?? this.state.layer
    this.state.layer = next
    this.progressInLayer = 0
    this.firedFractions.clear()
    return LAYER_DEFS[next]
  }
}
