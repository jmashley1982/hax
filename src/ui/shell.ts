import { store } from '@/core/store'
import { clock } from '@/core/clock'
import { mulberry32, pick, type Rng } from '@/core/rng'
import { saveState, type GameState } from '@/core/state'
import type { InteractionMode } from '@/core/events'
import { InputPipeline } from '@/core/input'
import { MODE_PROFILES, computeProgress } from '@/core/progress'
import { Scheduler } from '@/core/scheduler'
import { matchCommand } from '@/sim/commands/registry'
import { buildCommandResponse } from '@/sim/commands/responses'
import { HeatSystem } from '@/sim/heat'
import { awardScore } from '@/sim/score'
import { LayerSystem } from '@/sim/layers'
import { ContentEngine } from '@/content'
import { CrtOverlay } from '@/fx/crt'
import { Terminal } from './terminal'
import { Prompt } from './prompt'
import { Hud } from './hud/hud'
import { WindowManager } from './windows/manager'
import { spawnAuthPrompt, spawnChoicePrompt, spawnWarningDialog } from './windows/dialogs'

const MODE_CYCLE: readonly InteractionMode[] = ['hybrid', 'chaos', 'intent']

/** How long after a breakthrough incoming progress is dampened, so the "calm" beat is guaranteed rather than probabilistic. */
const BREAKTHROUGH_GRACE_MS = 3500
const BREAKTHROUGH_GRACE_DAMPEN = 0.15

/**
 * Root shell. Output starts the instant the page loads -- no blocking boot
 * gate (the first playtest found a static title card reads as "broken";
 * see plan §13a). Raw input -> InputPipeline (rate limiting + variety) ->
 * ModeProfile coefficients -> progress, which now feeds TWO places: the
 * ambient Scheduler (paces filler text) and the LayerSystem (breach
 * tension -- the number that actually answers "what am I supposed to be
 * judging"). Ambient pacing, burst size, and popup frequency are all
 * driven by tension, not fixed constants, which is what produces the
 * hectic-then-calm-then-hectic-again rhythm the brief asked for.
 */
export class Shell {
  private content: ContentEngine
  private inputPipeline = new InputPipeline()
  private scheduler: Scheduler
  private windows: WindowManager
  private heat: HeatSystem
  private layers: LayerSystem
  private windowRng: Rng
  private shellEl: HTMLElement
  private elapsedMs = 0
  private ambientTick = 0
  private breakthroughGraceUntil = 0
  private statusRight!: HTMLElement

