import { store } from '@/core/store'
import { clock } from '@/core/clock'
import { mulberry32, hashSeed, int, type Rng } from '@/core/rng'
import { saveState, LAYER_ORDER, type GameState } from '@/core/state'
import { InputPipeline } from '@/core/input'
import { PLAY_MODES, PLAY_MODE_ORDER, computeProgress, type PlayModeProfile } from '@/core/progress'
import { matchCommand } from '@/sim/commands/registry'
import { buildCommandResponse } from '@/sim/commands/responses'
import { HeatSystem } from '@/sim/heat'
import { IntegritySystem, INTEGRITY_COST, INTEGRITY_GAIN } from '@/sim/integrity'
import { awardScore } from '@/sim/score'
import { LayerSystem } from '@/sim/layers'
import { Director } from '@/sim/director'
import { CounterHackDirector, type ThreatEvent, type ThreatKind, type ThreatWaveSpec } from '@/sim/counterHack'
import { ProcessSpawnDirector, burstSize } from '@/sim/processDirector'
import { LockoutDirector } from '@/sim/lockoutDirector'
import { LockoutOverlay } from './lockout'
import { ReverseHack, reverseHackOpener } from './reverseHack'
import type { ReconResult } from '@/sim/recon'
import { ContentEngine } from '@/content'
import type { MissionFacts } from '@/content/grammar'
import type { LayerId } from '@/core/state'
import type { LayerDef, LayerPalette } from '@/sim/layers'
import type { Contract } from '@/sim/contracts'
import { CrtOverlay } from '@/fx/crt'
import { Terminal } from './terminal'
import { Prompt } from './prompt'
import { Hud } from './hud/hud'
import { ObjectiveBar } from './hud/objective'
import { WindowManager } from './windows/manager'
import { spawnWarningDialog } from './windows/dialogs'
import { spawnProcessWindow } from './windows/processWindow'
import { spawnCamWindow } from './windows/camWindow'
import { spawnAllyMessage, spawnOperatorMessage } from './windows/messageWindow'
import { preloadAvailability } from '@/media/videoRegistry'
import { preloadDocs } from '@/media/imageRegistry'
import { spawnDocWindow } from './windows/docWindow'
import { TouchInput } from './touch'
import { isMobileLayout } from '@/core/device'
import { isInteracting, resetInteraction } from '@/core/interaction'
import { BruteForcePanel } from './panels/bruteForce'
import { TraceDefensePanel } from './panels/traceDefense'
import { PANEL_LABELS } from './panels/registry'
import { ThreatPanel } from './panels/threatPanel'
import { TargetSitePanel } from './panels/targetSite'
import { applyLayerPalette, applyLayerSkin, brandLayerPalettes } from '@/themes/themes'
import { Chain } from './chain/chain'
import { Messenger, type Offer } from './messenger'
import { Manhunt } from './manhunt'
import { TokenPouch, type Token } from '@/sim/tokens'
import { BoardBudget } from '@/sim/boardBudget'
import type { TaskPanel } from './panels/panel'

const BREAKTHROUGH_GRACE_MS = 2500

