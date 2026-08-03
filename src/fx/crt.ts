import { store } from '@/core/store'
import { NoiseField } from './noise'

/**
 * CRT overlay: scanlines, vignette and bloom are cheap CSS (see
 * styles/crt.css) — no per-frame cost. The only per-frame canvas work is a
 * faint grain pass, and even that is throttled well below 60fps because
 * film grain read as "flickering" rather than "moving" is more convincing
 * at a lower refresh anyway, and it's one less thing competing for frame
 * budget during a CHAOS mash spree (plan §12).
 */
const GRAIN_INTERVAL_MS = 1000 / 18 // ~18fps grain refresh
const GRAIN_OPACITY = 0.035

export class CrtOverlay {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private noise: NoiseField
  private accumulator = 0
  private unsubscribe: () => void

  constructor(mountPoint: HTMLElement, seed: number) {
    const layer = document.createElement('div')
    layer.className = 'crt-overlay'

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'crt-overlay__grain'
    layer.appendChild(this.canvas)

    const scanlines = document.createElement('div')
    scanlines.className = 'crt-overlay__scanlines'
    layer.appendChild(scanlines)

    const vignette = document.createElement('div')
    vignette.className = 'crt-overlay__vignette'
    layer.appendChild(vignette)

    mountPoint.appendChild(layer)

    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
    this.noise = new NoiseField(seed)

    this.resize()
    window.addEventListener('resize', this.resize)

    this.unsubscribe = store.on('tick', ({ dtRaw }) => this.onTick(dtRaw))
  }

  private resize = (): void => {
    // Grain is intentionally low-res and scaled up via CSS for a coarser,
    // more analog look, and because it's much cheaper to generate.
    this.canvas.width = Math.ceil(window.innerWidth / 2)
    this.canvas.height = Math.ceil(window.innerHeight / 2)
  }

  private onTick(dtRaw: number): void {
    this.accumulator += dtRaw
    if (this.accumulator < GRAIN_INTERVAL_MS) return
    this.accumulator = 0
    this.noise.draw(this.ctx, this.canvas.width, this.canvas.height, GRAIN_OPACITY)
  }

  destroy(): void {
    this.unsubscribe()
    window.removeEventListener('resize', this.resize)
  }
}
