import type { InteractionMode } from './events'
import type { EvaluatedInput } from './input'

/**
 * CHAOS / INTENT / HYBRID are the same engine with different coefficients,
 * not three separate code paths (plan §3). This is the one place those
 * coefficients live -- computeProgress() is the only function that reads
 * them, so tuning "how paced does INTENT feel" never touches UI code.
 */
export interface ModeProfile {
  id: InteractionMode
  /** Progress per raw keystroke. */
  keyGain: number
  /** Progress per click. */
  clickGain: number
  /** Progress per submitted command line (before command-router bonuses). */
  submitGain: number
  /** [min,max] ms between ambient filler beats at zero tension -- scaled down as breach tension climbs (see sim/layers.ts). */
  beatIntervalMs: readonly [number, number]
  /**
   * Whether this mode ever shows "demand" popups (auth prompts, choice
   * dialogs) at all. When true, they fire as breach tension crosses fixed
   * fractions (0.3/0.6/0.9) toward the next layer -- tied to what the
   * player did, not a wall clock (see plan §13a). CHAOS stays demand-free
   * on purpose: mashing should never get interrupted by something that
   * wants a considered decision, that's what HYBRID and INTENT are for.
   */
  demandsEnabled: boolean
  /** Cosmetic hook for fx/audio intensity in later phases. */
  noiseVolume: number
}

export const MODE_PROFILES: Record<InteractionMode, ModeProfile> = {
  chaos: {
    id: 'chaos',
    keyGain: 3,
    clickGain: 4,
    submitGain: 3,
    beatIntervalMs: [350, 900],
    demandsEnabled: false,
    noiseVolume: 1,
  },
  intent: {
    id: 'intent',
    // Raw keystrokes contribute nothing in INTENT -- only submitted
    // commands move the hack along. This is the whole mechanical
    // difference that makes INTENT feel deliberate instead of mashy.
    keyGain: 0,
    clickGain: 0,
    submitGain: 8,
    beatIntervalMs: [900, 2200],
    demandsEnabled: true,
    noiseVolume: 0.3,
  },
  hybrid: {
    id: 'hybrid',
    keyGain: 1.2,
    clickGain: 1.6,
    submitGain: 6,
    beatIntervalMs: [600, 1500],
    demandsEnabled: true,
    noiseVolume: 0.6,
  },
}

/** Progress contributed by one evaluated input under a given mode profile. */
export function computeProgress(evaluated: EvaluatedInput, profile: ModeProfile): number {
  if (!evaluated.effective) return 0
  const base =
    evaluated.event.kind === 'key'
      ? profile.keyGain
      : evaluated.event.kind === 'click'
        ? profile.clickGain
        : profile.submitGain
  return base * evaluated.variety
}