/** How a contract ended, handed back to the App for career bookkeeping. */
export interface SessionOutcome {
  kind: 'completed' | 'burned' | 'aborted'
  deepestLayer: LayerId
  scoreEarned: number
  /** How intact the workstation was at the end -- feeds the debrief grade. */
  integrityLeft: number
  elapsedMs: number
}

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
  private integrity: IntegritySystem
  private reverseHack: ReverseHack | null = null
  private layers: LayerSystem
  private director: Director
  private objective: ObjectiveBar
  private rng: Rng
  private shellEl: HTMLElement
  private elapsedMs = 0
  /** When the player last did anything. IRL HACKER bleeds integrity off this. */
  private lastInputMs = 0
  private idleWarned = false
  private breakthroughGraceUntil = 0
  private targetPanel: TaskPanel | null = null
  /** The panel the player last clicked, as opposed to one focus rolled onto. */
  private explicitTarget: TaskPanel | null = null
  private statusRight!: HTMLElement
  private statusLeft!: HTMLElement

  /** The org being broken into. Threaded through content, threats, and the finale so it reads as one specific target, not a sci-fi abstraction. */
  private target: MissionFacts
  private counterHack: CounterHackDirector
  private processSpawner: ProcessSpawnDirector
  private lockoutDirector: LockoutDirector
  /** Non-null while the terminal is down. Gates all input and all spawning. */
  private lockout: LockoutOverlay | null = null
  private activeThreats: ThreatPanel[] = []
  private inFinale = false
  /** A periodic counter-intrusion wave lost -- ejection sequence in progress. Separate from inFinale so the two can't collide (handleEjection/spawnThreatWave both check both flags). */
  private ejecting = false
  /** True for the duration of a periodic wave -- see renderObjective()'s guard. */
  private waveActive = false

  /**
   * Per-layer palettes derived from the contract's brand color, so a run
   * keeps one visual identity as it descends instead of reverting to the
   * generic per-layer colors.
   */
  private activePalettes: Record<LayerId, LayerPalette> | null = null
  private recon: ReconResult | null = null
  private targetSite: TargetSitePanel | null = null
  private offTick: (() => void) | null = null
  /** Every pending timer this session owns, so destroy() can cancel them all. */
  private pending: Array<ReturnType<typeof setTimeout>> = []
  private destroyed = false
  private scoreAtStart = 0
  private deepestThisRun: LayerId = 'surface'
  private abortPrompt: import('./windows/window').Win | null = null
  /** EXFILTRATE: true once the objective file has been seeded into a panel. */
  private artifactSeeded = false
  /** True once the job's win condition is met and the escape is running. */
  private extracting = false
  /** Earned skeleton keys / trojan bypasses. Cleared with the session. */
  private pouch = new TokenPouch()
  /** At most one interactive chain at a time -- two would just be noise. */
  private chain: Chain | null = null
  private nextChainAt = 14_000
  /** Set while a trojan bypass is burning, which suppresses their controls. */
  private bypassUntilMs = 0
  /** The docked buddy list. Always present; occasionally saves the run. */
  private messenger!: Messenger
  /** Non-null while the deep-layer manhunt is running. */
  private manhunt: Manhunt | null = null
  private nextOfferAt = 30_000
  /**
   * Next roll for an unprompted reverse hack.
   *
   * Until now the ONLY way to be reverse-hacked was to drag a corrupted
   * file into your own vault -- which needs a drag-exfil panel to be on
   * the board AND the player to grab a bad file, so most runs never saw
   * one at all, and the manhunt sitting behind it was effectively
   * unreachable. Plan §16E always called for a low-integrity roll too;
   * this is it.
   */
  private nextReverseRollAt = 40_000
  /**
   * How full the board is allowed to get. Replaces the old wall-clock
   * spawner and WindowManager's MAX_TRANSIENT, which disagreed with each
   * other about how many windows existed.
   */
  private budget: BoardBudget
  /**
   * Child components are held so destroy() can unhook them. Each of these
   * subscribes to the store or to window events, and removing only their
   * DOM (which shellEl.remove() does) leaves those subscriptions live --
   * every finished contract would otherwise add another Hud rendering on a
   * detached node every frame, forever.
   */
  private terminal!: Terminal
  private crt!: CrtOverlay
  private prompt!: Prompt
  private hud!: Hud

  constructor(
    root: HTMLElement,
    private state: GameState,
    private contract: Contract,
    private onOutcome: (outcome: SessionOutcome) => void,
  ) {
    this.shellEl = document.createElement('div')
    this.shellEl.className = 'shell'
    root.appendChild(this.shellEl)

    // Every run is seeded off the chosen contract as well as the session
    // seed, so the same job always plays the same way under ?seed=.
    this.rng = mulberry32(state.seed + hashSeed(contract.id))
    this.target = contract.facts
    this.content = new ContentEngine(state.seed, this.target)
    this.counterHack = new CounterHackDirector(mulberry32(state.seed + 4))
    this.processSpawner = new ProcessSpawnDirector(mulberry32(state.seed + 6))
    this.lockoutDirector = new LockoutDirector(mulberry32(state.seed + 7))

    this.heat = new HeatSystem(state)
    this.integrity = new IntegritySystem(state)
    this.layers = new LayerSystem(state)
    this.windows = new WindowManager(this.shellEl, mulberry32(state.seed + 2))
    this.budget = new BoardBudget(
      () => this.state.layer,
      () => this.state.mode,
      () => this.windows.gridSlots,
    )
    this.windows.onWindowClosed(() => this.budget.noteClosed())
    this.windows.setCapacityProvider(() => this.budget.capacity)

    this.terminal = new Terminal(this.shellEl)
    this.crt = new CrtOverlay(this.shellEl, state.seed)
    this.prompt = new Prompt(this.shellEl, {
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
    this.hud = new Hud(
      this.shellEl,
      state,
      () => this.layers.tension,
      this.pouch,
      (token) => this.spendToken(token),
    )
    this.objective = new ObjectiveBar(this.shellEl)

    this.director = new Director(
      this.windows,
      state,
      this.layers,
      this.rng,
      (panel) => this.onPanelComplete(panel),
      (panel, delta) => this.onPanelProgress(panel, delta),
      {
        onArtifactSecured: () => this.beginExtraction(),
        // A corrupted file dropped into the local vault is the player
        // letting them in -- the most direct route to a reverse hack.
        onCorrupted: () => {
          this.integrity.damage(INTEGRITY_COST.corruptedFile)
          this.triggerReverseHack(0.5)
        },
      },
    )
    // Panels get the lion's share of the budget; the remainder is what
    // ambient popups may use. Both are bounded by the same number, so the
    // total on screen cannot run away.
    this.director.setBudgetProvider(() => Math.max(3, this.budget.capacity - 1))

    this.mountStatusBar(this.shellEl)
    this.bindTargeting()
    this.bindModeHotkey()
    if (isMobileLayout()) {
      this.mountTouchInput()
      this.bindBoardOffset()
    }

    // Keep the unsubscribe. A session is now started and torn down
    // repeatedly from the dashboard, and a leaked tick subscriber would
    // mean the second run ticks twice per frame and the third three times.
    // A pointer lost during the previous session must not leave ambient
    // spawning wedged off for the next one.
    this.messenger = new Messenger(this.shellEl, mulberry32(state.seed + 12), contract.facts.org, {
      onAccept: (offer) => this.handleOffer(offer),
      line: (text) => store.emit('terminal:line', { text, tone: 'normal', speed: 0 }),
    })

    resetInteraction()
    this.applyDifficulty()
    this.offTick = store.on('tick', ({ dt }) => this.onTick(dt))

    clock.start()
    // Warm the clip-availability cache in the background so the first camera
    // popup doesn't spend its lifetime waiting on a probe.
    preloadAvailability()
    preloadDocs()
    this.scoreAtStart = state.score
    this.runBootSequence()

    // The contract is already chosen on the dashboard, so the run opens
    // straight onto a live board and a stated objective -- no target prompt.
    this.applyContractIdentity()

    for (let i = 0; i < this.layers.current.panelFloor; i++) this.director.spawn()
    this.refreshTarget()
  }

  /**
   * Paint the run with the chosen contract: brand palette, dossier window,
   * and the job as the standing objective.
   */
  private applyContractIdentity(): void {
    this.content.setFacts(this.contract.facts)
    this.activePalettes = brandLayerPalettes(this.contract.brandColor)
    applyLayerPalette(this.activePalettes[this.layers.current.id] ?? this.layers.current.palette)
    applyLayerSkin(this.layers.current.id)
    this.renderStatusLeft()

    this.targetSite = new TargetSitePanel(this.windows)
    this.targetSite.setDepth(this.layers.current.id)
    this.targetSite.update(this.contract)

    store.emit('terminal:line', {
      text: `>> CONTRACT :: ${this.contract.facts.org} (${this.contract.facts.domain}) -- TIER ${this.contract.tier}`,
      tone: 'system',
      speed: 2,
    })
    store.emit('terminal:line', { text: `>> JOB :: ${this.contract.job.brief}`, tone: 'success', speed: 2 })
    this.objective.setJob(this.contract.job.brief)
  }




  /**
   * Mobile input. The desktop loop is driven entirely by the keyboard,
   * which a phone doesn't have -- this routes the BREACH pad and the
   * smear gesture into the exact same handleKey() path so the game logic
   * is identical, only the input device changed.
   */
  private mountTouchInput(): void {
    new TouchInput(this.shellEl, {
      burst: () => this.handleKey('*'),
      cycleTarget: (direction) => this.cycleTargetPanel(direction),
      hitPanelElement: (el) => this.hitPanelElement(el),
      targetLabel: () => this.touchTargetLabel(),
    })
  }

  /**
   * Keep the panel column clear of the HUD by measuring it, rather than
   * padding by a hardcoded guess.
   *
   * The HUD's height is not a constant: it wraps to an extra line on
   * narrow screens, and its layer ladder changes size as you descend. A
   * fixed padding that cleared it on one phone left the BREACH and HEAT
   * bars rendered underneath the first panel on a smaller one -- live
   * game state, invisible.
   */
  private bindBoardOffset(): void {
    const hud = this.shellEl.querySelector('.hud') as HTMLElement | null
    if (!hud) return
    const apply = (): void => {
      const bottom = hud.getBoundingClientRect().bottom
      this.shellEl.style.setProperty('--board-top', `${Math.ceil(bottom) + 8}px`)
    }
    apply()
    if (typeof ResizeObserver === 'function') new ResizeObserver(apply).observe(hud)
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', () => setTimeout(apply, 120))
  }

  /**
   * Tear the session down completely.
   *
   * The tick unsubscribe is the critical part: `store.on` returns an
   * unsubscribe that the old always-running Shell never needed and simply
   * dropped. Now that a session is created and discarded once per contract,
   * dropping it would leave a live subscriber per run -- the second session
   * would tick twice a frame and the third three times, so panels would
   * decay and heat would climb at multiples of the intended rate.
   *
   * Pending timers matter for the same reason: a breakthrough or finale
   * callback firing after the board is gone would touch dead DOM.
   */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.offTick?.()
    this.offTick = null
    for (const t of this.pending) clearTimeout(t)
    this.pending = []
    this.chain?.destroy()
    this.chain = null
    this.manhunt?.destroy()
    this.manhunt = null
    this.messenger.destroy()
    this.pouch.clear()
    this.lockout?.destroy()
    this.lockout = null
    this.reverseHack?.destroy()
    this.reverseHack = null
    this.director.clearAll()
    this.windows.closeAll()
    this.terminal.destroy()
    this.crt.destroy()
    this.prompt.destroy()
    this.hud.destroy()
    clock.stop()
    this.shellEl.remove()
  }

  /** setTimeout that is cancelled by destroy() and never runs on a dead session. */
  private later(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      if (this.destroyed) return
      fn()
    }, ms)
    this.pending.push(id)
  }

  /** Report the run's result to the App exactly once. */
  private finishSession(kind: SessionOutcome['kind']): void {
    if (this.destroyed) return
    this.onOutcome({
      kind,
      deepestLayer: this.deepestThisRun,
      scoreEarned: Math.max(0, Math.floor(this.state.score - this.scoreAtStart)),
      integrityLeft: this.state.integrity,
      elapsedMs: this.elapsedMs,
    })
  }

  /** Mobile only -- no-op on the desktop board, which doesn't scroll. */
  private scrollBoardToTop(): void {
    if (!isMobileLayout()) return
    this.shellEl.querySelector('.win-layer')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /** Step the target to the next/previous workable panel (BREACH pad swipe). */
  private cycleTargetPanel(direction: number): void {
    const workable = this.director.activePanels.filter((p) => !p.isDone)
    if (workable.length === 0) return
    const idx = this.targetPanel ? workable.indexOf(this.targetPanel) : -1
    const next = workable[(((idx + direction) % workable.length) + workable.length) % workable.length]
    if (next) {
      this.setTarget(next)
      next.element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }

  /** Drive a specific panel by its element -- the smear gesture crossing it. */
  private hitPanelElement(el: HTMLElement): void {
    const panel = this.director.activePanels.find((p) => p.id === el.dataset.panelId)
    if (!panel || panel.isDone) return
    this.setTarget(panel)
    if (panel.isSealed) {
      panel.breakSealFromInput()
      return
    }
    if (!panel.onKeyBurst()) this.applyResidualProgress()
  }

  /** What the BREACH pad reads out, so the player always knows what they're driving. */
  private touchTargetLabel(): string {
    if (this.activeThreats.length > 0) return 'REPEL INTRUSION'
    if (!this.targetPanel) return 'BREACH'
    const title = this.targetPanel.element.querySelector('.win__title-text')?.textContent ?? 'BREACH'
    return title.split(' :: ')[0] ?? 'BREACH'
  }

  private mountStatusBar(shellEl: HTMLElement): void {
    const bar = document.createElement('div')
    bar.className = 'statusbar'
    this.statusLeft = document.createElement('span')
    this.statusRight = document.createElement('span')

    // A way out of a contract that has gone badly. Without this the only
    // exit is finishing or being burned, which strands a player who took a
    // tier-5 job they can't hold.
    const abort = document.createElement('button')
    abort.className = 'statusbar__abort'
    abort.textContent = 'ABORT [ESC]'
    abort.addEventListener('click', () => this.confirmAbort())

    bar.append(this.statusLeft, abort, this.statusRight)
    shellEl.appendChild(bar)
    this.renderStatusRight()
    this.renderStatusLeft()
  }

  /** The chosen play mode's coefficients. Read fresh so TAB takes effect instantly. */
  private get mode(): PlayModeProfile {
    return PLAY_MODES[this.state.mode]
  }

  /**
   * Push the play mode's pressure scalars into every system that owns a
   * difficulty knob. Called at construction and again on every TAB cycle,
   * so switching mid-run actually changes the run.
   */
  private applyDifficulty(): void {
    const m = this.mode
    this.counterHack.setDifficulty(m.threatRate, m.threatSize)
    this.lockoutDirector.setDifficulty(m.lockoutRate)
    this.integrity.setDifficulty(m.damageMul, m.regenMul)
    this.shellEl.dataset.playmode = m.id
  }

  private renderStatusRight(): void {
    this.statusRight.textContent =
      `MODE:${PLAY_MODES[this.state.mode].label} [TAB]  THEME:${this.state.theme.toUpperCase()}  SEED:${this.state.seedLabel}`
  }

  /** Keeps the target org visible at all times -- the point of reference for every threat/breach line. */
  private renderStatusLeft(): void {
    this.statusLeft.innerHTML = ''
    if (this.recon) {
      const icon = document.createElement('img')
      icon.className = 'statusbar__favicon'
      icon.src = this.recon.faviconUrl
      icon.alt = ''
      // A broken/blocked favicon fetch must never show a broken-image icon
      // in the middle of the status bar -- just fall back to text-only.
      icon.addEventListener('error', () => icon.remove())
      this.statusLeft.appendChild(icon)
    }
    const text = document.createElement('span')
    text.textContent = `TARGET ${this.target.org.toUpperCase()} (${this.target.domain})`
    this.statusLeft.appendChild(text)
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
      this.markInput()
      const panel = this.director.activePanels.find((p) => p.id === id)
      if (panel) this.setTargetExplicit(panel)
    })
  }

  private bindModeHotkey(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        this.confirmAbort()
        return
      }
      if (e.key !== 'Tab') return
      e.preventDefault()
      this.cycleMode()
    })
  }

  private cycleMode(): void {
    const idx = PLAY_MODE_ORDER.indexOf(this.state.mode)
    const next = PLAY_MODE_ORDER[(idx + 1) % PLAY_MODE_ORDER.length] ?? 'leet'
    this.state.mode = next
    this.applyDifficulty()
    this.renderStatusRight()
    saveState(this.state)
    store.emit('mode:change', { mode: next })
  }

  /**
   * Select a panel deliberately (a click, or a priority window arriving).
   *
   * A panel the player *chose* outranks the automatic roll-over: an
   * unconsumed keystroke may still flow to another panel, but focus does
   * not permanently move off a chosen panel while it still has work left.
   * Without this, clicking a window and typing would silently drift to
   * whichever panel happened to be able to take the next key.
   */
  private setTargetExplicit(panel: TaskPanel | null): void {
    this.explicitTarget = panel
    this.setTarget(panel)
  }

  private setTarget(panel: TaskPanel | null): void {
    if (this.targetPanel === panel) return
    this.targetPanel?.setTargeted(false)
    this.targetPanel = panel
    panel?.setTargeted(true)
    // Ambient windows steer around whatever the player is working on.
    this.windows.setAvoidRect(panel ? panel.element.getBoundingClientRect() : null)
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
    // A panel the player explicitly clicked gets focus back as soon as it
    // can take input again -- so a keystroke that rolled elsewhere mid-flip
    // does not quietly steal the selection for the rest of the run.
    if (this.explicitTarget && workable(this.explicitTarget)) {
      if (this.targetPanel !== this.explicitTarget) this.setTarget(this.explicitTarget)
      return
    }
    if (this.explicitTarget?.isDone) this.explicitTarget = null
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
    // A live counter-intrusion wave owns the objective bar ("COUNTER-
    // INTRUSION -- REPEL ALL N") -- without this guard, an ordinary task
    // panel completing *during* the wave (panels keep running; only the
    // finale clears the board) calls this and instantly clobbers that
    // message back to whatever panel is targeted, which defeats the
    // "objective bar taken over" requirement almost as soon as it fires.
    // A manhunt takes the bar for the same reason and more so: during one
    // the contract is not the objective, staying anonymous is. Letting a
    // panel title overwrite "STAY ANONYMOUS" reads as the game not knowing
    // what is happening to you.
    if (this.waveActive || this.manhunt?.active) return
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
    // The lockout overlay owns every keystroke while it's up -- it binds
    // its own capture-phase listener, and letting input also reach the
    // board behind it would advance panels the player can't even see.
    if (this.lockout) return
    this.inputPipeline.push({ kind: 'key', token: char })

    // Every mode now accepts mashing -- the old INTENT mode made raw
    // keystrokes inert, which is indistinguishable from a broken game.
    this.markInput()

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

  /**
   * Any deliberate input at all. IRL HACKER measures inactivity from here,
   * so thinking between actions is free but walking away is not.
   */
  private markInput(): void {
    this.lastInputMs = this.elapsedMs
    this.idleWarned = false
    this.shellEl.classList.remove('is-idle-bleed')
  }

  /**
   * IRL HACKER's standing-still penalty (`idleDrainPerSec`).
   *
   * Deliberately silent in the other two modes -- this is the one rule that
   * makes the top difficulty a different game rather than the same game with
   * bigger numbers, so it must not leak into CASUAL at any strength.
   */
  private tickIdlePressure(dt: number): void {
    const { idleDrainPerSec, idleGraceMs } = this.mode
    if (idleDrainPerSec <= 0) return
    if (this.lockout || this.inFinale || this.ejecting) return
    const idleFor = this.elapsedMs - this.lastInputMs
    if (idleFor < idleGraceMs) return

    if (!this.idleWarned) {
      this.idleWarned = true
      store.emit('terminal:line', {
        text: '!! YOU HAVE STOPPED MOVING -- their trace is closing. KEEP WORKING.',
        tone: 'danger',
        speed: 0,
      })
      this.shellEl.classList.add('is-idle-bleed')
    }
    this.integrity.damage((idleDrainPerSec * dt) / 1000)
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
    this.markInput()
    // A typed line reaches, in order: a live chain's pending code, then a
    // held token's invoke code, then the normal command router. Both of the
    // first two are things the player *earned* the right to type, so they
    // outrank a generic keyword match.
    if (this.chain?.trySubmit(line)) return
    if (this.messenger.trySubmit(line)) return
    const invoked = this.pouch.takeByCode(line)
    if (invoked) {
      this.spendToken(invoked)
      return
    }

    const evaluated = this.inputPipeline.push({ kind: 'submit', token: line })
    const match = matchCommand(line)
    const profile = this.mode

    const scoreByTier: Record<string, number> = { exact: 40, fuzzy: 20, thematic: 8, nonsense: 0 }
    awardScore(this.state, scoreByTier[match.tier] ?? 0)
    if (match.tier === 'nonsense') this.heat.add(1.5)

    for (const responseLine of buildCommandResponse(match, this.content)) {
      store.emit('terminal:line', responseLine)
    }

    // A recognized command is the "power move" clicking can't do: it hits
    // every live panel at once, so typing real hacking verbs visibly moves
    // the whole board.
    //
    // This used to compute a boost and then literally throw it away
    // (`void boost`), handing each panel a single keystroke's worth of
    // progress -- one press for a whole typed command. In INTENT, where
    // that is the *entire* input economy, correct play advanced the board
    // barely faster than not playing at all. The boost is now spent.
    if (match.tier === 'nonsense') return
    const boost = computeProgress(evaluated, profile) * match.strength
    // ~8 bursts for an exact command in INTENT (submitGain 8), ~6 in
    // HYBRID, scaled down by match quality. Deliberately generous: a
    // command costs several keystrokes and a decision, so it has to be
    // worth more than the keystrokes it took to type.
    const bursts = Math.max(1, Math.round(boost * 0.6))

    this.refreshTarget()
    const target = this.targetPanel
    if (target && !target.isDone) {
      if (target.isSealed) target.breakSealFromInput()
      for (let i = 0; i < bursts; i++) if (!target.onKeyBurst()) break
    }
    // Everything else on the board gets a smaller share -- that spread is
    // what makes a typed command read as hitting the whole system.
    const spread = Math.max(1, Math.round(bursts * 0.35))
    for (const panel of this.director.activePanels) {
      if (panel === target || panel.isDone) continue
      if (panel.isSealed) {
        panel.breakSealFromInput()
        continue
      }
      for (let i = 0; i < spread; i++) if (!panel.onKeyBurst()) break
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
    this.integrity.repair(INTEGRITY_GAIN.panelCleared)
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

    // While the terminal is down the whole simulation is frozen: no panel
    // decay, no heat, no threats, no spawns. The player's machine is off
    // -- nothing should advance behind the reboot screen, least of all a
    // timer that could eject them for a wave they physically cannot see.
    if (this.lockout) return

    this.tickIdlePressure(dt)
    this.tickOffers(dt)
    this.tickAmbient()
    this.tickReverseRoll()
    this.manhunt?.tick(dt)
    this.tickChains(dt)
    this.director.tick(dt, !isInteracting())
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
    if (heatEvents.critical) {
      this.integrity.damage(INTEGRITY_COST.heatCritical)
      this.onHeatCritical()
    }

    // Integrity regenerates only while nothing hostile is live, so you
    // cannot idle out of trouble -- you have to clear the threat first.
    const underPressure =
      this.waveActive || this.activeThreats.length > 0 || !!this.reverseHack?.active || this.inFinale
    const integrityEvents = this.integrity.tick(dt, underPressure)
    if (integrityEvents.overrun) {
      this.handleOverrun()
      return
    }
    // A run can END on integrity, so its decline must be impossible to
    // miss. A terminal line alone was not enough: players were hitting zero
    // and reading the result as the game crashing.
    if (integrityEvents.warn) {
      store.emit('terminal:line', { text: '!! WORKSTATION INTEGRITY FALLING -- repel threats to recover', tone: 'warning', speed: 0 })
      this.objective.setJob('WARNING -- workstation integrity falling')
    }
    if (integrityEvents.critical) {
      store.emit('terminal:line', {
        text: '!!!! INTEGRITY CRITICAL -- ONE MORE HIT AND YOU ARE BURNED',
        tone: 'danger',
        speed: 0,
      })
      this.shellEl.classList.add('is-integrity-critical')
      this.objective.setJob('CRITICAL -- your machine is about to fall')
      spawnWarningDialog(this.windows, {
        title: 'WORKSTATION FAILING',
        message: `Integrity critical. ${this.target.org} is one step from owning this machine. Clear the hostiles and stop taking hits.`,
        ttlMs: 5000,
      })
    }
    if (this.state.integrity > 35) this.shellEl.classList.remove('is-integrity-critical')

    // The target pulling the plug on the player's own terminal. Checked
    // before the counter-hack so the two can never fire on the same tick.
    if (
      this.lockoutDirector.tick(
        this.elapsedMs,
        Math.min(100, this.state.heat + this.integrity.exposure * 40),
        this.state.layer,
        this.inFinale ||
          this.ejecting ||
          this.waveActive ||
          !!this.manhunt?.active ||
          this.activeThreats.length > 0,
      )
    ) {
      this.beginLockout()
      return
    }

    // While a trojan bypass is burning, their controls are literally down:
    // no new waves at all. This is what "slip in faster or deeper" buys --
    // a real window of quiet, not just a number nudged.
    // While a trojan bypass is burning, their controls are literally down:
    // no new waves. Scoped to the wave only -- the ambient popups below are
    // texture, and suppressing those too would just make the screen go dead
    // for half a minute at the exact moment the player is meant to be
    // moving fastest.
    const bypassing = this.elapsedMs < this.bypassUntilMs
    if (!this.inFinale && !this.ejecting) {
      if (!bypassing) {
        const wave = this.counterHack.tick(
          this.elapsedMs,
          // Low integrity reads as extra heat to the counter-hack director
          // -- a wounded machine draws more attention. This is the
          // compounding half of the tug of war.
          Math.min(100, this.state.heat + this.integrity.exposure * 35),
          this.state.layer,
          this.activeThreats.length,
        )
        if (wave) this.spawnThreatWave(wave)
      }

    }
  }

  /**
   * Ambient popups -- now gated by the board budget rather than a clock.
   *
   * Every kind here is optional texture. The budget decides whether the
   * board has room at all; only then does the mix decide what arrives.
   * That inversion is the fix for "everything is just on top of everything
   * else": previously each kind rolled its own independent chance on a
   * wall-clock tick and none of them knew how full the screen was.
   */
  private tickAmbient(): void {
    if (this.inFinale || this.ejecting) return
    // Nothing ambient opens while the player is mid-drag, during a reverse
    // hack (the screen is already full of hostiles) or during a manhunt.
    if (isInteracting() || this.reverseHack?.active || this.manhunt?.active) return
    if (!this.processSpawner.tick(this.elapsedMs, this.state.layer, this.layers.tension)) return

    const draws = burstSize(this.state.layer, this.rng)
    for (let i = 0; i < draws; i++) {
      if (!this.budget.canSpawn(this.windows.budgetedCount)) return
      this.spawnAmbient()
    }
  }

  /** One ambient window, kind chosen by depth. */
  private spawnAmbient(): void {
    const depthIdx = LAYER_ORDER.indexOf(this.state.layer)
    const roll = this.rng()

    if (roll < 0.34) {
      spawnProcessWindow(this.windows, this.content, this.layers.current, this.rng)
      return
    }
    if (roll < 0.62) {
      spawnCamWindow({
        manager: this.windows,
        rng: this.rng,
        labelPrefix: this.target.org.toUpperCase(),
        // Everything except 'webcam', which is reserved for the reverse
        // hack ("they're watching YOU"). Naming one narrow kind here --
        // doorcam has exactly two clips -- handed a quarter of all camera
        // popups to the same two files.
        kind: ['cctv', 'thermal', 'doorcam'],
      })
      return
    }
    if (roll < 0.78) {
      // Returns false when no image has landed yet; fall back rather than
      // silently wasting the draw.
      if (!spawnDocWindow(this.windows, this.rng, this.target.org)) {
        spawnProcessWindow(this.windows, this.content, this.layers.current, this.rng)
      }
      return
    }
    if (roll < 0.9) {
      spawnOperatorMessage({
        manager: this.windows,
        rng: this.rng,
        org: this.target.org,
        handle: this.state.handle,
        tier: Math.min(3, Math.floor(depthIdx / 2) + (this.state.heat > 60 ? 1 : 0)),
      })
      return
    }
    spawnAllyMessage({
      manager: this.windows,
      rng: this.rng,
      org: this.target.org,
      kind: this.integrity.value < 55 ? 'incoming' : this.rng() < 0.5 ? 'badFiles' : 'route',
    })
  }

  // -- Jobs: the contract's actual win condition -------------------------

  /**
   * Put the objective file on the board once the run is deep enough.
   *
   * Until now `contract.job` only produced a line of text -- there was no
   * win condition anywhere, so every run ended the one old way (crossing
   * PHYSICAL) regardless of the job, and the EXFILTRATE briefs that make up
   * most of the board could never actually be completed.
   */
  private maybeSeedArtifact(layer: LayerId): void {
    if (this.artifactSeeded || this.contract.job.kind !== 'exfiltrate') return
    if (LAYER_ORDER.indexOf(layer) < LAYER_ORDER.indexOf(this.contract.job.completesAt)) return

    this.artifactSeeded = true
    this.director.seedArtifact(this.contract.job.artifact)
    store.emit('terminal:line', {
      text: `>> ${this.contract.job.artifact} LOCATED -- pull it to your vault`,
      tone: 'success',
      speed: 1,
    })
    this.objective.setJob(`FOUND: ${this.contract.job.artifact} -- pull it`)
    // Guarantee a vault panel exists to carry it.
    this.director.spawn()
  }

  /**
   * The job is done -- now get out.
   *
   * Securing the objective deliberately does NOT end the run. Heat spikes,
   * they come after you, and the contract only banks if you survive the
   * escape. That's what gives the debrief something to have been earned.
   */
  private beginExtraction(): void {
    if (this.extracting || this.inFinale || this.destroyed) return
    this.extracting = true

    this.heat.add(45)
    awardScore(this.state, 400)
    store.emit('terminal:line', {
      text: `==== OBJECTIVE SECURED :: ${this.target.org} KNOWS -- GET OUT ====`,
      tone: 'danger',
      speed: 1,
    })
    this.objective.setJob('EXTRACTION -- survive and disconnect')
    this.objective.set('REPEL everything and hold on')

    const kinds: ThreatKind[] = ['traceback', 'reverseShell', 'lockdown']
    this.runThreatWave(kinds, 6, 13000, (successes) => this.finishExtraction(successes, kinds.length))
  }

  private finishExtraction(successes: number, total: number): void {
    if (this.destroyed) return
    // Clean out even if they were sloppy -- the job is in the bag, the only
    // question was the exit. Losing the whole contract here would punish
    // the moment the player just earned.
    const clean = successes === total
    awardScore(this.state, clean ? 700 : 260)
    store.emit('terminal:line', {
      text: clean
        ? `==== EXTRACTED CLEAN :: ${this.contract.job.artifact} IS YOURS ====`
        : `==== OUT, BUT TRACED :: ${this.contract.job.artifact} IS YOURS ====`,
      tone: 'success',
      speed: 1,
    })
    this.showEndingBanner(clean ? 'CLEAN EXTRACTION' : 'EXTRACTED -- TRACED')
    this.endContract('completed')
  }

  // -- Reverse hack: they are inside YOUR machine ------------------------

  /**
   * Hostile processes land on the player's own desktop. Deliberately does
   * NOT stop the board -- the tension is having to fight them off while the
   * job is still running, which is what makes it different from the lockout.
   */
  private triggerReverseHack(severity: number): void {
    if (this.reverseHack?.active || this.lockout || this.inFinale) return

    store.emit('terminal:line', { text: reverseHackOpener(this.target.org, this.rng), tone: 'danger', speed: 0 })
    // An ally shouts a beat before it lands, so the warning channel is
    // genuinely useful rather than decorative.
    spawnAllyMessage({ manager: this.windows, rng: this.rng, org: this.target.org, kind: 'incoming' })

    // Severity rises with depth and with how exposed the player already is,
    // so a weak machine gets hit harder -- the compounding half of the loop.
    const intensity = Math.min(1, severity + this.layers.tension * 0.2 + this.integrity.exposure * 0.4)

    // The single most unsettling beat available: the same camera window
    // that means "we own their building" now points at the player. Same
    // component, opposite meaning.
    spawnCamWindow({
      manager: this.windows,
      rng: this.rng,
      kind: 'webcam',
      labelPrefix: 'YOUR MACHINE',
      hostile: true,
      ttlMs: 9000,
    })

    this.reverseHack = new ReverseHack({
      manager: this.windows,
      mount: this.shellEl,
      rng: this.rng,
      org: this.target.org,
      intensity,
      onBreach: () => {
        this.integrity.damage(INTEGRITY_COST.hostileExpired)
        this.heat.add(6)
      },
      onRepelled: () => {
        // Drop the reference only after tearing it down -- an instance the
        // Shell has forgotten can never be cleaned up by anything.
        this.reverseHack?.destroy()
        this.reverseHack = null
        this.integrity.repair(INTEGRITY_GAIN.waveRepelled)
        awardScore(this.state, 140)
        store.emit('terminal:line', {
          text: '>> hostile processes terminated -- machine is yours again',
          tone: 'success',
          speed: 2,
        })
      },
      onTakeover: () => {
        this.reverseHack?.destroy()
        this.reverseHack = null
        this.integrity.damage(INTEGRITY_COST.lockout)
        // At depth, losing the desktop fight is not just another blackout:
        // they stop trying to push you off the network and start trying to
        // find out who you are. Shallow layers keep the old lockout, which
        // is the right size of setback for an early mistake.
        if (LAYER_ORDER.indexOf(this.state.layer) >= 3) this.beginManhunt()
        else this.beginLockout()
      },
    })
  }

  /**
   * Integrity hit zero: the workstation is theirs and the contract is gone.
   * Career score is kept -- the agreed cost is the job, not the run history.
   */
  private handleOverrun(): void {
    if (this.destroyed || this.inFinale) return
    this.reverseHack?.destroy()
    this.reverseHack = null
    this.director.clearAll()
    this.explicitTarget = null
    this.setTarget(null)
    this.budget.reset()
    for (const t of this.activeThreats) t.win.close()
    this.activeThreats = []

    store.emit('terminal:line', {
      text: `==== WORKSTATION OVERRUN :: ${this.target.org} OWNS THIS MACHINE ====`,
      tone: 'danger',
      speed: 0,
    })
    this.objective.set('BURNED -- disconnecting')
    this.showEndingBanner('BURNED')
    this.endContract('burned', 3600)
  }

  // -- Lockout: they kill YOUR terminal ----------------------------------

  /**
   * Every other setback in this game happens to the connection. This one
   * happens to the player's own machine -- the screen dies and they have
   * to walk the rig back up through a boot ceremony before they can keep
   * working.
   *
   * Deliberately NOT a progress loss: the cost is the interruption and
   * having your board swept, not points or depth. Stacking a hard penalty
   * on top of a 15-second forced ceremony would make the most dramatic
   * moment in the game the one players least want to see.
   */
  private beginLockout(): void {
    if (this.lockout) return
    this.integrity.damage(INTEGRITY_COST.lockout)
    this.reverseHack?.destroy()
    this.reverseHack = null

    store.emit('terminal:line', {
      text: `!!!! ${this.target.org} PUSHED A KILL COMMAND -- TERMINAL DOWN !!!!`,
      tone: 'danger',
      speed: 0,
    })

    // Sweep everything: the machine is off, nothing survives the reboot.
    this.director.clearAll()
    this.explicitTarget = null
    this.setTarget(null)
    this.budget.reset()
    for (const t of this.activeThreats) t.win.close()
    this.activeThreats = []
    this.waveActive = false
    this.shellEl.classList.remove('is-counter-intrusion')
    this.windows.closeTransient()

    this.lockout = new LockoutOverlay(this.shellEl, {
      org: this.target.org,
      rng: this.rng,
      onComplete: () => this.endLockout(),
    })
  }

  private endLockout(): void {
    this.lockout = null
    // lastFiredAt was already stamped when it fired; this only spaces out
    // the next check so a reboot isn't immediately followed by another.
    this.lockoutDirector.rearm(this.elapsedMs, 30_000)
    // Coming back up should feel like relief, not straight back into the
    // fire -- cool the heat that got them locked out in the first place.
    this.heat.resetAfterCountermeasure(5)
    this.breakthroughGraceUntil = this.elapsedMs + BREAKTHROUGH_GRACE_MS
    // A wave that came due while the machine was dead must not fire the
    // instant the player finishes rebooting.
    this.counterHack.defer(this.elapsedMs, 12_000)
    this.processSpawner.defer(this.elapsedMs, 3_000)

    store.emit('terminal:line', {
      text: `>> TERMINAL RESTORED -- re-entering ${this.target.org} at ${this.layers.current.title}`,
      tone: 'success',
      speed: 2,
    })
    this.objective.set(`${this.layers.current.title}: ${this.layers.current.modifierText}`)

    for (let i = 0; i < this.layers.current.panelFloor; i++) this.director.spawn()
    this.refreshTarget()
  }

  // -- Counter-hack: the other side pushing back --------------------------

  /**
   * Spawns `kinds.length` ThreatPanels at once, all sharing `timeoutMs`,
   * and calls `onAllResolved` exactly once every one of them has either
   * been cleared or expired. This is the one mechanism both the periodic
   * counter-intrusion wave and the PHYSICAL finale run through -- they
   * differ only in what they do with the outcome (spawnThreatWave ejects
   * on any miss; handleFinale grades a tiered verdict and always
   * continues).
   */
  private runThreatWave(
    kinds: ThreatKind[],
    hitsNeeded: number,
    timeoutMs: number,
    onAllResolved: (successes: number, total: number) => void,
  ): void {
    const total = kinds.length
    let resolved = 0
    let successes = 0
    for (const kind of kinds) {
      let panel: ThreatPanel
      const event: ThreatEvent = { kind, hitsNeeded, timeoutMs }
      panel = new ThreatPanel(this.windows, event, this.target.org, (success) => {
        resolved += 1
        if (success) successes += 1
        this.activeThreats = this.activeThreats.filter((t) => t !== panel)
        if (resolved === total) onAllResolved(successes, total)
      })
      this.activeThreats.push(panel)
    }
  }

  /**
   * A periodic counter-intrusion wave. Unlike a lone threat, this is a
   * real fail state: "you have to break their attempt or they kick you
   * out and you have to start over" (the user's words) means missing even
   * one window in the wave ejects, not just a heat bump.
   */
  private spawnThreatWave(wave: ThreatWaveSpec): void {
    // A manhunt owns the entire threat budget while it runs. Observed on
    // seed hunt2: a counter-intrusion wave fired mid-manhunt, took the
    // objective bar for itself, and then lost -- which ejected the player
    // to SURFACE with the manhunt still on screen. Two boss-scale
    // emergencies at once is not "hectic", it is incoherent.
    if (this.manhunt?.active) return
    this.shellEl.classList.add('is-counter-intrusion')
    this.waveActive = true
    this.objective.set(`COUNTER-INTRUSION -- REPEL ALL ${wave.kinds.length}`)
    // On mobile the board is a scrolling column -- snap back to the top so
    // the wave (which sorts there, see mobile.css) is actually on screen
    // rather than however far down the player had scrolled.
    this.scrollBoardToTop()

    this.runThreatWave(wave.kinds, wave.hitsNeeded, wave.timeoutMs, (successes, total) => {
      this.shellEl.classList.remove('is-counter-intrusion')
      this.waveActive = false
      if (successes === total) {
        awardScore(this.state, 90 * total)
        this.heat.add(-15)
        store.emit('terminal:line', {
          text: `>> ${this.target.org} security response neutralized`,
          tone: 'success',
          speed: 2,
        })
        this.refreshTarget()
        this.renderObjective()
      } else {
        this.handleEjection()
      }
    })
  }

  /**
   * The fail state: a counter-intrusion wave got through. Not fatal --
   * score and target identity survive -- but real: the board is wiped and
   * the descent restarts from SURFACE on the same target, same as §13a's
   * "rewarding, not hard" rule for task panels never extended to this
   * system on purpose (the user explicitly asked for a real consequence
   * here).
   */
  private handleEjection(): void {
    if (this.inFinale || this.ejecting || this.manhunt?.active) return
    this.ejecting = true

    this.director.clearAll()
    this.explicitTarget = null
    this.setTarget(null)
    this.budget.reset()
    for (const t of this.activeThreats) t.win.close()
    this.activeThreats = []

    this.shellEl.classList.add('is-ejecting')
    setTimeout(() => this.shellEl.classList.remove('is-ejecting'), 500)
    this.targetSite?.flashDisconnected()

    store.emit('terminal:line', {
      text: `==== CONNECTION LOST :: ${this.target.org} COUNTERMEASURES SUCCESSFUL ====`,
      tone: 'danger',
      speed: 1,
    })
    store.emit('terminal:line', {
      text: '>> session dropped -- falling back to the last stable point',
      tone: 'danger',
      speed: 2,
    })
    this.objective.set('CONNECTION LOST -- reconnecting...')
    this.showEjectionBanner()

    setTimeout(() => {
      this.layers.restart()
      this.heat.resetAfterCountermeasure(20)
      applyLayerPalette(this.activePalettes?.[this.layers.current.id] ?? this.layers.current.palette)
      applyLayerSkin(this.layers.current.id)
      this.targetSite?.setDepth(this.layers.current.id)
      this.targetSite?.update(this.contract)

      store.emit('terminal:line', {
        text: `>> reconnected :: ${this.target.org} (${this.target.domain}) -- back to SURFACE`,
        tone: 'system',
        speed: 2,
      })
      this.objective.set(`${this.layers.current.title}: ${this.layers.current.modifierText}`)
      for (let i = 0; i < this.layers.current.panelFloor; i++) this.director.spawn()
      this.refreshTarget()
      this.ejecting = false
    }, 2200)
  }

  private showEjectionBanner(): void {
    const el = document.createElement('div')
    el.className = 'ending-banner ejection-banner'

    const title = document.createElement('div')
    title.className = 'ending-banner__title'
    title.textContent = 'EJECTED'

    const sub = document.createElement('div')
    sub.className = 'ending-banner__sub'
    sub.textContent = `${this.target.org} -- countermeasures won this round`

    const score = document.createElement('div')
    score.className = 'ending-banner__score'
    score.textContent = `SCORE PRESERVED :: ${Math.floor(this.state.score)}`

    el.append(title, sub, score)
    this.shellEl.appendChild(el)
    setTimeout(() => el.remove(), 2000)
  }

  // -- the manhunt: the deep-layer boss fight -----------------------------

  /**
   * They stop defending and start hunting.
   *
   * This is deliberately a different *kind* of thing from every other
   * setback: the contract stops mattering, the objective becomes staying
   * anonymous, and there are two ways out -- scrub your way clear, or have
   * a friend on the relay misdirect the responders. The second is the
   * payoff for having watched the messenger all game.
   */
  private beginManhunt(): void {
    if (this.manhunt?.active || this.destroyed) return
    this.director.clearAll()
    this.explicitTarget = null
    this.setTarget(null)
    this.budget.reset()
    this.objective.set(`STAY ANONYMOUS -- ${this.target.org} IS HUNTING YOU`)

    // Their ETA is the difficulty knob: CASUAL gives you room to work it
    // out, IRL barely gives you time to react.
    const seconds = this.mode.id === 'casual' ? 95 : this.mode.id === 'leet' ? 70 : 50
    const hops = this.mode.id === 'casual' ? 3 : this.mode.id === 'leet' ? 4 : 6

    this.manhunt = new Manhunt({
      manager: this.windows,
      mount: this.shellEl,
      rng: this.rng,
      org: this.target.org,
      handle: this.state.handle,
      etaSeconds: seconds,
      hopsToLoseThem: hops,
      line: (text, tone) => store.emit('terminal:line', { text, tone, speed: 0 }),
      onEscaped: () => {
        this.manhunt = null
        awardScore(this.state, 600)
        this.integrity.repair(30)
        this.heat.add(-50)
        store.emit('terminal:line', {
          text: '>>>> THEY LOST YOU. Get back to work.',
          tone: 'success',
          speed: 2,
        })
        this.objective.set('BACK ON TARGET')
        for (let i = 0; i < this.layers.current.panelFloor; i++) this.director.spawn()
        this.refreshTarget()
      },
      onCaught: () => {
        this.manhunt = null
        store.emit('terminal:line', {
          text: '!!!! THEY HAVE YOUR ADDRESS. PULL EVERYTHING.',
          tone: 'danger',
          speed: 0,
        })
        this.finishSession('burned')
      },
    })

    // The one moment the messenger exists for. Offered a beat later so it
    // arrives *after* the player has registered what is happening, rather
    // than in the same frame as four new windows.
    this.later(() => {
      if (!this.manhunt?.active) return
      this.messenger.raiseOffer('interference', true)
    }, 4500)
  }

  /**
   * Someone on the relay offering to help. Most offers are convenience;
   * `interference` during a manhunt is the run.
   */
  private handleOffer(offer: Offer): void {
    switch (offer.kind) {
      case 'interference':
        if (this.manhunt?.active) this.manhunt.applyInterference(offer.from)
        else {
          this.heat.add(-30)
          store.emit('terminal:line', { text: `${offer.from} muddied the trail for you`, tone: 'success', speed: 0 })
        }
        break
      case 'skeleton':
        if (offer.token) this.grantToken(offer.token)
        break
      case 'heat':
        this.heat.add(-35)
        this.counterHack.defer(this.elapsedMs, 20_000)
        store.emit('terminal:line', { text: `${offer.from} is making noise on the other side of their network`, tone: 'success', speed: 0 })
        break
      case 'repair':
        this.integrity.repair(25)
        store.emit('terminal:line', { text: `clean image applied -- ${offer.from} came through`, tone: 'success', speed: 0 })
        break
    }
  }

  /**
   * Unsolicited help, spaced out and biased toward when it is useful.
   *
   * Never during a manhunt -- that one raises its own offer, and a second
   * competing one would just split the player's attention at the worst
   * possible moment.
   */
  private tickOffers(dt: number): void {
    this.messenger.tick(dt)
    if (this.manhunt?.active || this.messenger.hasOffer) return
    if (this.elapsedMs < this.nextOfferAt) return
    this.nextOfferAt = this.elapsedMs + int(this.rng, 55_000, 95_000)

    const kind = this.integrity.value < 55
      ? 'repair'
      : this.state.heat > 65
        ? 'heat'
        : this.rng() < 0.4
          ? 'skeleton'
          : 'heat'
    this.messenger.raiseOffer(kind)
  }

  // -- interactive chains + earned tokens --------------------------------

  /**
   * Keep at most one chain running, spaced out.
   *
   * Chains are long -- a scan alone is ~15 seconds plus however long its
   * jams sit -- so they are a periodic beat, not ambient texture. The gap
   * shortens with depth because the deeper layers are where the player most
   * needs something to spend.
   */
  private tickChains(dt: number): void {
    if (this.chain && !this.chain.active) this.chain = null
    this.chain?.tick(dt)
    if (this.chain) return
    if (this.elapsedMs < this.nextChainAt) return
    // Never open one on top of an emergency: the whole appeal is running it
    // alongside normal play, and during a wave there is no normal play.
    if (
      this.lockout ||
      this.waveActive ||
      this.inFinale ||
      this.ejecting ||
      this.manhunt?.active ||
      this.reverseHack?.active
    ) {
      this.nextChainAt = this.elapsedMs + 6000
      return
    }

    const depthIdx = LAYER_ORDER.indexOf(this.state.layer)
    this.nextChainAt = this.elapsedMs + Math.max(22_000, 52_000 - depthIdx * 5000)
    this.chain = new Chain({
      manager: this.windows,
      rng: this.rng,
      org: this.target.org,
      mode: this.mode,
      cb: {
        line: (text, tone) => store.emit('terminal:line', { text, tone, speed: 0 }),
        damage: (n) => this.integrity.damage(n),
        repair: (n) => this.integrity.repair(n),
        coolHeat: (n) => this.heat.add(-n),
        grantToken: (t) => this.grantToken(t),
      },
    })
  }

  /**
   * Roll for them pivoting into your machine unprompted.
   *
   * Gated on depth (they need to be inside you to matter), on exposure
   * (a wounded machine is the one they get into), and on the play mode's
   * reverseRate -- so CASUAL sees this rarely and IRL sees it a lot.
   */
  private tickReverseRoll(): void {
    if (this.elapsedMs < this.nextReverseRollAt) return
    if (
      this.reverseHack?.active ||
      this.manhunt?.active ||
      this.lockout ||
      this.inFinale ||
      this.ejecting ||
      this.waveActive ||
      this.extracting
    ) {
      this.nextReverseRollAt = this.elapsedMs + 8000
      return
    }

    const depthIdx = LAYER_ORDER.indexOf(this.state.layer)
    if (depthIdx < 2) {
      this.nextReverseRollAt = this.elapsedMs + 12_000
      return
    }

    this.nextReverseRollAt = this.elapsedMs + int(this.rng, 28_000, 52_000) / this.mode.reverseRate
    const chance = Math.min(
      0.85,
      (0.14 + depthIdx * 0.09 + this.integrity.exposure * 0.5 + (this.state.heat / 100) * 0.25) *
        this.mode.reverseRate,
    )
    if (this.rng() > chance) return
    this.triggerReverseHack(0.35 + depthIdx * 0.09)
  }

  private grantToken(token: Token): void {
    if (this.pouch.add(token)) return
    // Pouch full. Paying out nothing after a whole chain would be a swindle,
    // so it converts to an immediate effect instead of evaporating.
    store.emit('terminal:line', {
      text: `-- no room for another ${token.label}; burned it on the spot`,
      tone: 'warning',
      speed: 0,
    })
    this.spendToken(token)
  }

  /**
   * Spend a token -- clicked in the HUD or typed at the prompt.
   *
   * SKELETON KEY is deliberately enormous: it wipes the board and drops a
   * whole layer. It has to be, or a chain that took several minutes of
   * divided attention would not have been worth running.
   */
  private spendToken(token: Token): void {
    if (this.destroyed) return
    if (token.kind === 'skeleton') {
      store.emit('terminal:line', {
        text: `>>>> SKELETON KEY ${token.code} -- every lock on this layer just opened`,
        tone: 'success',
        speed: 0,
      })
      this.flashToken('SKELETON KEY', token.code)
      if (this.layers.isFinalLayer) {
        // At the bottom there is no next layer to drop into, so it pays out
        // as the finale instead of silently doing nothing.
        this.handleThresholdCrossed()
      } else {
        this.handleBreakthrough()
      }
      return
    }

    // TROJAN BYPASS: their controls go down for a while.
    this.bypassUntilMs = this.elapsedMs + 30_000
    this.heat.add(-45)
    this.integrity.repair(12)
    this.counterHack.defer(this.elapsedMs, 30_000)
    this.lockoutDirector.rearm(this.elapsedMs, 30_000)
    this.shellEl.classList.add('is-bypassing')
    this.later(() => this.shellEl.classList.remove('is-bypassing'), 30_000)
    store.emit('terminal:line', {
      text: `>>>> TROJAN ${token.code} PUSHED -- their controls are down for 30s. MOVE.`,
      tone: 'success',
      speed: 0,
    })
    this.flashToken('TROJAN BYPASS', token.code)
  }

  /** A full-width banner, because spending a token should feel like an event. */
  private flashToken(label: string, code: string): void {
    const el = document.createElement('div')
    el.className = 'token-flash'
    const t = document.createElement('div')
    t.className = 'token-flash__title'
    t.textContent = label
    const c = document.createElement('div')
    c.className = 'token-flash__code'
    c.textContent = code
    el.append(t, c)
    this.shellEl.appendChild(el)
    this.later(() => el.remove(), 1800)
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

    // Depth-scaled, so pushing deeper is worth visibly more than grinding
    // the shallow layers -- a flat bonus made the sixth breakthrough feel
    // no better earned than the first.
    const depthIndex = LAYER_ORDER.indexOf(cleared.id) + 1
    const bonus = 250 * depthIndex
    awardScore(this.state, bonus)
    this.heat.add(-30)

    // Sweep the board, then reopen at the new depth -- the visible
    // "simplify, then get busy again" beat.
    this.director.clearAll()
    this.explicitTarget = null
    this.setTarget(null)
    this.budget.reset()

    const next = this.layers.breakthrough()
    this.deepestThisRun = next.id
    this.maybeSeedArtifact(next.id)
    this.showBreakthroughCard(next, depthIndex, bonus)
    this.breakthroughGraceUntil = this.elapsedMs + BREAKTHROUGH_GRACE_MS

    // Repaint the whole UI for the new depth -- this is what makes each
    // layer read as a different place rather than the same green screen.
    // A locked-in real target keeps its brand-derived palette throughout
    // the descent instead of reverting to the generic fictional one.
    applyLayerPalette(this.activePalettes?.[next.id] ?? next.palette)
    applyLayerSkin(next.id)
    // Corruption on the real TARGET window scales with the same depth --
    // clean at SURFACE, tearing/glitched by PHYSICAL.
    this.targetSite?.setDepth(next.id)

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

  /**
   * The reward moment for clearing a layer.
   *
   * A terminal line and a color change were doing all the work, and both
   * scroll past in a second -- "no sense of progression." This is a
   * deliberate beat: the screen states how deep you now are, what it cost
   * them, and what you just unlocked, and holds it long enough to land.
   */
  private showBreakthroughCard(next: LayerDef, depthIndex: number, bonus: number): void {
    const el = document.createElement('div')
    el.className = 'breakthrough-card'

    const depth = document.createElement('div')
    depth.className = 'breakthrough-card__depth'
    depth.textContent = `DEPTH ${depthIndex + 1} / ${LAYER_ORDER.length}`

    const title = document.createElement('div')
    title.className = 'breakthrough-card__title'
    title.textContent = next.title

    const pips = document.createElement('div')
    pips.className = 'breakthrough-card__pips'
    for (let i = 0; i < LAYER_ORDER.length; i++) {
      const pip = document.createElement('span')
      pip.className = `breakthrough-card__pip${i <= depthIndex ? ' is-lit' : ''}`
      pips.appendChild(pip)
    }

    const unlock = document.createElement('div')
    unlock.className = 'breakthrough-card__unlock'
    const tools = next.unlocks.map((id) => PANEL_LABELS[id] ?? id).join(', ')
    unlock.textContent = tools ? `NEW TOOL UNLOCKED -- ${tools}` : next.modifierText.toUpperCase()

    const score = document.createElement('div')
    score.className = 'breakthrough-card__score'
    score.textContent = `+${bonus}`

    el.append(depth, title, pips, unlock, score)
    this.shellEl.appendChild(el)
    setTimeout(() => el.remove(), 2400)
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
    this.explicitTarget = null
    this.setTarget(null)
    this.budget.reset()
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

    // Building control means the cameras are yours -- the original brief's
    // payoff shot. Staggered so they arrive as a bank coming online.
    for (let i = 0; i < 3; i++) {
      this.later(
        () =>
          spawnCamWindow({
            manager: this.windows,
            rng: this.rng,
            labelPrefix: this.target.org.toUpperCase(),
            kind: i === 2 ? 'thermal' : 'cctv',
            ttlMs: 16000,
          }),
        400 + i * 550,
      )
    }
    this.targetSite?.showDefaced(this.target.org)

    const kinds: ThreatKind[] = ['traceback', 'reverseShell', 'lockdown']
    this.runThreatWave(kinds, 7, 12000, (successes, total) => this.finishFinale(successes, total))
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
    this.endContract('completed')
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

  /**
   * The contract is over -- hand control back to the dashboard.
   *
   * Replaces the old in-session "roll straight into another random org"
   * loop. A run is now a bounded job with an outcome, and choosing the next
   * one happens on the contract board.
   */
  /**
   * Escape is a reflex key -- players hit it to dismiss popups. Wiring it
   * straight to "end the contract" meant one stray press silently threw
   * away the run and dumped you on the menu, which read as the game
   * crashing. It asks first now.
   */
  private confirmAbort(): void {
    if (this.destroyed || this.abortPrompt) return
    const win = this.windows.spawn(
      { title: 'ABORT CONTRACT?', modal: true, closable: false, decor: 'danger' },
      'center',
    )
    this.abortPrompt = win
    const body = document.createElement('div')
    const p = document.createElement('p')
    p.textContent = `Disconnect from ${this.target.org} and abandon this job? Progress on this contract is lost.`
    body.appendChild(p)
    win.setBody(body)
    win.addButtonRow([
      { label: 'STAY IN', onClick: () => { this.abortPrompt = null; win.close() } },
      { label: 'ABORT', onClick: () => { this.abortPrompt = null; win.close(); this.abortContract() } },
    ])
    win.onClose(() => { this.abortPrompt = null })
  }

  /** Bail out of the current contract and go back to the dashboard. */
  private abortContract(): void {
    if (this.destroyed) return
    store.emit('terminal:line', { text: '>> SESSION ABORTED -- disconnecting', tone: 'warning', speed: 0 })
    this.finishSession('aborted')
  }

  private endContract(kind: SessionOutcome['kind'], delayMs = 4200): void {
    this.later(() => this.finishSession(kind), delayMs)
  }
}
