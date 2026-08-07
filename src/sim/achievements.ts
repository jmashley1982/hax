import type { GameState } from '@/core/state'
import { LAYER_ORDER, type LayerId } from '@/core/state'

/**
 * Unlockables, persisted.
 *
 * `GameState.achievements` has been declared since the first commit and
 * nothing has ever written to it -- the third dead field in this file's
 * neighbourhood, after `soundOn` (shipped switched off for the whole
 * project while the player's complaint was "i never hear any sounds") and
 * `filmMode`. A declared-but-unwritten field is worse than an absent one:
 * it reads as a built feature every time someone opens the file.
 *
 * The design rule here is narrow on purpose: an achievement must be
 * checkable from facts the run ALREADY tracks. Anything needing new
 * bookkeeping is a new system pretending to be a reward, and every counter
 * added for a badge is a counter that can disagree with the game.
 */

export interface Achievement {
  id: string
  name: string
  /** How you got it, in the second person. Shown on the debrief. */
  note: string
}

/** Everything the check needs, gathered at the end of a run. */
export interface RunFacts {
  kind: 'completed' | 'burned' | 'aborted'
  deepestLayer: LayerId
  integrityLeft: number
  elapsedMs: number
  /** Peak heat over the run -- how close they came to noticing you. */
  peakHeat: number
  /** Lowest integrity touched, which is not the same as what you finished on. */
  lowestIntegrity: number
  /** Blocking gates resolved successfully this run. */
  gatesCleared: number
  /** Gates walked through on a key a contact handed over. */
  allyKeysUsed: number
  /** Level objectives completed. */
  levelsCleared: number
  /** The contract's security tier, 1-5. */
  tier: number
  /** Whether the banked score made the wall. */
  madeTheWall: boolean
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-blood', name: 'FIRST BLOOD', note: 'banked your first contract' },
  { id: 'deep-cut', name: 'DEEP CUT', note: 'reached the building' },
  { id: 'ghost', name: 'GHOST', note: 'finished a contract without heat ever passing 25%' },
  { id: 'untouched', name: 'UNTOUCHED', note: 'finished a contract at full integrity' },
  { id: 'clean-sweep', name: 'CLEAN SWEEP', note: 'cleared all six level objectives in one run' },
  { id: 'locksmith', name: 'LOCKSMITH', note: 'beat five blocking gates in a single run' },
  { id: 'inside-man', name: 'INSIDE MAN', note: 'walked a gate on a key a contact sent ahead' },
  { id: 'high-roller', name: 'HIGH ROLLER', note: 'completed a tier-5 contract' },
  { id: 'smash-grab', name: 'SMASH AND GRAB', note: 'completed a contract in under three minutes' },
  { id: 'nine-lives', name: 'NINE LIVES', note: 'completed a run after integrity fell below 20%' },
  { id: 'on-the-wall', name: 'ON THE WALL', note: 'put your initials on the board' },
  { id: 'burned', name: 'BURNED', note: 'lost a contract and came back anyway' },
]

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]))

/** The predicate for each. Kept beside the list so neither can drift alone. */
function earned(id: string, f: RunFacts): boolean {
  const done = f.kind === 'completed'
  switch (id) {
    case 'first-blood':
      return done
    // Deliberately NOT gated on completing: getting to the bottom is the
    // achievement, and being burned there does not un-reach it.
    case 'deep-cut':
      return LAYER_ORDER.indexOf(f.deepestLayer) >= LAYER_ORDER.length - 1
    case 'ghost':
      return done && f.peakHeat <= 25
    case 'untouched':
      return done && f.integrityLeft >= 100
    case 'clean-sweep':
      return done && f.levelsCleared >= 6
    case 'locksmith':
      return f.gatesCleared >= 5
    case 'inside-man':
      return f.allyKeysUsed >= 1
    case 'high-roller':
      return done && f.tier >= 5
    case 'smash-grab':
      return done && f.elapsedMs < 180_000
    case 'nine-lives':
      return done && f.lowestIntegrity < 20
    case 'on-the-wall':
      return f.madeTheWall
    case 'burned':
      return f.kind === 'burned'
    default:
      return false
  }
}

/**
 * Award whatever this run earned, and return only what is NEW.
 *
 * Mutates `state.achievements` so the caller can persist it with the same
 * saveState it already calls. Returns the new ones only -- re-announcing
 * FIRST BLOOD after every contract would turn the whole idea into noise.
 */
export function awardAchievements(state: GameState, facts: RunFacts): Achievement[] {
  // A save written before this existed parses fine and leaves the field
  // undefined, which would throw on .includes -- the same guard every other
  // restored field in state.ts carries, for the same reason.
  if (!Array.isArray(state.achievements)) state.achievements = []
  const fresh: Achievement[] = []
  for (const a of ACHIEVEMENTS) {
    if (state.achievements.includes(a.id)) continue
    if (!earned(a.id, facts)) continue
    state.achievements.push(a.id)
    fresh.push(a)
  }
  return fresh
}

/** Everything unlocked so far, in list order rather than unlock order. */
export function unlockedAchievements(state: GameState): Achievement[] {
  if (!Array.isArray(state.achievements)) return []
  return ACHIEVEMENTS.filter((a) => state.achievements.includes(a.id))
}

export function achievementById(id: string): Achievement | undefined {
  return BY_ID.get(id)
}
