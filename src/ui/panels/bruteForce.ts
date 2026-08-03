import { hex, int } from '@/core/rng'
import type { WindowManager } from '@/ui/windows/manager'
import { TaskPanel, type PanelContext } from './panel'

/**
 * BRUTE FORCE -- the panel that makes key-mashing feel powerful.
 *
 * Every keystroke while this panel is targeted jumps the bar and
 * re-scrambles the candidate string, so hammering the keyboard produces a
 * visibly thrashing readout. The bar decays when you stop, which is what
 * makes the connection between "I am mashing" and "it is moving"
 * unmistakable -- stop and it visibly sags.
 */
export class BruteForcePanel extends TaskPanel {
  private readout!: HTMLElement
  private target: string
  private decayPerSec = 0.05

  constructor(manager: WindowManager, ctx: PanelContext) {
    const id = `brute-${hex(ctx.rng, 4)}`
    super(manager, ctx, id, `BRUTE FORCE ${hex(ctx.rng, 4).toUpperCase()}`)
    this.target = hex(this.rng, 12).toUpperCase()
    this.init()
  }

  get objectiveText(): string {
    return 'HOLD/MASH ANY KEYS to brute-force the key'
  }

  protected buildBody(): void {
    const hint = document.createElement('div')
    hint.className = 'panel__hint'
    hint.textContent = 'mash keys to force the key'
    this.root.appendChild(hint)

    this.readout = document.createElement('div')
    this.readout.className = 'panel__readout'
    this.readout.textContent = this.scramble()
    this.root.appendChild(this.readout)

    // Clicking the panel body also advances it, so a mouse-only player is
    // never locked out of a mash-oriented panel.
    this.root.style.cursor = 'pointer'
    this.root.addEventListener('click', () => this.hit())

    this.setTitleSuffix('0%')
  }

  override onKeyBurst(): boolean {
    if (this.isDone) return false
    this.hit()
    return true
  }

  /** Called from the shell's tick so the bar visibly sags when input stops. */
  tickDecay(dtMs: number): void {
    if (this.isDone) return
    this.decayProgress((this.decayPerSec * dtMs) / 1000)
    this.setTitleSuffix(`${Math.round(this.progress * 100)}%`)
  }

  private hit(): void {
    if (this.isDone) return
    // Reveal progressively more of the "real" key as the bar fills, so the
    // readout visibly converges instead of staying pure noise.
    this.addProgress(0.035)
    this.readout.textContent = this.scramble()
    this.setTitleSuffix(`${Math.round(this.progress * 100)}%`)
  }

  private scramble(): string {
    const revealed = Math.floor(this.progress * this.target.length)
    let out = ''
    for (let i = 0; i < this.target.length; i++) {
      out += i < revealed ? this.target[i] : int(this.rng, 0, 15).toString(16).toUpperCase()
    }
    return out.replace(/(.{4})/g, '$1 ').trim()
  }

  protected override complete(): void {
    this.readout.textContent = this.target.replace(/(.{4})/g, '$1 ').trim()
    super.complete()
  }
}
