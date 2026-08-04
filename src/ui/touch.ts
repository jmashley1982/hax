/**
 * Touch input: the mobile stand-in for a physical keyboard.
 *
 * The whole desktop loop is "mash keys, and whatever panel is focused
 * advances." A phone has no keyboard, so that input has to come from
 * somewhere else without turning the game into a different game. Two
 * gestures cover it:
 *
 *   BREACH pad -- a fixed thumb-zone button. Tap = one keystroke. Hold =
 *   auto-repeat, which is the literal equivalent of holding a key down.
 *   Swiping across it cycles which panel you're driving, so you never have
 *   to reach up the screen to retarget.
 *
 *   Smear -- dragging a finger sideways across the board hits every panel
 *   it crosses. This is the "mash the whole board" feel that mashing a
 *   keyboard gives you on desktop. It's bound to horizontal movement
 *   specifically so it can coexist with vertical scrolling of the panel
 *   stack (the board is `touch-action: pan-y`, so the browser keeps
 *   vertical drags for scroll and hands us horizontal ones).
 */

export interface TouchInputCallbacks {
  /** One "keystroke" worth of drive against the currently targeted panel. */
  burst: () => void
  /** Move the target to the next/previous workable panel. */
  cycleTarget: (direction: number) => void
  /** Drive a specific panel by its DOM element (used by the smear). */
  hitPanelElement: (el: HTMLElement) => void
  /** Short label for whatever is currently targeted, shown on the pad. */
  targetLabel: () => string
}

/** Hold-to-repeat cadence. ~16/s matches a fast keyboard mash without being unreadable. */
const REPEAT_DELAY_MS = 140
const REPEAT_INTERVAL_MS = 62
/** Horizontal travel on the pad that counts as a retarget swipe rather than a tap. */
const SWIPE_PX = 44
/** Minimum horizontal travel before a board drag starts registering as a smear. */
const SMEAR_START_PX = 18

export class TouchInput {
  private pad: HTMLElement
  private padLabel: HTMLElement
  private repeatTimer: ReturnType<typeof setTimeout> | null = null
  private repeatInterval: ReturnType<typeof setInterval> | null = null
  private padStartX = 0
  private padSwiped = false
  private labelTimer: ReturnType<typeof setInterval>

  // Smear state
  private smearing = false
  private smearStartX = 0
  private smearStartY = 0
  private smearActive = false
  private lastSmearPanel: HTMLElement | null = null

  constructor(private mount: HTMLElement, private cb: TouchInputCallbacks) {
    this.pad = document.createElement('div')
    this.pad.className = 'breach-pad'

    const hint = document.createElement('div')
    hint.className = 'breach-pad__hint'
    hint.textContent = 'HOLD TO BREACH  ·  SWIPE TO SWITCH'

    this.padLabel = document.createElement('div')
    this.padLabel.className = 'breach-pad__label'

    this.pad.append(this.padLabel, hint)
    mount.appendChild(this.pad)

    this.bindPad()
    this.bindSmear()

    this.refreshLabel()
    this.labelTimer = setInterval(() => this.refreshLabel(), 400)
  }

  private refreshLabel(): void {
    const next = this.cb.targetLabel()
    if (this.padLabel.textContent !== next) this.padLabel.textContent = next
  }

  private bindPad(): void {
    this.pad.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.padStartX = e.clientX
      this.padSwiped = false
      this.pad.classList.add('is-down')
      // Capture keeps the hold alive if the thumb slides off the pad, but
      // it throws if the pointer isn't currently active -- and since this
      // runs before fire(), an unguarded throw would abort the handler and
      // leave the pad completely dead rather than just uncaptured.
      try {
        this.pad.setPointerCapture(e.pointerId)
      } catch {
        /* non-fatal: the hold still works, it just won't track off-pad */
      }
      this.fire()
      this.repeatTimer = setTimeout(() => {
        this.repeatInterval = setInterval(() => this.fire(), REPEAT_INTERVAL_MS)
      }, REPEAT_DELAY_MS)
    })

    this.pad.addEventListener('pointermove', (e) => {
      if (this.padSwiped) return
      const dx = e.clientX - this.padStartX
      if (Math.abs(dx) < SWIPE_PX) return
      this.padSwiped = true
      this.stopRepeat()
      this.cb.cycleTarget(dx > 0 ? 1 : -1)
      this.refreshLabel()
      this.pad.classList.add('is-swiped')
      setTimeout(() => this.pad.classList.remove('is-swiped'), 200)
    })

    const end = (): void => {
      this.stopRepeat()
      this.pad.classList.remove('is-down')
    }
    this.pad.addEventListener('pointerup', end)
    this.pad.addEventListener('pointercancel', end)
  }

  private fire(): void {
    this.cb.burst()
    this.pad.classList.remove('is-firing')
    void this.pad.offsetWidth
    this.pad.classList.add('is-firing')
  }

  private stopRepeat(): void {
    if (this.repeatTimer) clearTimeout(this.repeatTimer)
    if (this.repeatInterval) clearInterval(this.repeatInterval)
    this.repeatTimer = null
    this.repeatInterval = null
  }

  /**
   * Smear: drag sideways over the board to hit panels as you cross them.
   * Bound on the shell (not individual panels) so it keeps working as
   * panels spawn and close mid-drag.
   */
  private bindSmear(): void {
    this.mount.addEventListener('pointerdown', (e) => {
      if (this.pad.contains(e.target as Node)) return
      this.smearing = true
      this.smearActive = false
      this.smearStartX = e.clientX
      this.smearStartY = e.clientY
      this.lastSmearPanel = null
    })

    this.mount.addEventListener('pointermove', (e) => {
      if (!this.smearing) return
      const dx = Math.abs(e.clientX - this.smearStartX)
      const dy = Math.abs(e.clientY - this.smearStartY)
      // Only claim the gesture once it's clearly horizontal -- a mostly
      // vertical drag belongs to the scroller, not to us.
      if (!this.smearActive) {
        if (dx < SMEAR_START_PX || dx <= dy) return
        this.smearActive = true
      }
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const panel = el?.closest('.panel') as HTMLElement | null
      if (!panel || panel === this.lastSmearPanel) return
      this.lastSmearPanel = panel
      this.cb.hitPanelElement(panel)
    })

    const end = (): void => {
      this.smearing = false
      this.smearActive = false
      this.lastSmearPanel = null
    }
    this.mount.addEventListener('pointerup', end)
    this.mount.addEventListener('pointercancel', end)
  }

  destroy(): void {
    this.stopRepeat()
    clearInterval(this.labelTimer)
    this.pad.remove()
  }
}
