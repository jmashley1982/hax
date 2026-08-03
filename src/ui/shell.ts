import { store } from '@/core/store'
import { clock } from '@/core/clock'
import type { GameState } from '@/core/state'
import { ContentEngine } from '@/content'
import { CrtOverlay } from '@/fx/crt'
import { Terminal } from './terminal'

/**
 * Root shell for Phase 1: boot gate -> CRT terminal that reacts to any
 * keypress or click with generated output.
 *
 * The input handling here is intentionally simple (every raw input maps
 * to a line, occasionally a burst). Phase 3 replaces this with the real
 * input pipeline (core/input.ts + core/progress.ts) driven by mode
 * profiles (CHAOS/INTENT/HYBRID) and a beat scheduler — this is the seam
 * that gets generalized, not thrown away.
 */
export class Shell {
  private content: ContentEngine
  private inputCount = 0
  private booted = false

  constructor(root: HTMLElement, private state: GameState) {
    const shellEl = document.createElement('div')
    shellEl.className = 'shell'
    root.appendChild(shellEl)

    this.content = new ContentEngine(state.seed)
    // Terminal and CrtOverlay wire themselves up via the store's event bus
    // and don't need to be referenced again here yet — Phase 5 (layer
    // transitions) will hold onto the Terminal instance to clear the
    // backlog on descent.
    new Terminal(shellEl)
    new CrtOverlay(shellEl, state.seed)

    this.mountStatusBar(shellEl)
    this.mountBootGate(root)
  }

  private mountStatusBar(shellEl: HTMLElement): void {
    const bar = document.createElement('div')
    bar.className = 'statusbar'
    const left = document.createElement('span')
    left.textContent = `SEED ${this.state.seedLabel}`
    const right = document.createElement('span')
    right.textContent = `MODE:${this.state.mode.toUpperCase()}  THEME:${this.state.theme.toUpperCase()}`
    bar.append(left, right)
    shellEl.appendChild(bar)
  }

  private mountBootGate(root: HTMLElement): void {
    const gate = document.createElement('div')
    gate.className = 'boot-gate'
    const title = document.createElement('div')
    title.className = 'boot-gate__title'
    title.textContent = 'NULLSTACK'
    const hint = document.createElement('div')
    hint.className = 'boot-gate__hint'
    hint.textContent = '[ PRESS ANY KEY OR CLICK TO INITIALIZE ]'
    gate.append(title, hint)
    root.appendChild(gate)

    const begin = () => {
      if (this.booted) return
      this.booted = true
      gate.classList.add('is-leaving')
      setTimeout(() => gate.remove(), 320)
      this.runBootSequence()
    }

    gate.addEventListener('click', begin, { once: true })
    window.addEventListener('keydown', begin, { once: true })
  }

  private runBootSequence(): void {
    clock.start()
    const steps = ['bootInit', 'bootKernel', 'bootVolumes', 'bootRelay', 'bootEntropy', 'bootHandshake']
    for (const key of steps) {
      store.emit('terminal:line', { text: this.content.line('flavor', key), tone: 'system', speed: 6 })
    }
    store.emit('terminal:line', { text: '', tone: 'dim', speed: 0 })
    store.emit('terminal:line', {
      text: 'ready. mash keys or click anywhere.',
      tone: 'success',
      speed: 4,
    })
    store.emit('boot:ready', {})
    this.bindReactiveInput()
  }

  private bindReactiveInput(): void {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      this.reactToInput()
    })
    window.addEventListener('pointerdown', () => this.reactToInput())
  }

  // Rotating pool of "burst" sources so sustained mashing escalates through
  // different flavors of chatter instead of reading as one repeated tick.
  // Phase 3 replaces this whole reactive-input path with the real
  // scheduler-driven pipeline; this list of banks carries over into it.
  private static readonly BURST_SOURCES: ReadonlyArray<readonly [string, string]> = [
    ['netops', 'scanLine'],
    ['kernel', 'dmesg'],
    ['exploit', 'stage'],
    ['crypto', 'decrypt'],
    ['filesystem', 'dirEntry'],
    ['physical', 'scada'],
  ]

  private reactToInput(): void {
    this.inputCount += 1

    // Every ~5th input, fire a short burst from a rotating source bank.
    if (this.inputCount % 5 === 0) {
      const source = Shell.BURST_SOURCES[Math.floor(this.inputCount / 5) % Shell.BURST_SOURCES.length]!
      const [bank, key] = source
      const burstSize = 3 + (this.inputCount % 3)
      for (let i = 0; i < burstSize; i++) {
        store.emit('terminal:line', { text: this.content.line(bank, key), tone: 'dim', speed: 2 })
      }
      return
    }

    // Occasionally surface a warning or handler aside instead of plain
    // ambient chatter -- keeps the default (unfocused) mashing experience
    // from settling into a single tone.
    if (this.inputCount % 11 === 0) {
      store.emit('terminal:line', {
        text: this.content.line('warnings', 'idsAlert'),
        tone: 'warning',
        speed: 4,
      })
      return
    }
    if (this.inputCount % 17 === 0) {
      store.emit('terminal:line', {
        text: this.content.line('dialogue', 'handlerIdle'),
        tone: 'system',
        speed: 6,
      })
      return
    }

    store.emit('terminal:line', {
      text: this.content.line('flavor', 'ambientChaos'),
      tone: 'normal',
      speed: 5,
    })
  }
}
