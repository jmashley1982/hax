import { store } from '@/core/store'
import { clock } from '@/core/clock'
import { mulberry32 } from '@/core/rng'
import { saveState, type GameState } from '@/core/state'
import type { InteractionMode } from '@/core/events'
import { InputPipeline } from '@/core/input'
import { MODE_PROFILES, computeProgress } from '@/core/progress'
import { Scheduler } from '@/core/scheduler'
import { matchCommand } from '@/sim/commands/registry'
import { buildCommandResponse } from '@/sim/commands/responses'
import { ContentEngine } from '@/content'
import { CrtOverlay } from '@/fx/crt'
import { Terminal } from './terminal'
import { Prompt } from './prompt'

const MODE_CYCLE: readonly InteractionMode[] = ['hybrid', 'chaos', 'intent']

/**
 * Root shell. Boot gate -> CRT terminal + prompt, driven by the Phase 3
 * pipeline: raw input -> InputPipeline (rate limiting + variety) ->
 * ModeProfile coefficients -> Scheduler (paces ambient output, and will
 * host mission beats from Phase 5 onward). Submitted commands go through
 * the keyword router instead of the ambient path, since a typed command is
 * a deliberate act that deserves an immediate, specific response.
 */
export class Shell {
  private content: ContentEngine
  private inputPipeline = new InputPipeline()
  private scheduler: Scheduler
  private booted = false
  private elapsedMs = 0
  private ambientTick = 0
  private statusRight!: HTMLElement

  // Rotating pool of ambient burst sources so sustained CHAOS/HYBRID input
  // escalates through different flavors of chatter instead of settling
  // into one repeated tone.
  private static readonly BURST_SOURCES: ReadonlyArray<readonly [string, string]> = [
    ['netops', 'scanLine'],
    ['kernel', 'dmesg'],
    ['exploit', 'stage'],
    ['crypto', 'decrypt'],
    ['filesystem', 'dirEntry'],
    ['physical', 'scada'],
  ]

  constructor(root: HTMLElement, private state: GameState) {
    const shellEl = document.createElement('div')
    shellEl.className = 'shell'
    root.appendChild(shellEl)

    this.content = new ContentEngine(state.seed)
    // A separate RNG stream (seed+1, not shared with content generation)
    // so scheduler pacing jitter never perturbs which content lines get
    // drawn -- the two systems stay independently deterministic.
    this.scheduler = new Scheduler(mulberry32(state.seed + 1))
    this.scheduler.setAmbientSource(() => this.emitAmbientBeat())
    this.applyModeProfile()

    // Terminal and CrtOverlay wire themselves up via the store's event bus
    // and don't need to be referenced again here yet — Phase 5 (layer
    // transitions) will hold onto the Terminal instance to clear the
    // backlog on descent.
    new Terminal(shellEl)
    new CrtOverlay(shellEl, state.seed)
    new Prompt(
      shellEl,
      (char) => this.handleKey(char),
      (line) => this.handleSubmit(line),
    )

    this.mountStatusBar(shellEl)
    this.mountBootGate(root)
    this.bindModeHotkey()

    store.on('tick', ({ dt }) => this.onTick(dt))
  }

  private mountStatusBar(shellEl: HTMLElement): void {
    const bar = document.createElement('div')
    bar.className = 'statusbar'
    const left = document.createElement('span')
    left.textContent = `SEED ${this.state.seedLabel}`
    this.statusRight = document.createElement('span')
    bar.append(left, this.statusRight)
    shellEl.appendChild(bar)
    this.renderStatusRight()
  }

  private renderStatusRight(): void {
    this.statusRight.textContent =
      `MODE:${this.state.mode.toUpperCase()} [TAB]  THEME:${this.state.theme.toUpperCase()}`
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
      text: 'ready. mash keys, click, or type a command and press enter. [TAB] switches mode.',
      tone: 'success',
      speed: 4,
    })
    store.emit('boot:ready', {})
    this.bindReactiveInput()
  }

  private bindReactiveInput(): void {
    window.addEventListener('pointerdown', (e) => {
      // Ignore clicks on the boot gate / prompt itself; those aren't ambient mashing.
      if ((e.target as HTMLElement)?.closest('.boot-gate')) return
      this.addInputProgress({ kind: 'click', token: 'click' })
    })
  }

  private bindModeHotkey(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return
      e.preventDefault()
      this.cycleMode()
    })
  }

  private cycleMode(): void {
    const idx = MODE_CYCLE.indexOf(this.state.mode)
    const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length] ?? 'hybrid'
    this.state.mode = next
    this.applyModeProfile()
    this.renderStatusRight()
    saveState(this.state)
    store.emit('mode:change', { mode: next })
    store.emit('terminal:line', { text: `-- mode: ${next.toUpperCase()} --`, tone: 'system', speed: 2 })
  }

  private applyModeProfile(): void {
    this.scheduler.setAmbientInterval(MODE_PROFILES[this.state.mode].beatIntervalMs)
  }

  private handleKey(char: string): void {
    this.addInputProgress({ kind: 'key', token: char })
  }

  private handleSubmit(line: string): void {
    const evaluated = this.inputPipeline.push({ kind: 'submit', token: line })
    const match = matchCommand(line)
    const profile = MODE_PROFILES[this.state.mode]
    this.scheduler.addProgress(computeProgress(evaluated, profile) * match.strength)

    for (const responseLine of buildCommandResponse(match, this.content)) {
      store.emit('terminal:line', responseLine)
    }
  }

  private addInputProgress(event: { kind: 'key' | 'click'; token: string }): void {
    const evaluated = this.inputPipeline.push(event)
    const profile = MODE_PROFILES[this.state.mode]
    this.scheduler.addProgress(computeProgress(evaluated, profile))
  }

  private onTick(dt: number): void {
    this.inputPipeline.refill(dt)
    this.elapsedMs += dt
    if (this.booted) this.scheduler.tick(this.elapsedMs)
  }

  private emitAmbientBeat(): void {
    this.ambientTick += 1

    if (this.ambientTick % 11 === 0) {
      store.emit('terminal:line', { text: this.content.line('warnings', 'idsAlert'), tone: 'warning', speed: 4 })
      return
    }
    if (this.ambientTick % 17 === 0) {
      store.emit('terminal:line', { text: this.content.line('dialogue', 'handlerIdle'), tone: 'system', speed: 6 })
      return
    }
    if (this.ambientTick % 5 === 0) {
      const source =
        Shell.BURST_SOURCES[Math.floor(this.ambientTick / 5) % Shell.BURST_SOURCES.length]!
      const [bank, key] = source
      const burstSize = 2 + (this.ambientTick % 3)
      for (let i = 0; i < burstSize; i++) {
        store.emit('terminal:line', { text: this.content.line(bank, key), tone: 'dim', speed: 2 })
      }
      return
    }

    store.emit('terminal:line', { text: this.content.line('flavor', 'ambientChaos'), tone: 'normal', speed: 5 })
  }
}
