import { clock } from '@/core/clock'

/**
 * FILM MODE -- the half of the original brief that was never built.
 *
 * The whole project has two audiences: a toy anyone can mash at, and a
 * prop you can put on a monitor behind an actor and shoot. Everything so
 * far has served the first. This serves the second, and it needs exactly
 * three things that ordinary play does not:
 *
 * 1. **No game chrome.** A hacking screen in a film must not have an
 *    OBJECTIVE bar telling you to click the open ports, or a footer
 *    reading MODE:CASUAL HACK. Those are the tells that it is a game.
 *    Everything that is diegetic -- windows, the terminal, the contact
 *    list, the meters, the camera feeds -- stays, because that is the shot.
 * 2. **Slower.** Real screen action is shot in short takes and read at a
 *    glance; the default pacing is tuned for a player who is driving it and
 *    is too frantic on camera. `clock.paceMultiplier` has existed since the
 *    first commit and nothing has ever set it. This sets it.
 * 3. **Beats on cue.** A director needs the breakthrough to land on the
 *    line, not whenever the objective happens to complete. F10 forces the
 *    next layer immediately.
 *
 * Bound to F8/F9/F10 deliberately: `Prompt.handleKeydown` only forwards
 * keys where `e.key.length === 1`, so function keys can never be confused
 * with mashing. A single-character hotkey would be eaten by the board (and
 * would eat a keystroke from it).
 */

/**
 * 0.6 -- the value the plan named. Narrative time only: `clock` applies
 * this to the tick it hands the simulation, and effects that run off their
 * own animation timers are untouched, so the story slows down without the
 * glitches turning to syrup.
 */
export const FILM_PACE = 0.6

export interface FilmModeOptions {
  /** Printed to the terminal so the operator gets confirmation on screen. */
  line: (text: string) => void
  /** Push the run to the next depth layer right now. */
  forceAdvance: () => void
  /** Toggle the hands-off demo driver. Returns its new state. */
  toggleAutopilot: () => boolean
}

export class FilmMode {
  private on = false
  private handler: (e: KeyboardEvent) => void

  constructor(private opts: FilmModeOptions) {
    this.handler = (e) => this.onKey(e)
    // Capture phase, so the hotkeys work even while a gate or the lockout
    // has claimed input. A director whose force-advance stopped working
    // because a popup happened to be up would rightly not trust it.
    window.addEventListener('keydown', this.handler, true)
  }

  get active(): boolean {
    return this.on
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'F9') {
      e.preventDefault()
      this.setActive(!this.on)
      return
    }
    if (e.key === 'F10') {
      e.preventDefault()
      this.opts.line('>> [film] cue -- advancing')
      this.opts.forceAdvance()
      return
    }
    if (e.key === 'F8') {
      e.preventDefault()
      const on = this.opts.toggleAutopilot()
      this.opts.line(`>> [film] autopilot ${on ? 'engaged' : 'released'}`)
    }
  }

  setActive(on: boolean): void {
    if (on === this.on) return
    this.on = on
    // A root-level data attribute, so the chrome rules live in CSS and no
    // component has to know film mode exists.
    if (on) document.documentElement.dataset.film = 'on'
    else delete document.documentElement.dataset.film
    clock.paceMultiplier = on ? FILM_PACE : 1
    this.opts.line(
      on
        ? '>> [film] chrome hidden, pacing 0.6x -- F10 cues the next layer, F8 flies it'
        : '>> [film] normal',
    )
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handler, true)
    // Never leave the pace or the chrome flag behind on a dead session --
    // the next contract would start slow with its objective bar missing and
    // nothing on screen to explain why.
    clock.paceMultiplier = 1
    delete document.documentElement.dataset.film
    this.on = false
  }
}
