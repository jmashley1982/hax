import { isMobileLayout } from '@/core/device'
import type { Rng } from '@/core/rng'
import type { WindowManager } from '@/ui/windows/manager'
import type { Win } from '@/ui/windows/window'

/**
 * Base class for every interactive task panel.
 *
 * This exists because the previous design routed everything into one
 * scrolling terminal, so no action ever hit a *specific visible thing* and
 * the app read as a video rather than a toy (plan §13c). A TaskPanel is
 * the opposite: a discrete window with visible state, clickable parts, and
 * a guaranteed visual reaction to every single input.
 *
 * Subclasses implement `buildBody()` (their own DOM + interactions) and
 * call `addProgress()` / `complete()` as the player acts. Everything else
 * -- focus/targeting, the hit flash, the progress rail, the completion
 * animation -- is handled here so no panel can forget to give feedback.
 */
export type PanelState = 'active' | 'cracked'

export interface PanelContext {
  rng: Rng
  /** Difficulty scalar 0..1 from layer depth -- panels stay easy, this only nudges size. */
  intensity: number
  /** Layer rule in effect (see LayerModifier) -- changes how panels behave, not just look. */
  modifier: string
  onComplete: (panel: TaskPanel) => void
  onProgress: (panel: TaskPanel, delta: number) => void

  /*
   * Vault-pull hooks. These used to be `static` fields on DragExfilPanel,
   * which made them survive the panel, the Director AND the whole Shell --
   * and a Shell is now constructed and destroyed once per contract. That
   * was not a theoretical leak:
   *
   *   maybeSeedArtifact() sets the objective filename when a run reaches
   *   the job's layer. If the run then ended -- aborted, burned, or on the
   *   finale -- before any vault-pull panel was built to claim it, the
   *   value survived into the NEXT contract. That contract's first
   *   vault-pull panel then rendered the *previous* job's objective file,
   *   marked as the objective, and dragging it fired onArtifactSecured
   *   into the new Shell: an instant win on a job that was never seeded.
   *
   * Per-instance, they cannot outlive the panel that was handed them.
   */

  /** The contract's objective filename, if this panel should carry it. */
  artifact?: string | null
  /** Fired when the objective file reaches the vault. */
  onArtifactSecured?: () => void
  /** Fired when a corrupted file reaches the vault -- triggers the reverse hack. */
  onCorrupted?: (panelId: string) => void
}

export abstract class TaskPanel {
  readonly win: Win
  readonly id: string
  state: PanelState = 'active'

  protected root: HTMLElement
  protected rng: Rng
  protected intensity: number

  private progressRail: HTMLElement
  private progressFill: HTMLElement
  private titleBase: string
  private ctx: PanelContext
  private progress01 = 0
  private sealed = false
  private sealEl: HTMLElement | null = null
  private lastTouched = 0

  constructor(manager: WindowManager, ctx: PanelContext, id: string, title: string) {
    this.id = id
    this.ctx = ctx
    this.rng = ctx.rng
    this.intensity = ctx.intensity
    this.titleBase = title

    this.win = manager.spawn({ title, modal: false, closable: false, pinned: true }, 'random')
    this.win.el.classList.add('panel')
    this.win.el.dataset.panelId = id

    this.root = document.createElement('div')
    this.root.className = 'panel__body'

    this.progressRail = document.createElement('div')
    this.progressRail.className = 'panel__rail'
    this.progressFill = document.createElement('div')
    this.progressFill.className = 'panel__rail-fill'
    this.progressRail.appendChild(this.progressFill)

    const wrap = document.createElement('div')
    wrap.appendChild(this.root)
    wrap.appendChild(this.progressRail)
    this.win.setBody(wrap)
  }

  /** Subclasses build their interactive DOM into `this.root` here. */
  protected abstract buildBody(): void

  /**
   * Raw keystrokes routed here when this panel is the focused target.
   *
   * Returns whether the keystroke was actually *used*. Panels that are
   * momentarily unable to act (mid-animation, nothing left to reveal)
   * return false so the shell can immediately hand the keystroke to
   * another panel. Without this, a panel with a short lockout silently
   * swallows hundreds of keypresses at mashing speed and the run appears
   * to freeze -- which is exactly what happened at the CORE layer.
   */
  onKeyBurst(): boolean {
    return false
  }

  /** Short human-readable "what to do" line, shown in the objective bar. */
  abstract get objectiveText(): string

  protected init(): void {
    this.buildBody()
    this.renderProgress()
    if (this.ctx.modifier === 'sealed' || this.ctx.modifier === 'total') this.applySeal()
  }

