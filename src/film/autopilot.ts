import { int, pick, type Rng } from '@/core/rng'

/**
 * The hands-off demo driver.
 *
 * Point it at the board and the screen plays itself: it mashes at a human
 * cadence, clicks live cells, and re-targets panels, so a monitor can run
 * unattended behind an actor for a whole take with nobody at the keyboard.
 * It is also the honest way to demo the thing without someone visibly
 * driving it.
 *
 * Two design constraints, both load-bearing:
 *
 * - **Every draw comes from the seeded rng.** Same `?seed=`, same
 *   autopilot performance, take after take. That is the entire film-prop
 *   premise -- "deterministic playback so takes match" -- and one bare
 *   Math.random() here would quietly destroy it.
 * - **It drives the same entry points a human does.** Keystrokes go
 *   through the Shell's own key handler and clicks are real clicks on real
 *   elements, so autopilot cannot diverge from played behaviour. A driver
 *   that reached into panel internals would prove nothing and would rot
 *   the moment a panel changed.
 *
 * Ticked from the Shell's rAF loop rather than a setTimeout, matching
 * Chain and FieldOp -- so it freezes when the board freezes (a gate, the
 * lockout) instead of hammering a screen that is not listening.
 */

const KEYS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')

/** Roughly 7 keys/sec, the cadence every probe in this project uses. */
const KEY_MIN_MS = 110
const KEY_MAX_MS = 190

/** How often it stops typing and clicks something instead. */
const CLICK_EVERY_MIN = 6
const CLICK_EVERY_MAX = 14

export interface AutopilotHooks {
  /** The Shell's own keystroke path. */
  key: (char: string) => void
  /** The live, clickable widgets on the board right now. */
  clickables: () => Element[]
}

export class Autopilot {
  private on = false
  private sinceKeyMs = 0
  private nextKeyMs = KEY_MIN_MS
  private untilClick = 8

  constructor(
    private rng: Rng,
    private hooks: AutopilotHooks,
  ) {}

  get active(): boolean {
    return this.on
  }

  toggle(): boolean {
    this.on = !this.on
    return this.on
  }

  setActive(on: boolean): void {
    this.on = on
  }

  tick(dtMs: number): void {
    if (!this.on) return
    this.sinceKeyMs += dtMs
    if (this.sinceKeyMs < this.nextKeyMs) return
    this.sinceKeyMs = 0
    this.nextKeyMs = int(this.rng, KEY_MIN_MS, KEY_MAX_MS)

    this.untilClick -= 1
    if (this.untilClick <= 0) {
      this.untilClick = int(this.rng, CLICK_EVERY_MIN, CLICK_EVERY_MAX)
      const targets = this.hooks.clickables()
      if (targets.length > 0) {
        const el = pick(this.rng, targets)
        if (el instanceof HTMLElement) {
          // pointerdown first: several widgets (and the Shell's targeting
          // listener) act on pointerdown, not click, so a bare click()
          // would miss half the board.
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
          el.click()
        }
        return
      }
    }

    this.hooks.key(pick(this.rng, KEYS))
  }
}
