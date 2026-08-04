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
  surface: 0.3,
  perimeter: 0.5,
  intranet: 0.68,
  core: 0.82,
  kernel: 0.92,
  physical: 1,
}

/**
 * How many windows a single firing opens. Deep layers pop two or three at
 * once, which is what turns "an occasional window" into the constant
 * background churn the brief asked for ("substantially more pop-ups with
 * random code running").
 */
export function burstSize(layer: LayerId, rng: Rng): number {
  const d = LAYER_DENSITY[layer]
  if (d >= 0.9) return rng() < 0.45 ? 3 : 2
  if (d >= 0.6) return rng() < 0.5 ? 2 : 1
  return 1
}

export class ProcessSpawnDirector {
  private nextAt = 0

  constructor(private rng: Rng) {}

  /** Hold off spawning for `ms` -- used so a reboot comes back to a calm desk. */
  defer(elapsedMs: number, ms: number): void {
    this.nextAt = Math.max(this.nextAt, elapsedMs + ms)
  }

  /** Call every tick; returns true exactly when a new process window should spawn. */
  tick(elapsedMs: number, layer: LayerId, tension: number): boolean {
    if (elapsedMs < this.nextAt) return false
    const intensity = Math.min(1, LAYER_DENSITY[layer] * 0.7 + tension * 0.3)
    const lo = Math.max(320, 3600 - intensity * 3100)
    const hi = Math.max(lo + 260, 6200 - intensity * 4900)
    this.nextAt = elapsedMs + int(this.rng, lo, hi)
    return true
  }
}
