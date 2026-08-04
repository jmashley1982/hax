/**
 * The "what are we hacking?" prompt (plan §15A).
 *
 * Deliberately NOT a boot gate: the board is already spawning panels and
 * the terminal is already streaming behind this overlay when it appears
 * (Shell mounts it after seeding the board, same as every other window).
 * §13a's very first bug was a blocking screen the player could miss and
 * be stuck on -- this must never become that again, so it auto-dismisses
 * on its own after a stretch of no interaction, same as it would if the
 * player just clicked SKIP.
 */

const AUTO_DISMISS_MS = 12_000
// A hard ceiling independent of the idle timer above. The idle timer resets
// on every keystroke into the input -- which is fine for someone deliberately
// typing a URL, but a player who starts mashing keys the instant the game
// loads (the CHAOS-mode default) would keep re-arming it forever, stuck on
// this overlay with the whole board frozen behind it -- the exact class of
// bug that made §13a's boot gate unacceptable. This fires regardless of
// activity, so worst case the overlay is gone in HARD_CAP_MS no matter what.
const HARD_CAP_MS = 20_000

export interface StartOverlayOptions {
  onSubmit: (url: string) => void
  onSkip: () => void
  /** Overrides the heading -- lets a post-breach re-prompt read as a new contract. */
  title?: string
}

export class StartOverlay {
  private el: HTMLElement
  private dismissTimer: ReturnType<typeof setTimeout>
  private hardCapTimer: ReturnType<typeof setTimeout>
  private dismissed = false

  constructor(mount: HTMLElement, private opts: StartOverlayOptions) {
    this.el = document.createElement('div')
    this.el.className = 'start-overlay'

    const box = document.createElement('div')
    box.className = 'start-overlay__box'

    const title = document.createElement('div')
    title.className = 'start-overlay__title'
    title.textContent = opts.title ?? 'SELECT TARGET'

    const sub = document.createElement('p')
    sub.className = 'start-overlay__sub'
    sub.textContent = "Enter a real site's URL to break into it specifically, or skip for a random target."

    const input = document.createElement('input')
    input.className = 'start-overlay__input win__input'
    input.type = 'text'
    input.placeholder = 'e.g. netflix.com'
    input.autocomplete = 'off'
    input.spellcheck = false
    // Every keystroke here must never reach the global prompt/mode-hotkey
    // listeners (ui/prompt.ts, shell.ts's Tab handler both bind on
    // `window`) -- without this, typing a URL would simultaneously feed
    // mashing progress and cycle interaction modes.
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      this.resetDismissTimer()
      if (e.key === 'Enter') this.submit(input.value)
    })
    input.addEventListener('input', () => this.resetDismissTimer())

    const row = document.createElement('div')
    row.className = 'start-overlay__row'
    const goBtn = document.createElement('button')
    goBtn.className = 'win__btn'
    goBtn.textContent = 'BREACH'
    goBtn.addEventListener('click', () => this.submit(input.value))
    const skipBtn = document.createElement('button')
    skipBtn.className = 'win__btn win__btn--ghost'
    skipBtn.textContent = 'RANDOM TARGET'
    skipBtn.addEventListener('click', () => this.skip())
    row.append(goBtn, skipBtn)

    box.append(title, sub, input, row)
    this.el.appendChild(box)
    mount.appendChild(this.el)

    setTimeout(() => input.focus(), 60)
    this.dismissTimer = setTimeout(() => this.skip(), AUTO_DISMISS_MS)
    this.hardCapTimer = setTimeout(() => this.skip(), HARD_CAP_MS)
  }

  private resetDismissTimer(): void {
    clearTimeout(this.dismissTimer)
    this.dismissTimer = setTimeout(() => this.skip(), AUTO_DISMISS_MS)
  }

  private submit(value: string): void {
    if (this.dismissed) return
    const trimmed = value.trim()
    if (!trimmed) {
      this.skip()
      return
    }
    this.dismissed = true
    clearTimeout(this.dismissTimer)
    clearTimeout(this.hardCapTimer)
    this.close()
    this.opts.onSubmit(trimmed)
  }

  private skip(): void {
    if (this.dismissed) return
    this.dismissed = true
    clearTimeout(this.dismissTimer)
    clearTimeout(this.hardCapTimer)
    this.close()
    this.opts.onSkip()
  }

  private close(): void {
    this.el.classList.add('is-closing')
    setTimeout(() => this.el.remove(), 220)
  }
}
