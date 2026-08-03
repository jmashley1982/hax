import { store } from '@/core/store'
import type { TerminalLine } from '@/core/events'

/**
 * Streaming terminal renderer. Lines queue up and type out character by
 * character (typewriter), then join a capped, DOM-recycled backlog.
 *
 * Backlog is capped (see MAX_LINES) and old nodes are removed from the
 * DOM outright rather than just hidden — long CHAOS-mashing sessions must
 * not accumulate thousands of live nodes (see plan §12, performance risk).
 */

const MAX_LINES = 400
const DEFAULT_SPEED = 8 // ms per character

/**
 * When the queue backs up beyond this many pending lines, the whole
 * backlog prints instantly instead of animating (see the sticky
 * `catchingUp` flag in drain()). Without this, a CHAOS mash spree queues
 * output faster than the typewriter can draw it, and the terminal visibly
 * falls seconds behind the input that caused it — the opposite of "the
 * screen reacts." Real terminals do the same thing: output that arrives
 * faster than it can be drawn just dumps to the screen.
 *
 * Kept comfortably above the boot sequence's line count (8) and a single
 * ambient burst (2-4 lines) so those still type out properly -- this only
 * engages once *sustained* mashing has genuinely outpaced rendering.
 */
const CATCH_UP_THRESHOLD = 14

interface QueuedLine extends TerminalLine {}

export class Terminal {
  private root: HTMLElement
  private backlog: HTMLElement
  private queue: QueuedLine[] = []
  private typing = false
  private catchingUp = false
  private lineEls: HTMLElement[] = []

  constructor(mountPoint: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'terminal'
    this.backlog = document.createElement('div')
    this.backlog.className = 'terminal__backlog'
    this.root.appendChild(this.backlog)
    mountPoint.appendChild(this.root)

    store.on('terminal:line', (line) => this.enqueue(line))
    store.on('terminal:clear', () => this.clear())
  }

  enqueue(line: TerminalLine): void {
    this.queue.push(line)
    if (!this.typing) void this.drain()
  }

  /** Instantly print without the typewriter effect (used for bursts). */
  printInstant(line: TerminalLine): void {
    this.appendLineElement(line.text, line.tone)
  }

  clear(): void {
    this.queue = []
    this.backlog.innerHTML = ''
    this.lineEls = []
  }

  private async drain(): Promise<void> {
    this.typing = true
    while (this.queue.length > 0) {
      // Sticky, not a live per-line recheck: once the backlog is deep
      // enough to trigger catch-up, stay in catch-up until the queue is
      // fully empty. A live recheck flickers on/off as the count crosses
      // the threshold line by line, which reads as the terminal randomly
      // deciding some lines deserve a typewriter and others don't.
      if (this.queue.length > CATCH_UP_THRESHOLD) this.catchingUp = true
      const line = this.queue.shift()!
      await this.typeLine(line)
    }
    this.catchingUp = false
    this.typing = false
  }

  private typeLine(line: TerminalLine): Promise<void> {
    return new Promise((resolve) => {
      const el = this.appendLineElement('', line.tone)
      const speed = this.catchingUp ? 0 : (line.speed ?? DEFAULT_SPEED)
      if (speed <= 0) {
        el.textContent = line.text
        this.scrollToBottom()
        resolve()
        return
      }
      let i = 0
      const step = () => {
        i += 1
        el.textContent = line.text.slice(0, i)
        this.scrollToBottom()
        if (i < line.text.length) {
          setTimeout(step, speed)
        } else {
          resolve()
        }
      }
      step()
    })
  }

  private appendLineElement(text: string, tone: TerminalLine['tone']): HTMLElement {
    const el = document.createElement('div')
    el.className = `term-line term-line--${tone}`
    el.textContent = text
    this.backlog.appendChild(el)
    this.lineEls.push(el)
    if (this.lineEls.length > MAX_LINES) {
      const excess = this.lineEls.length - MAX_LINES
      for (let i = 0; i < excess; i++) {
        this.lineEls[i]?.remove()
      }
      this.lineEls = this.lineEls.slice(excess)
    }
    return el
  }

  private scrollToBottom(): void {
    this.root.scrollTop = this.root.scrollHeight
  }
}
