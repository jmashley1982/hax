import type { PlayMode, ThemeId } from './events'
import { hashSeed } from './rng'

/**
 * Central game state. One object, mutated only through the small set of
 * functions in this file (poor-man's reducers) so behaviour stays
 * predictable and, combined with the seeded RNG, replayable.
 *
 * This shape is deliberately larger than Phase 1 needs — layers/missions/
 * heat/score are defined now so later phases extend rather than migrate
 * the save format. Unused-for-now fields are still exercised by
 * save/load so that never silently bit-rots.
 */

export type LayerId = 'surface' | 'perimeter' | 'intranet' | 'core' | 'kernel' | 'physical'

export const LAYER_ORDER: readonly LayerId[] = [
  'surface',
  'perimeter',
  'intranet',
  'core',
  'kernel',
  'physical',
]

export interface GameState {
  /**
   * Save-format version.
   *
   * Exists for exactly one reason: the play-mode migration below has to be
   * able to tell "an old save that needs remapping" from "a new save that
   * already means what it says". Without it the migration re-ran on every
   * load and permanently remapped CASUAL HACK to INFINITE HACK -- a player
   * who chose the levelled game was moved onto the endless one every time
   * they reloaded the page.
   */
  saveVersion: number
  seed: number
  seedLabel: string
  mode: PlayMode
  theme: ThemeId
  layer: LayerId
  heat: number // 0..100, detection meter
  /** 0..100, the player's OWN machine's security posture. Heat is how much they notice you; this is how intact you are. */
  integrity: number
  /**
   * 0..100, the run-level pursuit meter. Unlike heat, this NEVER decays on
   * its own -- it only falls when something earns it back (a breakthrough,
   * a won manhunt). At 100 the run is TRACED. Per-run, like heat and
   * integrity: reset at the start of every contract, never persisted.
   */
  trace: number
  score: number
  /** Operator handle, set on the dashboard and used by in-fiction messages. */
  handle: string
  /** Career totals, kept across contracts and persisted. */
  contractsRun: number
  /**
   * What the payouts actually add up to -- "gotta pay the bills" made
   * visible as a running total distinct from score, which the arcade wall
   * already owns. There is no shop this spends into (yet); it exists to
   * make the fiction's stakes a number you can watch grow.
   */
  credits: number
  deepestLayer: LayerId
  missionId: string | null
  objectiveId: string | null
  filmMode: boolean
  soundOn: boolean
  achievements: string[]
}

const SAVE_KEY = 'nullstack:save:v1'
/** Bump when a stored field changes MEANING, not merely when one is added. */
const SAVE_VERSION = 2

export function createInitialState(seedLabel?: string): GameState {
  const label = seedLabel ?? defaultSeedLabel()
  return {
    saveVersion: SAVE_VERSION,
    seed: hashSeed(label),
    seedLabel: label,
    mode: 'casual',
    theme: 'phosphor',
    layer: 'surface',
    heat: 0,
    integrity: 100,
    trace: 0,
    score: 0,
    handle: 'operator',
    contractsRun: 0,
    credits: 0,
    deepestLayer: 'surface',
    missionId: null,
    objectiveId: null,
    filmMode: false,
    // ON by default. This flag sat here unread for the whole project while
    // the player's report was "i never hear any sounds ever" -- shipping
    // the feature switched off would ship the complaint.
    soundOn: true,
    achievements: [],
  }
}

function defaultSeedLabel(): string {
  // Stable per calendar day by default so a normal session still feels
  // "fresh" without being literally nondeterministic (Date.now() itself
  // is never fed into the RNG stream, only used to name the seed).
  const d = new Date()
  return `${d.getFullYear()}${d.getMonth() + 1}${d.getDate()}-${Math.floor(d.getTime() / 1000)}`
}

export function saveState(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable (private browsing, file://, quota) — non-fatal.
  }
}

export function loadState(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as GameState
  } catch {
    return null
  }
}

