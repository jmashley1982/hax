import type { PlayMode } from './events'
import type { EvaluatedInput } from './input'

/**
 * The three ways to play.
 *
 * These used to be *input* modes -- CHAOS / INTENT / HYBRID -- which
 * described the shape of your keyboard rather than the shape of the game.
 * INTENT in particular made raw keystrokes literally inert, so choosing it
 * from a menu that only said "INTENT" produced a game that looked broken.
 *
 * They are now difficulty settings, and every mode accepts both mashing and
 * typed commands. What changes is *pressure*: how often they come after
 * you, how hard a mistake lands, how fast you recover, and -- at the top
 * end -- whether standing still is survivable at all.
 *
 * One profile object holds every coefficient, so tuning "how mean is IRL"
 * never touches UI or system code.
 */
export interface PlayModeProfile {
  id: PlayMode
  /** Shown on the dashboard toggle. */
  label: string
  /** One line under the toggle, so the choice is informed. */
  blurb: string

  // -- input economy ------------------------------------------------------
  /** Progress per raw keystroke. */
  keyGain: number
  /** Progress per click. */
  clickGain: number
  /** Progress per submitted command line (before command-router bonuses). */
  submitGain: number
  /** [min,max] ms between ambient filler beats at zero tension -- scaled down as breach tension climbs (see sim/layers.ts). */
  beatIntervalMs: readonly [number, number]
  /** Whether "demand" popups (auth prompts, choice dialogs) fire at all. */
  demandsEnabled: boolean
  /** Cosmetic hook for fx/audio intensity. */
  noiseVolume: number

  // -- pressure -----------------------------------------------------------
  /** Multiplier on counter-intrusion wave frequency. */
  threatRate: number
  /** Multiplier on how many threats a wave contains. */
  threatSize: number
  /** Multiplier on every integrity penalty. */
  damageMul: number
  /** Multiplier on passive integrity regeneration. */
  regenMul: number
  /** Multiplier on lockout frequency. */
  lockoutRate: number
  /** Multiplier on how readily a reverse hack triggers. */
  reverseRate: number
  /**
   * Integrity lost per second of standing still, after `idleGraceMs`.
   * Zero disables it -- this is the whole of "not moving quickly gets you
   * kicked out", and it is the one thing only IRL does.
   */
  idleDrainPerSec: number
  idleGraceMs: number
}

export const PLAY_MODES: Record<PlayMode, PlayModeProfile> = {
  casual: {
    id: 'casual',
    label: 'CASUAL',
    blurb: 'hack at your leisure. easy to stay in the system.',
    keyGain: 1.8,
    clickGain: 2.2,
    submitGain: 7,
    beatIntervalMs: [700, 1700],
    demandsEnabled: true,
    noiseVolume: 0.45,
    threatRate: 0.45,
    threatSize: 0.6,
    damageMul: 0.55,
    regenMul: 1.8,
    lockoutRate: 0.35,
    reverseRate: 0.5,
    idleDrainPerSec: 0,
    idleGraceMs: 0,
  },
  leet: {
    id: 'leet',
    label: 'L337 H4X0R',
    blurb: 'intense and cinematic. interruptions bite, but you can take it.',
    keyGain: 1.4,
    clickGain: 1.8,
    submitGain: 8,
    beatIntervalMs: [550, 1400],
    demandsEnabled: true,
    noiseVolume: 0.8,
    threatRate: 1,
    threatSize: 1,
    damageMul: 1,
    regenMul: 1,
    lockoutRate: 1,
    reverseRate: 1,
    idleDrainPerSec: 0,
    idleGraceMs: 0,
  },
  irl: {
    id: 'irl',
    label: 'IRL HACKER',
    blurb: 'serious business. stop moving and they will have you.',
    keyGain: 1.2,
    clickGain: 1.5,
    submitGain: 9,
    beatIntervalMs: [400, 1000],
    demandsEnabled: true,
    noiseVolume: 1,
    threatRate: 1.8,
    threatSize: 1.5,
    damageMul: 1.6,
    regenMul: 0.55,
    lockoutRate: 1.7,
    reverseRate: 1.7,
    // Note this is scaled by damageMul (1.6) like every other penalty, so
    // the effective rate is ~7.2/sec: about 18 seconds of *total* inactivity
    // from full integrity to overrun. Any input at all resets the grace, so
    // this punishes walking away, not thinking.
    idleDrainPerSec: 4.5,
    idleGraceMs: 4000,
  },
}

export const PLAY_MODE_ORDER: readonly PlayMode[] = ['casual', 'leet', 'irl']

/** Progress contributed by one evaluated input under a given mode profile. */
export function computeProgress(evaluated: EvaluatedInput, profile: PlayModeProfile): number {
  const base =
    evaluated.event.kind === 'key'
      ? profile.keyGain
      : evaluated.event.kind === 'click'
        ? profile.clickGain
        : profile.submitGain
  return base * evaluated.variety
}
