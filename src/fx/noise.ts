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

  /** Draw a fresh grain frame at low opacity into the given 2D context. */
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
    // Coarse loop: fill in 2x2 blocks for a cheaper, grainier look and far
    // fewer RNG draws than one-per-pixel.
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const v = Math.floor(this.rng() * 255)
        this.setBlock(data, width, height, x, y, v)
      }
    }
    ctx.save()
    ctx.globalAlpha = opacity
    ctx.putImageData(this.imageData, 0, 0)
    ctx.restore()
  }

  private setBlock(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    x: number,
    y: number,
    v: number,
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
        data[i + 3] = 255
      }
    }
  }
}
