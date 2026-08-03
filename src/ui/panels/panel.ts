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
  onComplete: (panel: TaskPanel) => void
  onProgress: (panel: TaskPanel, delta: number) => void
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
   * Panels that don't reward mashing can ignore it (default: no-op).
   */
  onKeyBurst(): void {}

  /** Short human-readable "what to do" line, shown in the objective bar. */
  abstract get objectiveText(): string

  protected init(): void {
    this.buildBody()
    this.renderProgress()
  }

  get element(): HTMLElement {
    return this.win.el
  }

  get isDone(): boolean {
    return this.state === 'cracked'
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
    this.progress01 = Math.min(1, this.progress01 + delta01)
    this.renderProgress()
    this.pulse()
    this.ctx.onProgress(this, delta01)
    if (this.progress01 >= 1) this.complete()
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
