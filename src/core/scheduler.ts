import { int, type Rng } from './rng'

/**
 * The narrative spine (plan §3). A priority queue of Beats that fire once
 * accumulated progress crosses their cost, plus an ambient filler source
 * that keeps the screen from ever going idle when nothing else is due.
 *
 * Phase 3 only feeds it ambient filler (no mission objectives exist yet).
 * Phase 5 enqueues real mission/objective beats through the same
 * `enqueue()` -- this file doesn't change shape when that happens.
 */
export interface Beat {
  id: string
  /** Progress threshold required before this beat may fire. */
  cost: number
  /** Higher fires first when multiple beats are eligible on the same tick. */
  priority?: number
  /** Default true: fires once and is removed. */
  once?: boolean
  fire: () => void
}

export class Scheduler {
  private queue: Beat[] = []
  private fired = new Set<string>()
  private progress = 0
  private ambientSource: (() => void) | null = null
  private ambientIntervalMs: readonly [number, number] = [600, 1500]
  private nextAmbientAt = 0

  constructor(private rng: Rng) {}

  enqueue(beat: Beat): void {
    this.queue.push(beat)
    this.queue.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  }

  setAmbientSource(fn: () => void): void {
    this.ambientSource = fn
  }

  setAmbientInterval(intervalMs: readonly [number, number]): void {
    this.ambientIntervalMs = intervalMs
  }

  addProgress(amount: number): void {
    this.progress += amount
  }

  get totalProgress(): number {
    return this.progress
  }

  tick(nowMs: number): void {
    for (const beat of this.queue) {
      if (beat.once !== false && this.fired.has(beat.id)) continue
      if (this.progress < beat.cost) continue
      this.fired.add(beat.id)
      beat.fire()
    }
    this.queue = this.queue.filter((b) => !(b.once !== false && this.fired.has(b.id)))

    if (this.ambientSource && nowMs >= this.nextAmbientAt) {
      this.ambientSource()
      this.scheduleNextAmbient(nowMs)
    }
  }

  private scheduleNextAmbient(nowMs: number): void {
    const [lo, hi] = this.ambientIntervalMs
    this.nextAmbientAt = nowMs + int(this.rng, lo, hi)
  }
}
