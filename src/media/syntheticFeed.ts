import { mulberry32, type Rng } from '@/core/rng'
import type { FeedKind } from './videoRegistry'

/**
 * Canvas-rendered stand-in footage.
 *
 * The point is that the camera popups are fully playable before a single
 * real clip exists, and stay playable if a file is ever missing. This is
 * not a "no video" placeholder card -- it renders something that reads as
 * security footage at a glance: a dark scene with a moving figure, coarse
 * grain, interlace combing, a vignette, and burned-in timecode handled by
 * the window chrome around it.
 *
 * Deliberately cheap: ~10fps, small backing resolution scaled up, and it
 * stops rendering the moment its window closes. Several of these can be on
 * screen during a reverse hack without costing frames on the real board.
 */

const FPS = 10
/** Small backing buffer, upscaled -- gives the chunky low-bitrate look for free. */
const W = 160
const H = 96

interface Figure {
  x: number
  y: number
  vx: number
  w: number
  h: number
}

export class SyntheticFeed {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private rng: Rng
  private figures: Figure[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private frame = 0
  private dropUntil = 0
  private kind: FeedKind

  constructor(kind: FeedKind, seed: number) {
    this.kind = kind
    this.rng = mulberry32(seed)
    this.canvas = document.createElement('canvas')
    this.canvas.width = W
    this.canvas.height = H
    this.canvas.className = 'camwin__canvas'
    this.ctx = this.canvas.getContext('2d')

    const count = kind === 'webcam' ? 1 : 1 + Math.floor(this.rng() * 3)
    for (let i = 0; i < count; i++) {
      this.figures.push({
        x: this.rng() * W,
        y: H * (0.45 + this.rng() * 0.3),
        vx: (this.rng() < 0.5 ? -1 : 1) * (0.25 + this.rng() * 0.7),
        w: 4 + this.rng() * 4,
        h: 12 + this.rng() * 10,
      })
    }

    this.timer = setInterval(() => this.draw(), 1000 / FPS)
    this.draw()
  }

  private draw(): void {
    const ctx = this.ctx
    if (!ctx) return
    this.frame += 1

    // Occasional signal dropout -- the single strongest "this is a real
    // feed" tell, and it costs almost nothing.
    if (this.rng() < 0.012) this.dropUntil = this.frame + 2 + Math.floor(this.rng() * 4)
    if (this.frame < this.dropUntil) {
      this.drawNoise(ctx, 1)
      return
    }

    const warm = this.kind === 'thermal'
    ctx.fillStyle = warm ? '#0a0410' : '#0b0d0b'
    ctx.fillRect(0, 0, W, H)

    this.drawScene(ctx, warm)

    for (const f of this.figures) {
      f.x += f.vx
      if (f.x < -f.w) f.x = W + f.w
      if (f.x > W + f.w) f.x = -f.w
      // Slight bob so figures don't read as sliding cutouts.
      const bob = Math.sin((this.frame + f.x) * 0.4) * 0.8
      ctx.fillStyle = warm ? 'rgba(255,170,60,0.9)' : 'rgba(215,230,215,0.8)'
      ctx.fillRect(f.x, f.y - f.h + bob, f.w, f.h)
      ctx.fillStyle = warm ? 'rgba(255,220,140,0.95)' : 'rgba(235,245,235,0.85)'
      ctx.fillRect(f.x + f.w * 0.25, f.y - f.h - 3 + bob, f.w * 0.5, 3)
    }

    // Light grain only. At 0.16 the noise buried the scene and the feed
    // read as pure static rather than a dim room with someone in it.
    this.drawNoise(ctx, 0.06)
    this.drawInterlace(ctx)
    this.drawVignette(ctx)
  }

  /** A few fixed shapes so each feed reads as a specific place, not an empty box. */
  private drawScene(ctx: CanvasRenderingContext2D, warm: boolean): void {
    ctx.strokeStyle = warm ? 'rgba(180,90,220,0.35)' : 'rgba(150,170,150,0.22)'
    ctx.lineWidth = 1

    if (this.kind === 'webcam') {
      // desk edge + monitor glow
      ctx.fillStyle = 'rgba(120,150,190,0.12)'
      ctx.fillRect(W * 0.15, H * 0.1, W * 0.7, H * 0.42)
      ctx.beginPath()
      ctx.moveTo(0, H * 0.72)
      ctx.lineTo(W, H * 0.72)
      ctx.stroke()
      return
    }

    if (this.kind === 'doorcam') {
      ctx.strokeRect(W * 0.3, H * 0.25, W * 0.4, H * 0.7)
      ctx.beginPath()
      ctx.moveTo(0, H * 0.95)
      ctx.lineTo(W, H * 0.95)
      ctx.stroke()
      return
    }

    // cctv / thermal: floor line + receding pillars, i.e. a room
    ctx.beginPath()
    ctx.moveTo(0, H * 0.62)
    ctx.lineTo(W, H * 0.62)
    ctx.stroke()
    for (let i = 0; i < 4; i++) {
      const x = W * (0.12 + i * 0.25)
      ctx.beginPath()
      ctx.moveTo(x, H * 0.2)
      ctx.lineTo(x, H * 0.62)
      ctx.stroke()
    }
    // a couple of blinking rack/status LEDs
    for (let i = 0; i < 5; i++) {
      const on = (this.frame + i * 3) % (7 + i) < 3
      ctx.fillStyle = on ? 'rgba(90,255,140,0.8)' : 'rgba(30,70,40,0.5)'
      ctx.fillRect(W * (0.2 + i * 0.15), H * 0.28, 2, 2)
    }
  }

  private drawNoise(ctx: CanvasRenderingContext2D, amount: number): void {
    const img = ctx.getImageData(0, 0, W, H)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      if (this.rng() > amount) continue
      const n = (this.rng() * 255) | 0
      d[i] = n
      d[i + 1] = n
      d[i + 2] = n
    }
    ctx.putImageData(img, 0, 0)
  }

  private drawInterlace(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(0,0,0,0.2)'
    for (let y = this.frame % 2; y < H; y += 2) ctx.fillRect(0, y, W, 1)
  }

  private drawVignette(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.7)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
