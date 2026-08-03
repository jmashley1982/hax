import { mulberry32, type Rng } from '@/core/rng'

/**
 * Shared static/grain noise renderer. Reused by the CRT overlay (fx/crt.ts)
 * and, from Phase 7 onward, the synthetic CCTV feeds — one noise
 * implementation, drawn onto whichever canvas needs it, so we're not
 * paying for N independent noise generators (see plan §12, performance).
 */
export class NoiseField {
  private rng: Rng
  private imageData: ImageData | null = null

  constructor(seed: number) {
    this.rng = mulberry32(seed)
  }

  /**
   * Draw a fresh grain frame at low opacity into the given 2D context.
   *
   * The opacity is baked into each pixel's own alpha channel, not applied
   * via `ctx.globalAlpha`. `putImageData()` ignores `globalAlpha` (and all
   * other canvas compositing state) entirely -- it writes the raw pixel
   * buffer directly. Setting `ctx.globalAlpha` here was a no-op; the grain
   * was rendering fully opaque and blotting out everything beneath it.
   */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, opacity: number): void {
    if (width <= 0 || height <= 0) return
    if (
      !this.imageData ||
      this.imageData.width !== width ||
      this.imageData.height !== height
    ) {
      this.imageData = ctx.createImageData(width, height)
    }
    const data = this.imageData.data
    const alpha = Math.round(clamp01(opacity) * 255)
    // Coarse loop: fill in 2x2 blocks for a cheaper, grainier look and far
    // fewer RNG draws than one-per-pixel.
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const v = Math.floor(this.rng() * 255)
        this.setBlock(data, width, height, x, y, v, alpha)
      }
    }
    ctx.putImageData(this.imageData, 0, 0)
  }

  private setBlock(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    x: number,
    y: number,
    v: number,
    alpha: number,
  ): void {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const px = x + dx
        const py = y + dy
        if (px >= width || py >= height) continue
        const i = (py * width + px) * 4
        data[i] = v
        data[i + 1] = v
        data[i + 2] = v
        data[i + 3] = alpha
      }
    }
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
