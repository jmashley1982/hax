/**
 * The typed command line. Global keydown capture (matching the rest of
 * Phase 1/2's approach) rather than a focusable <input> -- keeps behavior
 * consistent with "any keystroke anywhere counts as input" and avoids
 * fighting focus management with the rest of the shell. Proper
 * accessible-input support (mobile virtual keyboards, IME) is future
 * polish, not required for the film-prop / desktop-browser use case this
 * targets first.
 */
export class Prompt {
  private el: HTMLElement
  private buffer = ''

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
      return
    }
    if (e.key.length === 1) {
      this.buffer += e.key
      this.render()
      this.onKey(e.key)
    }
  }

  private render(): void {
    this.el.textContent = `> ${this.buffer}`
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeydown)
  }
}