  /**
   * SEALED layers: the panel arrives behind a cover that takes one click
   * to break. Cheap to clear, but it changes the rhythm -- you must open
   * a node before you can work it.
   */
  private applySeal(): void {
    this.sealed = true
    const seal = document.createElement('button')
    seal.className = 'panel__seal'
    seal.textContent = isMobileLayout() ? '🔒 SEALED — TAP TO BREACH' : '🔒 SEALED — CLICK OR TYPE TO BREACH'
    seal.addEventListener('click', (e) => {
      e.stopPropagation()
      this.breakSeal()
    })
    this.win.el.appendChild(seal)
    this.sealEl = seal
  }

  /**
   * Breaking the seal is available to *both* clicking and typing on
   * purpose: making it click-only stalled the flow in deeper layers,
   * forcing the player to stop mashing and hunt for windows.
   */
  protected breakSeal(): void {
    if (!this.sealed) return
    this.sealed = false
    this.sealEl?.classList.add('is-breaking')
    const el = this.sealEl
    setTimeout(() => el?.remove(), 260)
    this.sealEl = null
    this.floatText('UNSEALED')
    this.pulse()
  }

  /** DECAY layers: untouched panels slowly bleed progress. */
  tickDecayModifier(dtMs: number): void {
    if (this.isDone || this.sealed) return
    if (this.ctx.modifier !== 'decay' && this.ctx.modifier !== 'total') return
    const idleMs = performance.now() - this.lastTouched
    if (idleMs < 2500) return
    this.decayProgress((0.02 * dtMs) / 1000)
  }

  get element(): HTMLElement {
    return this.win.el
  }

  get isDone(): boolean {
    return this.state === 'cracked'
  }

  get isSealed(): boolean {
    return this.sealed
  }

  /** Public entry point for the shell to spend a keystroke on the seal. */
  breakSealFromInput(): void {
    this.breakSeal()
  }

  /** LINKED layers: a sibling crack pushes this panel along too. */
  applyLinkedBoost(amount: number): void {
    if (this.isDone || this.sealed) return
    this.floatText('+LINKED')
    this.addProgress(amount)
  }

  setTargeted(targeted: boolean): void {
    this.win.el.classList.toggle('is-targeted', targeted && !this.isDone)
  }

  /**
   * Advance this panel. Always produces a visible reaction -- the rail
   * moves and the window pulses -- so no input can ever feel ignored.
   */
  protected addProgress(delta01: number): void {
    if (this.isDone) return
    // A sealed panel absorbs the input as a nudge, but doesn't advance --
    // the seal has to be broken first.
    if (this.sealed) {
      this.pulse()
      return
    }
    this.lastTouched = performance.now()
    this.progress01 = Math.min(1, this.progress01 + delta01)
    this.renderProgress()
    this.pulse()
    this.ctx.onProgress(this, delta01)
    // Epsilon, not `>= 1`. Panels advance by 1/N per step, and N additions
    // of 1/N sum to 0.999... in floating point -- so an exact comparison
    // left finished panels stuck at "6/6" forever, swallowing every
    // subsequent keystroke and freezing the run.
    if (this.progress01 >= 0.999) this.complete()
  }

  /** Decay for panels that require sustained input (brute force). */
  protected decayProgress(delta01: number): void {
    if (this.isDone) return
    this.progress01 = Math.max(0, this.progress01 - delta01)
    this.renderProgress()
  }

  protected get progress(): number {
    return this.progress01
  }

  protected setTitleSuffix(suffix: string): void {
    this.win.setTitle(`${this.titleBase} :: ${suffix}`)
  }

  /** A brief flash on the panel -- the universal "your input landed" signal. */
  protected pulse(): void {
    this.win.el.classList.remove('is-hit')
    // Force reflow so the animation can retrigger on rapid repeat input.
    void this.win.el.offsetWidth
    this.win.el.classList.add('is-hit')
  }

  /** Floating "+N" style feedback anchored to the panel. */
  protected floatText(text: string): void {
    const el = document.createElement('div')
    el.className = 'panel__float'
    el.textContent = text
    this.win.el.appendChild(el)
    setTimeout(() => el.remove(), 900)
  }

  protected complete(): void {
    if (this.isDone) return
    this.state = 'cracked'
    this.progress01 = 1
    this.renderProgress()
    this.win.el.classList.add('is-cracked')
    this.setTitleSuffix('CRACKED')
    this.floatText('CRACKED')
    this.ctx.onComplete(this)
    setTimeout(() => this.win.close(), 1400)
  }

  private renderProgress(): void {
    this.progressFill.style.width = `${Math.round(this.progress01 * 100)}%`
  }
}
