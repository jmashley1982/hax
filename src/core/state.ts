import type { InteractionMode, ThemeId } from './events'
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
  seed: number
  seedLabel: string
  mode: InteractionMode
  theme: ThemeId
  layer: LayerId
  heat: number // 0..100, detection meter
  score: number
  missionId: string | null
  objectiveId: string | null
  filmMode: boolean
  soundOn: boolean
  achievements: string[]
}

const SAVE_KEY = 'nullstack:save:v1'

export function createInitialState(seedLabel?: string): GameState {
  const label = seedLabel ?? defaultSeedLabel()
  return {
    seed: hashSeed(label),
    seedLabel: label,
    mode: 'hybrid',
    theme: 'phosphor',
    layer: 'surface',
    heat: 0,
    score: 0,
    missionId: null,
    objectiveId: null,
    filmMode: false,
    soundOn: false,
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

export function clearSavedState(): void {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // ignore
  }
}
