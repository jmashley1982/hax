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
import { CounterHackDirector, type ThreatEvent } from '@/sim/counterHack'
import { generateTarget } from '@/sim/target'
import { ContentEngine } from '@/content'
import type { MissionFacts } from '@/content/grammar'
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
import { ThreatPanel } from './panels/threatPanel'
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
  private statusLeft!: HTMLElement

  /** The org being broken into. Threaded through content, threats, and the finale so it reads as one specific target, not a sci-fi abstraction. */
  private target: MissionFacts
  private counterHack: CounterHackDirector
  private activeThreats: ThreatPanel[] = []
  private inFinale = false
  private contractCount = 0

  constructor(root: HTMLElement, private state: GameState) {
    this.shellEl = document.createElement('div')
    this.shellEl.className = 'shell'
    root.appendChild(this.shellEl)

    this.rng = mulberry32(state.seed + 1)
    this.target = generateTarget(mulberry32(state.seed + 3))
    this.content = new ContentEngine(state.seed, this.target)
    this.counterHack = new CounterHackDirector(mulberry32(state.seed + 4))

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
    this.statusLeft = document.createElement('span')
    this.statusRight = document.createElement('span')
    bar.append(this.statusLeft, this.statusRight)
    shellEl.appendChild(bar)
    this.renderStatusRight()
    this.renderStatusLeft()
  }

  private renderStatusRight(): void {
    this.statusRight.textContent =
      `MODE:${this.state.mode.toUpperCase()} [TAB]  THEME:${this.state.theme.toUpperCase()}  SEED:${this.state.seedLabel}`
  }

  /** Keeps the target org visible at all times -- the point of reference for every threat/breach line. */
  private renderStatusLeft(): void {
    this.statusLeft.textContent = `TARGET ${this.target.org.toUpperCase()} (${this.target.domain})`
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

    // Active threats claim the keystroke first -- "you have to break their
    // attempt" needs to be the most urgent thing on screen, not something
    // competing on equal footing with routine panels.
    for (const threat of this.activeThreats) {
      if (threat.onKeyBurst()) return
    }

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
    if (this.layers.addProgress(0.6)) this.handleThresholdCrossed()
  }

  /** A crossed threshold means a normal descent everywhere except the last layer, where it means the finale. */
  private handleThresholdCrossed(): void {
    if (this.layers.isFinalLayer) this.handleFinale()
    else this.handleBreakthrough()
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
    if (crossed) this.handleThresholdCrossed()
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

    if (!this.inFinale) {
      const threat = this.counterHack.tick(this.elapsedMs, this.state.heat, this.state.layer, this.activeThreats.length)
      if (threat) this.spawnThreat(threat)
    }
  }

  // -- Counter-hack: the other side pushing back --------------------------

  private spawnThreat(event: ThreatEvent): void {
    let panel: ThreatPanel
    panel = new ThreatPanel(this.windows, event, this.target.org, (success) => this.onThreatResolved(panel, success))
    this.activeThreats.push(panel)
  }

  private onThreatResolved(panel: ThreatPanel, success: boolean): void {
    this.activeThreats = this.activeThreats.filter((t) => t !== panel)
    if (success) {
      awardScore(this.state, 90)
      this.heat.add(-15)
      store.emit('terminal:line', {
        text: `>> ${this.target.org} security response neutralized`,
        tone: 'success',
        speed: 2,
      })
    } else {
      // A real, named setback -- not fatal, but it should sting. The
      // existing heat-critical cascade (spawnWarningDialog + reset) fires
      // naturally if this pushes heat over the threshold, which is exactly
      // the "reverse hack got through" moment the brief asked for.
      this.heat.add(28)
      store.emit('terminal:line', {
        text: `>> CONNECTION FLAGGED -- ${this.target.org} is watching this session closer now`,
        tone: 'danger',
        speed: 2,
      })
    }
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

  // -- Finale: PHYSICAL's threshold is a climax, not a wall -------------

  /**
   * The old build gave PHYSICAL an infinite threshold and literally
   * blocked further progress there (LayerSystem.addProgress returned
   * false unconditionally) -- "reaching red just means there's no further
   * success" was describing real code, not a feeling. This replaces the
   * wall with an actual climax: a simultaneous wave of full-intensity
   * threats standing in for the target's incident-response team, then a
   * named ending, then a fresh contract at a new organization so the toy
   * stays replayable instead of dead-ending.
   */
  private handleFinale(): void {
    if (this.inFinale) return
    this.inFinale = true

    this.director.clearAll()
    this.setTarget(null)
    for (const t of this.activeThreats) t.win.close()
    this.activeThreats = []

    this.shellEl.classList.add('is-breaching')
    setTimeout(() => this.shellEl.classList.remove('is-breaching'), 400)

    store.emit('terminal:line', {
      text: `==== FULL LOCKDOWN :: ${this.target.org} INCIDENT RESPONSE ACTIVE ====`,
      tone: 'danger',
      speed: 1,
    })
    this.objective.set(`SURVIVE ${this.target.org}'s incident response`)

    const kinds: ThreatEvent['kind'][] = ['traceback', 'reverseShell', 'lockdown']
    const waveSize = kinds.length
    let resolved = 0
    let successes = 0

    for (const kind of kinds) {
      let panel: ThreatPanel
      const event: ThreatEvent = { kind, hitsNeeded: 7, timeoutMs: 12000 }
      panel = new ThreatPanel(this.windows, event, this.target.org, (success) => {
        resolved += 1
        if (success) successes += 1
        this.activeThreats = this.activeThreats.filter((t) => t !== panel)
        if (resolved === waveSize) this.finishFinale(successes, waveSize)
      })
      this.activeThreats.push(panel)
    }
  }

  private finishFinale(successes: number, total: number): void {
    const verdict = successes === total ? 'CLEAN EXIT' : successes > 0 ? 'TRACED, BUT CLEAR' : 'BURNED -- STILL OUT'
    awardScore(this.state, successes === total ? 900 : 450)

    store.emit('terminal:line', {
      text: `==== BREACH COMPLETE :: ${this.target.org} :: ${verdict} ====`,
      tone: 'success',
      speed: 1,
    })
    this.showEndingBanner(verdict)
    setTimeout(() => this.startNewContract(), 4200)
  }

  private showEndingBanner(verdict: string): void {
    const el = document.createElement('div')
    el.className = 'ending-banner'

    const title = document.createElement('div')
    title.className = 'ending-banner__title'
    title.textContent = 'BREACH COMPLETE'

    const sub = document.createElement('div')
    sub.className = 'ending-banner__sub'
    sub.textContent = `${this.target.org} -- ${verdict}`

    const score = document.createElement('div')
    score.className = 'ending-banner__score'
    score.textContent = `SCORE ${Math.floor(this.state.score)}`

    el.append(title, sub, score)
    this.shellEl.appendChild(el)
    setTimeout(() => el.remove(), 3800)
  }

  /** New org, fresh board, same score -- keeps the toy going instead of ending at a wall. */
  private startNewContract(): void {
    this.contractCount += 1
    this.target = generateTarget(this.rng)
    // A fresh numeric seed per contract so generated text doesn't replay
    // identically -- reusing state.seed here would restart the exact same
    // content stream.
    this.content = new ContentEngine(this.state.seed + this.contractCount * 10_000, this.target)
    this.renderStatusLeft()

    this.layers.restart()
    this.heat.resetAfterCountermeasure(10)
    this.inFinale = false
    applyLayerPalette(this.layers.current.palette)

    store.emit('terminal:line', {
      text: `>> NEW CONTRACT :: ${this.target.org} (${this.target.domain})`,
      tone: 'system',
      speed: 2,
    })
    this.objective.set(`${this.layers.current.title}: ${this.layers.current.modifierText}`)

    for (let i = 0; i < this.layers.current.panelFloor; i++) this.director.spawn()
    this.refreshTarget()
  }
}