  constructor(root: HTMLElement, private state: GameState) {
    this.shellEl = document.createElement('div')
    this.shellEl.className = 'shell'
    root.appendChild(this.shellEl)

    this.content = new ContentEngine(state.seed)
    // Separate RNG streams per system (seed+1, seed+2, ...) so scheduler
    // pacing, window placement, and content generation never perturb each
    // other -- each stays independently deterministic for a given seed.
    this.scheduler = new Scheduler(mulberry32(state.seed + 1))
    this.windowRng = mulberry32(state.seed + 2)
    this.scheduler.setAmbientSource(() => this.emitAmbientBeat())

    this.heat = new HeatSystem(state)
    this.layers = new LayerSystem(state)
    this.windows = new WindowManager(this.shellEl, this.windowRng)

    // Terminal and CrtOverlay wire themselves up via the store's event bus
    // and don't need to be referenced again here yet — a future layer-clear
    // pass could hold onto the Terminal instance if we ever want to trim
    // the backlog on descent, but for now the log stays continuous with a
    // banner marking each breakthrough (see handleBreakthrough).
    new Terminal(this.shellEl)
    new CrtOverlay(this.shellEl, state.seed)
    new Prompt(
      this.shellEl,
      (char) => this.handleKey(char),
      (line) => this.handleSubmit(line),
    )
    new Hud(this.shellEl, state, () => this.layers.tension)

    this.mountStatusBar(this.shellEl)
    this.bindReactiveInput()
    this.bindModeHotkey()

    store.on('tick', ({ dt }) => this.onTick(dt))

    clock.start()
    this.runBootSequence()
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

  private runBootSequence(): void {
    const steps = ['bootInit', 'bootKernel', 'bootVolumes', 'bootRelay', 'bootEntropy', 'bootHandshake']
    for (const key of steps) {
      store.emit('terminal:line', { text: this.content.line('flavor', key), tone: 'system', speed: 5 })
    }
    store.emit('terminal:line', { text: '', tone: 'dim', speed: 0 })
    store.emit('terminal:line', {
      text: 'ready. mash keys, click, or type a command and press enter. [TAB] switches mode.',
      tone: 'success',
      speed: 3,
    })
    store.emit('boot:ready', {})
  }

  private bindReactiveInput(): void {
    window.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement
      // Ignore clicks inside a window (dialog buttons/inputs already have their own handlers).
      if (target?.closest('.win')) return
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
    this.renderStatusRight()
    saveState(this.state)
    store.emit('mode:change', { mode: next })
    store.emit('terminal:line', { text: `-- mode: ${next.toUpperCase()} --`, tone: 'system', speed: 2 })
  }

  private handleKey(char: string): void {
    this.addInputProgress({ kind: 'key', token: char })
  }

  private handleSubmit(line: string): void {
    const evaluated = this.inputPipeline.push({ kind: 'submit', token: line })
    const match = matchCommand(line)
    const profile = MODE_PROFILES[this.state.mode]
    this.applyProgress(computeProgress(evaluated, profile) * match.strength)

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
    this.applyProgress(computeProgress(evaluated, profile))
  }

  /** The single place input becomes both ambient-pacing progress and breach tension. */
  private applyProgress(amount: number): void {
    if (amount <= 0) return
    this.scheduler.addProgress(amount)

    const dampen = this.elapsedMs < this.breakthroughGraceUntil ? BREAKTHROUGH_GRACE_DAMPEN : 1
    const crossedThreshold = this.layers.addProgress(amount * dampen)
    if (crossedThreshold) {
      this.handleBreakthrough()
      return
    }

    const profile = MODE_PROFILES[this.state.mode]
    if (profile.demandsEnabled && this.layers.checkDemandTrigger() && !this.windows.hasModal) {
      if (pick(this.windowRng, [true, false])) this.spawnAuthDemand()
      else this.spawnChoiceDemand()
    }
  }

  private onTick(dt: number): void {
    this.inputPipeline.refill(dt)
    this.elapsedMs += dt
    this.scheduler.setAmbientInterval(this.computeAmbientInterval())
    this.scheduler.tick(this.elapsedMs)

    const heatEvents = this.heat.tick(dt)
    if (heatEvents.warn) this.onHeatWarn()
    if (heatEvents.critical) this.onHeatCritical()
  }

  /** Ambient pacing tightens as breach tension climbs -- the "hectic and complex" build-up. */
  private computeAmbientInterval(): readonly [number, number] {
    const [lo, hi] = MODE_PROFILES[this.state.mode].beatIntervalMs
    const speedup = 1 - Math.min(0.65, this.layers.tension * 0.55)
    return [Math.max(140, lo * speedup), Math.max(260, hi * speedup)]
  }

  // -- Breakthrough ------------------------------------------------------

  private handleBreakthrough(): void {
    const clearedLayer = this.layers.current
    this.shellEl.classList.add('is-breaching')
    setTimeout(() => this.shellEl.classList.remove('is-breaching'), 400)

    store.emit('terminal:line', {
      text: `==== BREACH: ${clearedLayer.title} LAYER CLEARED ====`,
      tone: 'success',
      speed: 1,
    })
    const [breachBank, breachKey] = clearedLayer.breachBank
    for (let i = 0; i < 4; i++) {
      store.emit('terminal:line', { text: this.content.line(breachBank, breachKey), tone: 'success', speed: 1 })
    }

    awardScore(this.state, 150)
    this.heat.add(-25)

    const next = this.layers.breakthrough()
    this.breakthroughGraceUntil = this.elapsedMs + BREAKTHROUGH_GRACE_MS

    store.emit('terminal:line', {
      text: `-- descending to ${next.title} --`,
      tone: 'system',
      speed: 4,
    })
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
    // A spectacular setback, never a real cost (plan §13a follow-up: "not
    // hard... no popup should feel like it might genuinely be lost"): a
    // countermeasure burst and a heat reset, but no score penalty. The
    // drama carries the tension, not a punishing number.
    spawnWarningDialog(this.windows, {
      title: 'TRACE IN PROGRESS',
      message: this.content.line('warnings', 'traceWarning'),
      ttlMs: 3200,
    })
    for (let i = 0; i < 3; i++) {
      store.emit('terminal:line', { text: this.content.line('warnings', 'countermeasure'), tone: 'danger', speed: 2 })
    }
    this.heat.resetAfterCountermeasure()
    setTimeout(() => {
      store.emit('terminal:line', { text: this.content.line('dialogue', 'taunt'), tone: 'system', speed: 4 })
    }, 900)
  }

  // -- Decision popups, now progress-driven (see LayerSystem.checkDemandTrigger) --

  private static readonly AUTH_FRAMINGS = [
    (flavor: string) => `The ${flavor} wants a credential before it'll let you through.`,
    (flavor: string) => `Access to the ${flavor} is gated behind an active session key.`,
    (flavor: string) => `The ${flavor} is demanding authentication.`,
  ]

  private spawnAuthDemand(): void {
    const layer = this.layers.current
    const framing = pick(this.windowRng, Shell.AUTH_FRAMINGS)
    spawnAuthPrompt(this.windows, {
      title: `${layer.title} :: ACCESS CONTROL`,
      prompt: framing(layer.demandFlavor),
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

  private static readonly CHOICE_FRAMINGS = [
    (flavor: string) => `The ${flavor} noticed something. Pick an approach.`,
    (flavor: string) => `You've got one shot at the ${flavor} before it logs this.`,
    (flavor: string) => `The ${flavor} is asking questions. How do you respond?`,
  ]

  private spawnChoiceDemand(): void {
    const layer = this.layers.current
    const framing = pick(this.windowRng, Shell.CHOICE_FRAMINGS)
    spawnChoicePrompt(this.windows, {
      title: `${layer.title} :: DECISION`,
      prompt: framing(layer.demandFlavor),
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

  // -- Ambient filler ------------------------------------------------------

  private emitAmbientBeat(): void {
    this.ambientTick += 1
    const tension = this.layers.tension

    if (this.ambientTick % 11 === 0) {
      store.emit('terminal:line', { text: this.content.line('warnings', 'idsAlert'), tone: 'warning', speed: 4 })
      return
    }
    if (this.ambientTick % 17 === 0) {
      store.emit('terminal:line', { text: this.content.line('dialogue', 'handlerIdle'), tone: 'system', speed: 6 })
      return
    }
    if (this.ambientTick % 4 === 0) {
      const sources = this.layers.current.burstSources
      const [bank, key] = sources[this.ambientTick % sources.length]!
      // Burst size scales with tension -- part of the "hectic and complex" build-up.
      const burstSize = 2 + Math.floor(tension * 4)
      for (let i = 0; i < burstSize; i++) {
        store.emit('terminal:line', { text: this.content.line(bank, key), tone: 'dim', speed: 2 })
      }
      awardScore(this.state, 2)
      return
    }

    store.emit('terminal:line', { text: this.content.line('flavor', 'ambientChaos'), tone: 'normal', speed: 5 })
  }
}
