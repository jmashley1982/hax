import { int, type Rng } from '@/core/rng'
import type { LayerId } from '@/core/state'

/**
 * Cadence for the background process windows (ui/windows/processWindow.ts)
 * -- small non-interactive windows that pop open, stream a burst of code/
 * log lines, flash an exit code, and close on their own. Purely texture:
 * "like we are triggering events behind the scenes" (the brief's own
 * words). They must never compete with task panels for attention or
 * input, only sell the idea that things are happening in the background
 * even when the player isn't touching anything.
 *
 * Frequency scales with depth and tension the same way CounterHackDirector
 * does -- sparse and occasional at SURFACE, near-constant churn by
 * PHYSICAL -- so this is also one more lever on "every layer feels
 * identical": the deeper you are, the busier the background gets.
 */
const LAYER_DENSITY: Record<LayerId, number> = {
  surface: 0.15,
  perimeter: 0.3,
  intranet: 0.45,
  core: 0.6,
  kernel: 0.8,
  physical: 1,
}

export class ProcessSpawnDirector {
  private nextAt = 0

  constructor(private rng: Rng) {}

  /** Call every tick; returns true exactly when a new process window should spawn. */
  tick(elapsedMs: number, layer: LayerId, tension: number): boolean {
    if (elapsedMs < this.nextAt) return false
    const intensity = Math.min(1, LAYER_DENSITY[layer] * 0.7 + tension * 0.3)
    const lo = Math.max(600, 7000 - intensity * 5500)
    const hi = Math.max(lo + 400, 12000 - intensity * 8000)
    this.nextAt = elapsedMs + int(this.rng, lo, hi)
    return true
  }
}
