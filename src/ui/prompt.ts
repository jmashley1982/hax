/**
 * The command line.
 *
 * It never echoes raw keystrokes. Mashing "adfjkl" and seeing "adfjkl"
 * appear destroys the illusion instantly, so instead each keystroke
 * reveals one more character of a *generated* shell command (see
 * content/banks/shell.ts). Hammering the keyboard therefore reads as a
 * hacker typing fast, and when a command finishes revealing it "runs":
 * it prints to the terminal and a fresh one starts.
 *
 * A hidden buffer still records what was actually typed, so deliberately
 * typing a real keyword ("scan", "exploit") is matched by the command
 * router exactly as before -- the player gets the hacker-jargon look
 * without losing intentional play.
 */

/** Clears the hidden intent buffer once typing stops, so mashing never accumulates into a bogus "command". */
const INTENT_IDLE_CLEAR_MS = 1200

export interface PromptCallbacks {
  onKey: (char: string) => void
  /** Fired when a deliberate typed word is submitted with Enter. */
  onSubmit: (line: string) => void
  /** Fired when a generated command finishes revealing itself. */
  onCommandRun: (text: string) => void
  /** Supplies the next generated command line. */
  nextCommand: () => string
}

export class Prompt {
  private el: HTMLElement
  private ghost: string
  private revealed = 0
  private intentBuffer = ''
  private clearTimer: ReturnType<typeof setTimeout> | null = null

  constructor(mountPoint: HTMLElement, private cb: PromptCallbacks) {
    this.el = document.createElement('div')
    this.el.className = 'prompt'
    mountPoint.appendChild(this.el)
    this.ghost = cb.nextCommand()
    this.render()

    window.addEventListener('keydown', this.handleKeydown)
  }

  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (e.key === 'Enter') {
      const intent = this.intentBuffer.trim()
      this.intentBuffer = ''
      // Enter completes the current command line immediately.
      this.runGhost()
      if (intent) this.cb.onSubmit(intent)
      return
    }

    if (e.key === 'Backspace') {
      e.preventDefault()
      this.intentBuffer = this.intentBuffer.slice(0, -1)
      this.cb.onKey('Backspace')
      this.scheduleIdleClear()
      return
    }

    if (e.key.length === 1) {
      this.intentBuffer += e.key
      // Reveal several characters per keystroke so a command completes in
      // a satisfying handful of presses rather than dozens.
      this.revealed = Math.min(this.ghost.length, this.revealed + 3)
      this.render()
      this.cb.onKey(e.key)
      this.scheduleIdleClear()
      if (this.revealed >= this.ghost.length) this.runGhost()
    }
  }

  /** Print the finished command and start a fresh one. */
  private runGhost(): void {
    const text = this.ghost
    if (this.revealed > 0) this.cb.onCommandRun(text)
    this.ghost = this.cb.nextCommand()
    this.revealed = 0
    this.render()
  }

  private scheduleIdleClear(): void {
    if (this.clearTimer) clearTimeout(this.clearTimer)
    this.clearTimer = setTimeout(() => {
      this.intentBuffer = ''
    }, INTENT_IDLE_CLEAR_MS)
  }

  private render(): void {
    this.el.textContent = `> ${this.ghost.slice(0, this.revealed)}`
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeydown)
    if (this.clearTimer) clearTimeout(this.clearTimer)
  }
}
