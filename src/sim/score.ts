import type { GameState } from '@/core/state'

/** Score is purely a "how much did you do" counter for Phase 4 -- ranks/combos are later polish (plan phase 10). */
export function awardScore(state: GameState, amount: number): void {
  state.score = Math.max(0, state.score + amount)
}
