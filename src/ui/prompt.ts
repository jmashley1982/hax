/**
 * The typed command line. Global keydown capture (matching the rest of
 * Phase 1/2's approach) rather than a focusable <input> -- keeps behavior
 * consistent with "any keystroke anywhere counts as input" and avoids
 * fighting focus management with the rest of the shell. Proper
 * accessible-input support (mobile virtual keyboards, IME) is future
 * polish, not required for the film-prop / desktop-browser use case this
 * targets first.
 */
/**
 * How long the typed buffer survives without a keystroke before clearing.
 * Without this, mashing in HYBRID builds a several-hundred-character
 * nonsense line that then gets submitted as a "command" -- the buffer has
 * to be a command line for deliberate typing and invisible during mashing.
 */
const BUFFER_IDLE_CLEAR_MS = 1400

/**
 * Hard cap on buffer length. The idle-clear above only fires once typing
 * *stops*, so sustained mashing (no gaps) would grow the buffer without
 * bound and flood the screen with garbage. No real command is anywhere
 * near this long.
 */
const BUFFER_MAX = 64

export class Prompt {
  private el: HTMLElement
  private buffer = ''
  private clearTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    mountPoint: HTMLElement,
    private onKey: (char: string) => void,
    private onSubmit: (line: string) => void,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'prompt'
    mountPoint.appendChild(this.el)
    this.render()

    window.addEventListener('keydown', this.handleKeydown)
  }

  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (e.key === 'Enter') {
      const line = this.buffer.trim()
      this.buffer = ''
      this.render()
      if (line) this.onSubmit(line)
      return
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      this.buffer = this.buffer.slice(0, -1)
      this.render()
      this.onKey('Backspace')
      this.scheduleIdleClear()
      return
    }
    if (e.key.length === 1) {
      // Keep driving panels even past the cap -- only the *display* buffer
      // is bounded, so mashing never stops feeling responsive.
      if (this.buffer.length < BUFFER_MAX) {
        this.buffer += e.key
        this.render()
      }
      this.onKey(e.key)
      this.scheduleIdleClear()
    }
  }

  private scheduleIdleClear(): void {
    if (this.clearTimer) clearTimeout(this.clearTimer)
    this.clearTimer = setTimeout(() => {
      this.buffer = ''
      this.render()
    }, BUFFER_IDLE_CLEAR_MS)
  }

  private render(): void {
    this.el.textContent = `> ${this.buffer}`
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeydown)
  }
}
