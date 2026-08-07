import type { PlayMode } from './events'
import type { EvaluatedInput } from './input'

/**
 * The three ways to play.
 *
 * These started as *input* modes (CHAOS / INTENT / HYBRID), which
 * described the shape of your keyboard rather than the shape of the game,
 * and then became pure difficulty settings (CASUAL / L337 / IRL). The
 * difficulty version was the right axis but the wrong unit of change: all
 * three still ran the same loop, so the only difference between them was
 * how often you got hit while doing the same shapeless thing.
 *
 * They are now genuinely different games, and the two flags below are
 * what make them different rather than the coefficients:
 *
 *   INFINITE HACK  `endless`, not `levelled`. Never ends, no objectives,
 *                  no gates -- you leave by pressing ESC. The toy.
 *   CASUAL HACK    `levelled`. Six levels, each with a stated objective,
 *                  a tool that answers it, and gates that stop the world
 *                  until you deal with them. The actual game.
 *   DEEP HACK      not built. Present on the dashboard as COMING SOON so
 *                  the ladder is visible.
 *
 * Every mode still accepts both mashing and typed commands; that was
 * never the axis.
 */
export interface PlayModeProfile {
  id: PlayMode
  /** Shown on the dashboard toggle. */
  label: string
  /** One line under the toggle, so the choice is informed. */
  blurb: string

  // -- what KIND of game this is -----------------------------------------
  /**
   * Selectable right now. A false here renders the toggle position as
   * COMING SOON and refuses to start a session, which is deliberately a
   * visible dead position rather than a hidden one -- a ladder you can
   * see the top of reads as a roadmap; a two-item list reads as all there
   * is.
   */
  available: boolean
  /**
   * Levels have objectives, and objectives are the win condition. When
   * false the old behaviour applies: a level ends when its progress
   * threshold fills.
   */
  levelled: boolean
  /**
   * Reaching the bottom rolls into a fresh target instead of ending the
   * run. No debrief, no score screen, until the player quits.
   */
  endless: boolean

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
  /**
   * The toy. Inherits every asset built for CASUAL HACK -- the new panels,
   * the wider image library, the ambient mix -- but none of its structure,
   * because structure is exactly what you do not want when you are just
   * messing about with it on a second monitor.
   */
  infinite: {
    id: 'infinite',
    label: 'INFINITE HACK',
    blurb: 'never ends. no objectives, no gates. hack until you press ESC.',
    available: true,
    levelled: false,
    endless: true,
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
  /**
   * The game. Pressure sits where L337 H4X0R sat, because that was always
   * the right *feel* -- what was missing was something to do with it.
   * `levelled` is the flag that supplies that.
   */
  casual: {
    id: 'casual',
    label: 'CASUAL HACK',
    blurb: 'six levels, each with a job to finish. some things will not wait.',
    available: true,
    levelled: true,
    endless: false,
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
  /**
   * Not built. The coefficients are real so the profile can be tuned and
   * typechecked alongside the others, but `available: false` keeps it off
   * the board until it has a design of its own -- shipping it as "CASUAL
   * but the numbers are bigger" is the mistake this whole round exists to
   * undo.
   */
  deep: {
    id: 'deep',
    label: 'DEEP HACK',
    blurb: 'coming soon.',
    available: false,
    levelled: true,
    endless: false,
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
    // Scaled by damageMul like every other penalty, so the effective rate
    // is ~7.2/sec: about 18 seconds of *total* inactivity from full
    // integrity to overrun. Any input resets the grace, so this punishes
    // walking away, not thinking.
    idleDrainPerSec: 4.5,
    idleGraceMs: 4000,
  },
}

export const PLAY_MODE_ORDER: readonly PlayMode[] = ['infinite', 'casual', 'deep']

/** The modes a player may actually start. */
export const PLAYABLE_MODES: readonly PlayMode[] = PLAY_MODE_ORDER.filter(
  (m) => PLAY_MODES[m].available,
)

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
