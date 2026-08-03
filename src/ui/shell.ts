import { store } from '@/core/store'
import { clock } from '@/core/clock'
import { mulberry32, chance, int, type Rng } from '@/core/rng'
import { saveState, type GameState } from '@/core/state'
import type { InteractionMode } from '@/core/events'
import { InputPipeline } from '@/core/input'
import { MODE_PROFILES, computeProgress } from '@/core/progress'
import { Scheduler } from '@/core/scheduler'
import { matchCommand } from '@/sim/commands/registry'
import { buildCommandResponse } from '@/sim/commands/responses'
import { HeatSystem } from '@/sim/heat'
import { awardScore } from '@/sim/score'
import { ContentEngine } from '@/content'
import { CrtOverlay } from '@/fx/crt'
import { Terminal } from './terminal'
import { Prompt } from './prompt'
import { Hud } from './hud/hud'
import { WindowManager } from './windows/manager'
import { spawnAuthPrompt, spawnChoicePrompt, spawnWarningDialog } from './windows/dialogs'

const MODE_CYCLE: readonly InteractionMode[] = ['hybrid', 'chaos', 'intent']

/**
 * Root shell. Boot gate -> CRT terminal + prompt + HUD + window layer,
 * driven by the Phase 3 pipeline: raw input -> InputPipeline (rate
 * limiting + variety) -> ModeProfile coefficients -> Scheduler (paces
 * ambient output). Submitted commands go through the keyword router.
 * Phase 4 adds: floating windows (auth prompts, choice dialogs, warnings),
 * the heat meter with its own escalation, and score.
 */
export class Shell {
  private content: ContentEngine
  private inputPipeline = new InputPipeline()
  private scheduler: Scheduler
  private windows: WindowManager
  private heat: HeatSystem
  private windowRng: Rng
  private booted = false
  private elapsedMs = 0
  private ambientTick = 0
  private nextDemandAt = 0
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
    // Separate RNG streams per system (seed+1, seed+2, ...) so scheduler
    // pacing, window placement, and content generation never perturb each
    // other -- each stays independently deterministic for a given seed.
    this.scheduler = new Scheduler(mulberry32(state.seed + 1))
    this.windowRng = mulberry32(state.seed + 2)
    this.scheduler.setAmbientSource(() => this.emitAmbientBeat())
    this.applyModeProfile()

    this.heat = new HeatSystem(state)
    this.windows = new WindowManager(shellEl, this.windowRng)

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
    new Hud(shellEl, state)

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
    this.scheduleNextDemand()
    this.bindReactiveInput()
  }

  private bindReactiveInput(): void {
    window.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement
      // Ignore clicks on the boot gate, or on anything inside a window
      // (dialog buttons/inputs already have their own handlers) -- those
      // aren't ambient mashing.
      if (target?.closest('.boot-gate') || target?.closest('.win')) return
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

    const scoreByTier: Record<string, number> = { exact: 40, fuzzy: 20, thematic: 8, nonsense: 0 }
    awardScore(this.state, scoreByTier[match.tier] ?? 0)
    if (match.tier === 'nonsense') this.heat.add(1.5)

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
    if (!this.booted) return
    this.elapsedMs += dt
    this.scheduler.tick(this.elapsedMs)

    const heatEvents = this.heat.tick(dt)
    if (heatEvents.warn) this.onHeatWarn()
    if (heatEvents.critical) this.onHeatCritical()

    this.maybeSpawnDemand()
  }

  // -- Heat escalation -------------------------------------------------

  private onHeatWarn(): void {
    spawnWarningDialog(this.windows, {
      title: 'IDS NOTICE',
      message: this.content.line('warnings', 'idsAlert'),
      ttlMs: 4500,
    })
  }

  private onHeatCritical(): void {
    // A spectacular setback, never a dead end (plan §12): a countermeasure
    // burst, a heat reset, a small score cost. The player is never blocked
    // from continuing.
    spawnWarningDialog(this.windows, {
      title: 'TRACE IN PROGRESS',
      message: this.content.line('warnings', 'traceWarning'),
      ttlMs: 3200,
    })
    for (let i = 0; i < 3; i++) {
      store.emit('terminal:line', { text: this.content.line('warnings', 'countermeasure'), tone: 'danger', speed: 2 })
    }
    awardScore(this.state, -80)
    this.heat.resetAfterCountermeasure()
    setTimeout(() => {
      store.emit('terminal:line', { text: this.content.line('dialogue', 'taunt'), tone: 'system', speed: 4 })
    }, 900)
  }

  // -- Periodic decision popups (HYBRID's defining feature) ------------

  private scheduleNextDemand(): void {
    const profile = MODE_PROFILES[this.state.mode]
    if (!profile.demandIntervalMs) return
    const [lo, hi] = profile.demandIntervalMs
    this.nextDemandAt = this.elapsedMs + int(this.windowRng, lo, hi)
  }

  private maybeSpawnDemand(): void {
    const profile = MODE_PROFILES[this.state.mode]
    if (!profile.demandIntervalMs) return
    if (this.windows.hasModal) return
    if (this.elapsedMs < this.nextDemandAt) return

    if (chance(this.windowRng, 0.5)) this.spawnAuthDemand()
    else this.spawnChoiceDemand()
    this.scheduleNextDemand()
  }

  private spawnAuthDemand(): void {
    spawnAuthPrompt(this.windows, {
      title: 'ACCESS CONTROL',
      prompt: 'Gateway requires an access code to continue.',
      hint: this.content.line('crypto', 'keyHint'),
      timeoutMs: 14000,
      onResult: (result) => {
        if (result === 'accept') {
          awardScore(this.state, 60)
          this.heat.add(-4)
          store.emit('terminal:line', { text: this.content.line('flavor', 'ambientSuccess'), tone: 'success', speed: 3 })
        } else if (result === 'timeout') {
          this.heat.add(10)
          store.emit('terminal:line', { text: this.content.line('warnings', 'systemDenial'), tone: 'warning', speed: 3 })
        } else {
          this.heat.add(3)
          store.emit('terminal:line', { text: '> gateway attempt aborted', tone: 'dim', speed: 3 })
        }
      },
    })
  }

  private spawnChoiceDemand(): void {
    spawnChoicePrompt(this.windows, {
      title: 'DECISION REQUIRED',
      prompt: this.content.line('dialogue', 'handlerBrief'),
      timeoutMs: 12000,
      options: [
        {
          label: 'Push through (fast, loud)',
          onSelect: () => {
            awardScore(this.state, 35)
            this.heat.add(12)
            store.emit('terminal:line', { text: this.content.line('exploit', 'stage'), tone: 'normal', speed: 2 })
          },
        },
        {
          label: 'Work around it (slow, quiet)',
          onSelect: () => {
            awardScore(this.state, 55)
            this.heat.add(-6)
            store.emit('terminal:line', { text: this.content.line('crypto', 'decrypt'), tone: 'normal', speed: 2 })
          },
        },
        {
          label: 'Abort this approach',
          onSelect: () => {
            this.heat.add(-10)
            store.emit('terminal:line', { text: '> withdrawing from this vector', tone: 'dim', speed: 3 })
          },
        },
      ],
      onTimeout: () => {
        this.heat.add(8)
        store.emit('terminal:line', { text: this.content.line('warnings', 'systemDenial'), tone: 'warning', speed: 3 })
      },
    })
  }

  // -- Ambient filler ----------------------------------------------------

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
      awardScore(this.state, 2)
      return
    }

    store.emit('terminal:line', { text: this.content.line('flavor', 'ambientChaos'), tone: 'normal', speed: 5 })
  }
}
