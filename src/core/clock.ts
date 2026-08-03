import { store } from './store'

/**
 * The single requestAnimationFrame loop for the whole app. Every
 * time-based system (scheduler, heat decay, fx) subscribes to the
 * `tick` event instead of running its own rAF — one loop, one source
 * of truth for elapsed time.
 *
 * `paceMultiplier` scales narrative dt (story/typewriter/scheduler speed)
 * without touching raw dt, so film mode can slow the *story* down while
 * glitch/noise effects stay real-time. Systems that want raw time use
 * `dtRaw`; systems that want story time use `dt`.
 */
export class Clock {
  private rafHandle = 0
  private lastTime = 0
  private running = false
  paceMultiplier = 1

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.rafHandle = requestAnimationFrame(this.frame)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafHandle)
  }

  private frame = (now: number): void => {
    if (!this.running) return
    const dtRaw = Math.min(now - this.lastTime, 250) // clamp to avoid huge jumps on tab-back
    this.lastTime = now
    const dt = dtRaw * this.paceMultiplier
    store.emit('tick', { dt, dtRaw })
    this.rafHandle = requestAnimationFrame(this.frame)
  }
}

export const clock = new Clock()