/**
 * Apply the persisted *career and settings* fields onto a fresh state.
 *
 * Deliberately partial: seed, layer, heat and integrity are per-run and must
 * start clean, while handle/theme/mode/score/totals carry across sessions.
 *
 * Every field is individually guarded because a save written before these
 * fields existed (which includes any browser that has already run this game)
 * parses fine but leaves them `undefined` -- and `undefined` score renders
 * as "NaN" and `undefined` handle breaks the in-fiction messages that
 * address the player by name.
 */
export function applySavedCareer(state: GameState): void {
  const saved = loadState()
  if (!saved) return
  if (typeof saved.handle === 'string' && saved.handle.trim()) state.handle = saved.handle
  if (typeof saved.score === 'number' && Number.isFinite(saved.score)) state.score = saved.score
  if (typeof saved.contractsRun === 'number' && Number.isFinite(saved.contractsRun)) {
    state.contractsRun = saved.contractsRun
  }
  if (typeof saved.credits === 'number' && Number.isFinite(saved.credits)) {
    state.credits = saved.credits
  }
  if (typeof saved.deepestLayer === 'string' && LAYER_ORDER.includes(saved.deepestLayer)) {
    state.deepestLayer = saved.deepestLayer
  }
  // Two renames of PlayMode have shipped, so localStorage in the wild can
  // hold any of five dead values. Restoring one would index PLAY_MODES
  // with a missing key and crash on the dashboard, so map rather than
  // trust. The mapping is by MEANING, not by name: the OLD 'casual' was
  // the easy mode, which is now INFINITE HACK.
  //
  // Gated on the save version, and that gate is the whole point. Applied
  // unconditionally it also remapped the NEW 'casual' -- so choosing
  // CASUAL HACK, then reloading, silently put you in INFINITE HACK, with
  // its own separate high-score table, forever.
  const CURRENT: readonly string[] = ['infinite', 'casual', 'deep']
  if ((saved.saveVersion ?? 1) >= SAVE_VERSION) {
    if (CURRENT.includes(saved.mode as string)) state.mode = saved.mode
  } else {
    const MODE_MIGRATION: Record<string, PlayMode> = {
      infinite: 'infinite',
      casual: 'infinite',
      leet: 'casual',
      irl: 'casual',
      deep: 'casual',
      // Pre-rework input modes.
      hybrid: 'casual',
      chaos: 'infinite',
      intent: 'casual',
    }
    const migrated = MODE_MIGRATION[saved.mode as string]
    if (migrated) state.mode = migrated
  }
  if (saved.theme) state.theme = saved.theme
  // Guarded like everything else here: a save written before sound existed
  // parses fine and leaves this `undefined`, which would silently mute a
  // returning player rather than falling through to the ON default.
  if (typeof saved.soundOn === 'boolean') state.soundOn = saved.soundOn
  // Same guard, same reason: this flag has sat in the save unread since the
  // first commit, so every existing save has it `undefined`. A prop set up
  // for a shoot should still be set up when the machine is switched on
  // tomorrow, which is the entire point of persisting it.
  if (typeof saved.filmMode === 'boolean') state.filmMode = saved.filmMode
  // Unlocks are career state, not run state. Without this they are written
  // on every debrief and never read back, so a reload re-announces the
  // entire collection as brand new -- measured: six "UNLOCKED" rows on a
  // second run that had earned nothing.
  //
  // Filtered to strings only, deliberately NOT validated against the
  // achievement list: sim/achievements.ts already imports from this file,
  // so importing the ids back would make a cycle, and an unrecognised id is
  // harmless anyway -- every reader (unlockedAchievements, the dashboard
  // count) derives from the canonical ACHIEVEMENTS list, so a stray id
  // renders nothing rather than a blank row.
  if (Array.isArray(saved.achievements)) {
    state.achievements = saved.achievements.filter((id) => typeof id === 'string')
  }
}

export function clearSavedState(): void {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // ignore
  }
}
