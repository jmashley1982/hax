import { store } from '@/core/store'
import { clock } from '@/core/clock'
import { mulberry32, type Rng } from '@/core/rng'
import { saveState, type GameState } from '@/core/state'
import type { InteractionMode } from '@/core/events'
import { InputPipeline } from '@/core/input'
import { MODE_PROFILES, computeProgress } from '@/core/progress'
import { matchCommand } from '@/sim/commands/registry'
import { buildCommandResponse } from '@/sim/commands/responses'
import { HeatSystem } from '@/sim/heat'
import { awardScore } from '@/sim/score'
import { LayerSystem } from '@/sim/layers'
import { Director } from '@/sim/director'
import { ContentEngine } from '@/content'
import { CrtOverlay } from '@/fx/crt'
import { Terminal } from './terminal'
import { Prompt } from './prompt'
import { Hud } from './hud/hud'
import { ObjectiveBar } from './hud/objective'
import { WindowManager } from './windows/manager'
import { spawnWarningDialog } from './windows/dialogs'
import { BruteForcePanel } from './panels/bruteForce'
import { TraceDefensePanel } from './panels/traceDefense'
import { PANEL_LABELS } from './panels/registry'
import { applyLayerPalette } from '@/themes/themes'
import type { TaskPanel } from './panels/panel'

const MODE_CYCLE: readonly InteractionMode[] = ['hybrid', 'chaos', 'intent']
const BREAKTHROUGH_GRACE_MS = 2500

/**
 * Root shell -- now a thin wiring layer over the panel desktop.
 *
 * The previous version emitted ambient text on a timer and fed input into
 * an invisible counter, which is why it read as a video (plan §13c). Now:
 * the Director keeps live interactive panels on screen, every input is
 * routed at a *specific* panel, and clearing panels is the only thing that
 * advances the layer. The terminal survives as a background texture strip,
 * not the main event.
 */
export class Shell {
  private content: ContentEngine
  private inputPipeline = new InputPipeline()
  private windows: WindowManager
  private heat: HeatSystem
  private layers: LayerSystem
  private director: Director
  private objective: ObjectiveBar
  private rng: Rng
  private shellEl: HTMLElement
  private elapsedMs = 0
  private breakthroughGraceUntil = 0
  private targetPanel: TaskPanel | null = null
  private statusRight!: HTMLElement

  constructor(root: HTMLElement, private state: GameState) {
    this.shellEl = document.createElement('div')
    this.shellEl.className = 'shell'
    root.appendChild(this.shellEl)

    this.content = new ContentEngine(state.seed)
    this.rng = mulberry32(state.seed + 1)

    this.heat = new HeatSystem(state)
    this.layers = new LayerSystem(state)
    this.windows = new WindowManager(this.shellEl, mulberry32(state.seed + 2))

    new Terminal(this.shellEl)
    new CrtOverlay(this.shellEl, state.seed)
    new Prompt(this.shellEl, {
      onKey: (char) => this.handleKey(char),
      onSubmit: (line) => this.handleSubmit(line),
      // A finished generated command prints to the terminal as if it ran,
      // so mashing produces a stream of plausible shell history.
      onCommandRun: (text) => {
        store.emit('terminal:line', { text: `$ ${text}`, tone: 'system', speed: 0 })
        store.emit('terminal:line', {
          text: this.content.line(...this.layers.current.burstSources[0]!),
          tone: 'dim',
          speed: 0,
        })
      },
      nextCommand: () => this.content.line('shell', 'cmd'),
    })
    new Hud(this.shellEl, state, () => this.layers.tension)
    this.objective = new ObjectiveBar(this.shellEl)

    this.director = new Director(
      this.windows,
      state,
      this.layers,
      this.rng,
      (panel) => this.onPanelComplete(panel),
      (panel, delta) => this.onPanelProgress(panel, delta),
    )

    this.mountStatusBar(this.shellEl)
    this.bindTargeting()
    this.bindModeHotkey()

    store.on('tick', ({ dt }) => this.onTick(dt))

    clock.start()
    this.runBootSequence()

    // Seed the board immediately so there is something to act on the
    // instant the page loads -- no empty screen, ever.
    this.director.spawn()
    this.director.spawn()
    this.director.spawn()
    this.refreshTarget()
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
    for (const key of ['bootInit', 'bootKernel', 'bootRelay', 'bootHandshake']) {
      store.emit('terminal:line', { text: this.content.line('flavor', key), tone: 'system', speed: 4 })
    }
  }

