import { hex, int } from '@/core/rng'
import type { WindowManager } from '@/ui/windows/manager'
import { TaskPanel, type PanelContext } from './panel'

/**
 * SIGNAL ALIGN -- drag/step a tuner until the trace locks into its band.
 * The feedback here is the picture itself: the waveform visibly cleans up
 * as you approach, which is the most legible feedback in the app. Three
 * sequential locks to clear it.
 *
 * This is the deepest-layer panel and the eventual camera-feed tuner for
 * the finale (plan §8) -- same verb, bigger payoff.
 */
export class SignalAlignPanel extends TaskPanel {
  private wave!: HTMLElement
  private readout!: HTMLElement
  private slider!: HTMLInputElement
  private target = 50
  private locks = 0
  private neededLocks = 3

  constructor(manager: WindowManager, ctx: PanelContext) {
    super(manager, ctx, `signalAlign-${hex(ctx.rng, 4)}`, `SIGNAL LOCK ${hex(ctx.rng, 2).toUpperCase()}`)
    this.init()
  }

  get objectiveText(): string {
    return `DRAG the tuner into the band (${this.locks}/${this.neededLocks} locked)`
  }

  protected buildBody(): void {
    this.neededLocks = 2 + Math.round(this.intensity * 2)
    this.target = int(this.rng, 18, 82)

    const hint = document.createElement('div')
    hint.className = 'panel__hint'
    hint.textContent = 'tune until the signal locks'
    this.root.appendChild(hint)

    this.wave = document.createElement('div')
    this.wave.className = 'signal-wave'
    this.root.appendChild(this.wave)

    this.readout = document.createElement('div')
    this.readout.className = 'signal-readout'
    this.root.appendChild(this.readout)

    this.slider = document.createElement('input')
    this.slider.type = 'range'
    this.slider.min = '0'
    this.slider.max = '100'
    this.slider.value = '0'
    this.slider.className = 'signal-slider'
    this.slider.addEventListener('input', () => this.evaluate())
    // Keystrokes must not leak to the global handler while dragging here.
    this.slider.addEventListener('keydown', (e) => e.stopPropagation())
    this.root.appendChild(this.slider)

    this.evaluate()
    this.updateTitle()
  }

  override onKeyBurst(): boolean {
    if (this.isDone) return false
    // Mashing steps the tuner toward the band -- slower than dragging, but
    // never a no-op.
    const current = Number(this.slider.value)
    const step = current < this.target ? 4 : -4
    this.slider.value = String(Math.max(0, Math.min(100, current + step)))
    this.evaluate()
    return true
  }

  private evaluate(): void {
    if (this.isDone) return
    const value = Number(this.slider.value)
    const distance = Math.abs(value - this.target)
    const quality = Math.max(0, 100 - distance * 3)

    // The waveform physically cleans up as quality climbs.
    this.wave.style.setProperty('--wave-noise', String(1 - quality / 100))
    this.wave.classList.toggle('is-locked', quality >= 92)
    this.readout.textContent = `LOCK QUALITY ${Math.round(quality)}%`

    if (quality >= 92) this.lockBand()
  }

  private lockBand(): void {
    this.locks += 1
    this.floatText(`LOCK ${this.locks}`)
    this.addProgress(1 / this.neededLocks)
    this.updateTitle()
    if (this.isDone) return
    // Retune to a new band for the next lock.
    this.target = int(this.rng, 18, 82)
    this.slider.value = String(int(this.rng, 0, 100))
    this.evaluate()
  }

  private updateTitle(): void {
    this.setTitleSuffix(`${this.locks}/${this.neededLocks} LOCKED`)
  }
}
