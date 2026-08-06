import { int, type Rng } from '@/core/rng'

/**
 * A generated street grid on a canvas.
 *
 * Extracted from ui/manhunt.ts so the facility cards in
 * ui/windows/intelWindow.ts can draw on the same substrate rather than a
 * second, subtly different implementation of the same thing. The manhunt
 * keeps its own overlay (search radius, blinking marker, confidence
 * readout); only the grid itself is shared.
 *
 * Deliberately TWO functions rather than one. `Manhunt.tick` redraws
 * every frame, and regenerating the grid each time would jitter the
 * streets around -- which reads as noise, not as a map. Splitting
 * generation from drawing makes that requirement explicit instead of
 * leaving it to a lazy-init `if (!this.streets)` inside a draw call.
 *
 * A real map tile is not an option and never will be: this app makes
 * zero external network requests and has to work opened from `file://`.
 */

export interface StreetGrid {
  readonly lines: ReadonlyArray<{ v: boolean; p: number; w: number }>
}

/**
 * Build a stable grid for a canvas of the given size.
 *
 * The rng consumption order and count is load-bearing: seven vertical
 * streets then five horizontal, each drawing a position and then a width
 * roll. Changing that sequence shifts every subsequent draw on the same
 * stream, so a seeded manhunt would diverge from the run before it.
 */
export function makeStreetGrid(rng: Rng, w: number, h: number): StreetGrid {
  const lines: Array<{ v: boolean; p: number; w: number }> = []
  for (let i = 0; i < 7; i++) lines.push({ v: true, p: int(rng, 8, w - 8), w: rng() < 0.25 ? 2 : 1 })
  for (let i = 0; i < 5; i++) lines.push({ v: false, p: int(rng, 8, h - 8), w: rng() < 0.25 ? 2 : 1 })
  return { lines }
}

export interface StreetStyle {
  bg?: string
  stroke?: string
}

/** Paint the background and the streets. Callers overlay their own marks. */
export function drawStreetGrid(
  ctx: CanvasRenderingContext2D,
  grid: StreetGrid,
  w: number,
  h: number,
  style: StreetStyle = {},
): void {
  ctx.fillStyle = style.bg ?? '#0a0c10'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = style.stroke ?? 'rgba(120,150,170,0.5)'
  for (const s of grid.lines) {
    ctx.lineWidth = s.w
    ctx.beginPath()
    if (s.v) {
      ctx.moveTo(s.p, 0)
      ctx.lineTo(s.p, h)
    } else {
      ctx.moveTo(0, s.p)
      ctx.lineTo(w, s.p)
    }
    ctx.stroke()
  }
}