  /** Clicking any panel makes it the target -- that's what mashing then drives. */
  private bindTargeting(): void {
    this.shellEl.addEventListener('pointerdown', (e) => {
      const winEl = (e.target as HTMLElement)?.closest('.panel') as HTMLElement | null
      if (!winEl) return
      const id = winEl.dataset.panelId
      const panel = this.director.activePanels.find((p) => p.id === id)
      if (panel) this.setTarget(panel)
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
  }

  private setTarget(panel: TaskPanel | null): void {
    if (this.targetPanel === panel) return
    this.targetPanel?.setTargeted(false)
    this.targetPanel = panel
    panel?.setTargeted(true)
    this.renderObjective()
  }

  /**
   * Keep focus on something the player can actually act on.
   *
   * This used to only re-target when the current panel *completed*, which
   * worked early on (panels finish fast) but broke in the deeper layers:
   * focus would settle on a sealed or finished panel, mashing would land
   * on something that couldn't advance, and the player was forced to click
   * around to keep going. Now anything unworkable is skipped, so typing
   * never stalls.
   */
  private refreshTarget(): void {
    const workable = (p: TaskPanel): boolean => !p.isDone && !p.isSealed
    if (this.targetPanel && workable(this.targetPanel)) return

    const next =
      this.director.activePanels.find(workable) ??
      // Everything is sealed -- fall back to any live panel so mashing can
      // break a seal rather than hitting a dead end.
      this.director.activePanels.find((p) => !p.isDone) ??
      null
    this.setTarget(next)
  }

  private renderObjective(): void {
    if (!this.targetPanel) {
      this.objective.set('scanning for targets...')
      return
    }
    this.objective.set(this.targetPanel.objectiveText)
  }

  // -- Input -------------------------------------------------------------

  /**
   * Every keystroke drives the *targeted panel*. This is the core fix for
   * "my inputs feel like they have zero meaning" -- a keypress now has a
   * specific, visible destination instead of an invisible counter.
   */
  private handleKey(char: string): void {
    this.inputPipeline.push({ kind: 'key', token: char })

    const profile = MODE_PROFILES[this.state.mode]
    // INTENT mode keeps keystrokes inert (commands only) -- unchanged.
    if (profile.keyGain <= 0) return

    this.refreshTarget()
    const target = this.targetPanel
    if (!target) return

    // A sealed panel spends the keystroke breaking its seal, so mashing
    // never dead-ends and the player never has to stop to click.
    if (target.isSealed) {
      target.breakSealFromInput()
      return
    }

    // If the focused panel can't use this keystroke right now (mid-flip,
    // nothing left to reveal), roll it on to the next panel that can. This
    // is what keeps focus flowing on its own instead of the player having
    // to click around, and it guarantees no keystroke is ever wasted.
    if (target.onKeyBurst()) return
    for (const other of this.director.activePanels) {
      if (other === target || other.isDone) continue
      if (other.isSealed) {
        other.breakSealFromInput()
        this.setTarget(other)
        return
      }
      if (other.onKeyBurst()) {
        this.setTarget(other)
        return
      }
    }

    // Last resort: nothing on the board could take the keystroke right now
    // (e.g. every panel is mid-animation or waiting on a timer). Nudge the
    // breach directly so sustained input can never fully dead-end -- a
    // frozen run is worse than a small unattributed gain.
    this.applyResidualProgress()
  }

  private applyResidualProgress(): void {
    if (this.elapsedMs < this.breakthroughGraceUntil) return
    if (this.layers.addProgress(0.6)) this.handleBreakthrough()
  }

  private handleSubmit(line: string): void {
    const evaluated = this.inputPipeline.push({ kind: 'submit', token: line })
    const match = matchCommand(line)
    const profile = MODE_PROFILES[this.state.mode]

    const scoreByTier: Record<string, number> = { exact: 40, fuzzy: 20, thematic: 8, nonsense: 0 }
    awardScore(this.state, scoreByTier[match.tier] ?? 0)
    if (match.tier === 'nonsense') this.heat.add(1.5)

    for (const responseLine of buildCommandResponse(match, this.content)) {
      store.emit('terminal:line', responseLine)
    }

    // A recognized command is the "power move" clicking can't do: it hits
    // every live panel at once, so typing real hacking verbs visibly moves
    // the whole board.
    if (match.tier === 'exact' || match.tier === 'fuzzy') {
      const boost = computeProgress(evaluated, profile) * match.strength * 0.01
      for (const panel of this.director.activePanels) panel.onKeyBurst()
      void boost
    }
  }

  // -- Panel outcomes ----------------------------------------------------

  private onPanelProgress(_panel: TaskPanel, delta: number): void {
    // Panel progress is the ONLY source of layer progress now -- so the
    // breach bar is a direct readout of work the player actually did.
    if (this.elapsedMs < this.breakthroughGraceUntil) return
    const crossed = this.layers.addProgress(delta * 40)
    this.renderObjective()
    if (crossed) this.handleBreakthrough()
  }

  private onPanelComplete(panel: TaskPanel): void {
    awardScore(this.state, 120)
    this.heat.add(-6)

    // LINKED layers: cracking one node drags its neighbours along, so the
    // board cascades instead of being worked strictly one at a time.
    const mod = this.layers.current.modifier
    if (mod === 'linked' || mod === 'total') {
      for (const other of this.director.activePanels) {
        if (other !== panel) other.applyLinkedBoost(0.25)
      }
    }
    store.emit('terminal:line', {
      text: this.content.line(...this.layers.current.breachBank),
      tone: 'success',
      speed: 2,
    })
    // Hand focus straight to the next workable panel so the player's
    // typing carries on uninterrupted instead of stalling on a finished
    // window.
    if (this.targetPanel === panel) this.setTarget(null)
    this.refreshTarget()
    this.renderObjective()
  }

  private onTick(dt: number): void {
    this.elapsedMs += dt

    this.director.tick(dt)
    for (const panel of this.director.activePanels) {
      if (panel instanceof BruteForcePanel) panel.tickDecay(dt)
      else if (panel instanceof TraceDefensePanel) panel.tickPings(dt)
    }
    this.refreshTarget()

    const heatEvents = this.heat.tick(dt)
    if (heatEvents.warn) {
      spawnWarningDialog(this.windows, {
        title: 'IDS NOTICE',
        message: this.content.line('warnings', 'idsAlert'),
        ttlMs: 4000,
      })
    }
    if (heatEvents.critical) this.onHeatCritical()
  }

  private onHeatCritical(): void {
    spawnWarningDialog(this.windows, {
      title: 'TRACE IN PROGRESS',
      message: this.content.line('warnings', 'traceWarning'),
      ttlMs: 3000,
    })
    this.heat.resetAfterCountermeasure()
  }

  private handleBreakthrough(): void {
    const cleared = this.layers.current
    this.shellEl.classList.add('is-breaching')
    setTimeout(() => this.shellEl.classList.remove('is-breaching'), 400)

    store.emit('terminal:line', {
      text: `==== BREACH: ${cleared.title} LAYER CLEARED ====`,
      tone: 'success',
      speed: 1,
    })

    awardScore(this.state, 250)
    this.heat.add(-30)

    // Sweep the board, then reopen at the new depth -- the visible
    // "simplify, then get busy again" beat.
    this.director.clearAll()
    this.setTarget(null)

    const next = this.layers.breakthrough()
    this.breakthroughGraceUntil = this.elapsedMs + BREAKTHROUGH_GRACE_MS

    // Repaint the whole UI for the new depth -- this is what makes each
    // layer read as a different place rather than the same green screen.
    applyLayerPalette(next.palette)

    // Announce what's newly available. An unlock nobody is told about may
    // as well not exist.
    const newTools = next.unlocks.map((id) => PANEL_LABELS[id] ?? id).join(', ')
    store.emit('terminal:line', {
      text: `>> ${next.title} -- new tool: ${newTools}`,
      tone: 'success',
      speed: 2,
    })
    // Announce the rule change too -- the modifier is what makes this depth
    // play differently, so it has to be legible.
    store.emit('terminal:line', {
      text: `>> ${next.modifierText}`,
      tone: 'warning',
      speed: 2,
    })
    this.objective.set(`${next.title}: ${next.modifierText}`)

    setTimeout(() => {
      for (let i = 0; i < next.panelFloor; i++) this.director.spawn()
      this.refreshTarget()
    }, 1200)
  }
}
