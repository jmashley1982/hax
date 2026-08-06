import { playSfx } from '@/audio/sounds'
import type { Rng } from '@/core/rng'
import { Win, type WindowOptions } from './window'

/**
 * Nominal window footprint used to lay out the occupancy grid. Real
 * windows vary a little around this; the grid only has to be close enough
 * that neighbouring slots do not visibly collide.
 */
const SLOT_W = 268
const SLOT_H = 228

export type Placement = 'cascade' | 'center' | 'random'

/**
 * Owns z-order, the modal backdrop/stack, and a cap on concurrent
 * non-modal windows (oldest evicted first -- reads as system instability,
 * which fits the theme, rather than an unbounded pile of dead windows).
 */
export class WindowManager {
  private layer: HTMLElement
  private backdrop: HTMLElement | null = null
  private windows: Win[] = []
  private modalStack: Win[] = []
  private zCounter = 10
  private cascadeIndex = 0
  /** Notified whenever a budgeted (non-modal, non-pinned) window closes. */
  private closeListeners: Array<() => void> = []

  /**
   * `rng` is retained deliberately: placement is now deterministic (a real
   * occupancy search rather than a jittered guess), but the seeded stream
   * has to keep its shape for `?seed=` reproducibility, and future
   * placement variation belongs on this stream rather than a fresh one.
   */
  constructor(mountPoint: HTMLElement, _rng: Rng) {
    this.layer = document.createElement('div')
    this.layer.className = 'win-layer'
    mountPoint.appendChild(this.layer)
  }

  /** Set by the Shell so priority spawns know when the board is genuinely full. */
  private getCapacity: (() => number) | null = null

  setCapacityProvider(fn: () => number): void {
    this.getCapacity = fn
  }

  onWindowClosed(fn: () => void): void {
    this.closeListeners.push(fn)
  }

  get hasModal(): boolean {
    return this.modalStack.length > 0
  }

  spawn(
    opts: Omit<WindowOptions, 'x' | 'y'>,
    placement: Placement = 'cascade',
  ): Win {
    const span = opts.span ?? { cols: 1, rows: 1 }
    // A priority window never queues behind clutter. Only when the board
    // is actually full does it take an ambient slot by force -- a warning
    // you cannot see because six process windows got there first is worse
    // than no warning at all. Evicting unconditionally would thin the
    // board every time a message arrived, which is the opposite problem.
    if (opts.priority) {
      const cap = this.getCapacity?.() ?? Infinity
      if (this.budgetedCount >= cap) this.evictOldestAmbient()
    }
    const { x, y } = this.computePosition(placement, span)
    const win = new Win({ ...opts, x, y })

    this.zCounter += 1
    win.focus(this.zCounter)
    this.layer.appendChild(win.el)
    this.windows.push(win)
    // Both chirps live here rather than in Win, because the manager is the
    // only thing that opens windows and the only thing notified when one
    // closes -- putting them on Win would mean two call sites and a
    // guaranteed drift.
    playSfx('winOpen')

    if (win.isModal) {
      this.modalStack.push(win)
      this.ensureBackdrop()
    }

    win.onClose(() => {
      playSfx('winClose')
      this.windows = this.windows.filter((w) => w !== win)
      if (!win.isModal && !win.isFixture) {
        for (const fn of this.closeListeners) fn()
      }
      if (win.isModal) {
        this.modalStack = this.modalStack.filter((w) => w !== win)
        if (this.modalStack.length === 0) this.removeBackdrop()
      }
    })

    win.el.addEventListener('pointerdown', () => {
      this.zCounter += 1
      win.focus(this.zCounter)
    })

    // No eviction pass here any more.
    //
    // MAX_TRANSIENT was a second, independent cap that fought the board
    // budget: it closed windows the budget still believed were alive, so
    // the two disagreed about how full the board was. sim/boardBudget.ts
    // is now the single authority on how many windows may exist, and it
    // gates the SPAWN rather than cleaning up afterwards. A window that
    // opened was allowed to open, and it stays until its own lifetime
    // ends or the player closes it.
    return win
  }

  /**
   * How many windows the board can hold without any of them overlapping.
   *
   * This is what makes the no-overlap guarantee structural rather than
   * hopeful: the board budget clamps itself to this, so the placement
   * search always has a free slot to find. Measured before the clamp
   * existed, a 1440x900 board offered 9 slots while the budget allowed 15
   * windows -- six of them had nowhere to go and piled up.
   */
  get gridSlots(): number {
    const { cols, rows } = this.grid()
    return cols * rows
  }

  /**
   * The placement grid, measured from the WORK AREA rather than the
   * viewport.
   *
   * This is the whole point of the desktop regions. Previously the grid
   * was derived from window.innerWidth/Height minus guessed insets for
   * the terminal strip, the HUD and the status bar -- numbers that had to
   * agree with four separate stylesheets and did not. Now the work area
   * is a real box that owns its space, so "how many windows fit without
   * overlapping" is a question with an actual answer.
   */
  private grid(): { cols: number; rows: number; w: number; h: number } {
    const w = Math.max(this.layer.clientWidth, 320)
    const h = Math.max(this.layer.clientHeight, 240)
    return {
      cols: Math.max(1, Math.floor(w / SLOT_W)),
      rows: Math.max(1, Math.floor(h / SLOT_H)),
      w,
      h,
    }
  }

  /**
   * Windows that count against the board budget: everything the spawner
   * put there, minus the fixtures. The TARGET dossier, task panels the
   * Director owns, hostiles, threats and modals are the game talking to
   * you -- starving those would be worse than the pile.
   */
  /**
   * Live AMBIENT windows: popups the spawner put there.
   *
   * Task panels are pinned and the Director owns their count, fixtures
   * are exempt entirely -- so this is the only number the ambient gate
   * should be looking at. Counting panels against the same budget meant
   * panel churn (75 spawns in a 170-second run) kept the shared total at
   * the ceiling and refused roughly two ambient draws in three.
   */
  get ambientCount(): number {
    let n = 0
    for (const w of this.windows) {
      if (w.isModal || w.isFixture || w.isPinned || w.isClosed) continue
      n += w.span.cols * w.span.rows
    }
    return n
  }

  get budgetedCount(): number {
    // Counted in SLOTS, not windows: a spanning window genuinely occupies
    // more of the board, so it has to cost more of the budget or the cap
    // stops meaning anything about how full the screen looks.
    let n = 0
    for (const w of this.windows) {
      if (w.isModal || w.isFixture || w.isClosed) continue
      n += w.span.cols * w.span.rows
    }
    return n
  }

  /** Make room for a priority window by dropping the oldest ambient one. */
  evictOldestAmbient(): boolean {
    const victim = this.windows.find((w) => !w.isModal && !w.isPinned && !w.isDragging)
    if (!victim) return false
    victim.close()
    return true
  }

  closeAll(): void {
    for (const w of [...this.windows]) w.close()
  }

  /**
   * Sweep throwaway windows (background process windows, warning dialogs)
   * while leaving pinned ones alone.
   *
   * Used by the lockout, which wipes the desk without taking down the
   * TARGET site window -- closeAll() would, and the Shell holds a
   * long-lived reference to that panel, so it would be left pointing at a
   * closed window.
   */
  closeTransient(): void {
    for (const w of [...this.windows]) {
      if (!w.isPinned) w.close()
    }
  }

  /**
   * A rect ambient windows should try not to land on -- set by the Shell to
   * the panel the player is currently working. Without this, background
   * windows spawn straight on top of the thing being used, which is exactly
   * the "windows pop up over it as you're using" complaint.
   */
  private avoidRect: { left: number; top: number; right: number; bottom: number } | null = null

  /**
   * Takes a viewport rect and stores it in WORK-AREA coordinates.
   *
   * Placement works in the layer's coordinate space (offsetLeft/offsetTop),
   * so a raw getBoundingClientRect() would be offset by however far the
   * work area sits from the viewport origin -- the avoid test would then
   * be protecting a rectangle nowhere near the panel in use.
   */
  setAvoidRect(rect: DOMRect | null): void {
    if (!rect) {
      this.avoidRect = null
      return
    }
    const base = this.layer.getBoundingClientRect()
    this.avoidRect = {
      left: rect.left - base.left,
      top: rect.top - base.top,
      right: rect.right - base.left,
      bottom: rect.bottom - base.top,
    }
  }

  private overlapsAvoid(x: number, y: number, w = SLOT_W, h = SLOT_H): boolean {
    const r = this.avoidRect
    if (!r) return false
    return x < r.right && x + w > r.left && y < r.bottom && y + h > r.top
  }

  /**
   * Is this slot already occupied by a live window?
   *
   * The old placement jittered a slot index and checked nothing, so two
   * windows could -- and constantly did -- land on the same spot. Because
   * the board budget now caps how many windows exist, and the cap is below
   * the slot count, checking real occupancy actually SOLVES the layout
   * rather than just reducing the odds.
   */
  private slotTaken(x: number, y: number, spanW = SLOT_W, spanH = SLOT_H): boolean {
    for (const w of this.windows) {
      if (w.isClosed) continue
      const el = w.el
      const wx = el.offsetLeft
      const wy = el.offsetTop
      // Measure conservatively. A window is spawned and THEN given its
      // body, so anything created earlier in the same tick reports a
      // height from before its content existed -- the TARGET dossier
      // measured ~40px tall while it is really ~300, and panels were
      // handed the slot it was about to grow into. Never assume a window
      // is smaller than one slot.
      const ww = Math.max(el.offsetWidth, SLOT_W)
      const wh = Math.max(el.offsetHeight, SLOT_H)
      // Deliberately generous: touching edges still counts as a collision,
      // because two windows flush against each other read as a pile.
      if (x < wx + ww && x + spanW > wx && y < wy + wh && y + spanH > wy) return true
    }
    return false
  }

  private computePosition(
    placement: Placement,
    span: { cols: number; rows: number } = { cols: 1, rows: 1 },
  ): { x: number; y: number } {
    const { cols, rows, w, h } = this.grid()
    // A spanning window has to clear every slot it covers, not just the
    // one its top-left corner lands in.
    const spanW = SLOT_W * span.cols
    const spanH = SLOT_H * span.rows

    // Preferred spots for the non-grid placements. If the preferred spot
    // is free we take it; otherwise we fall through to the grid search
    // rather than dropping a window on top of what is already there.
    // Skipping this check is what left the TARGET dossier permanently
    // overlapped by centre-placed threat windows.
    if (placement === 'center') {
      const p = { x: Math.round(w / 2 - spanW / 2), y: Math.round(h / 2 - spanH / 2) }
      if (!this.slotTaken(p.x, p.y, spanW, spanH)) return this.clampToBoard(p, w, h, spanW)
    }
    if (placement === 'cascade') {
      this.cascadeIndex = (this.cascadeIndex + 1) % 8
      const p = { x: 12 + this.cascadeIndex * 22, y: 10 + this.cascadeIndex * 18 }
      if (!this.slotTaken(p.x, p.y, spanW, spanH)) return this.clampToBoard(p, w, h, spanW)
    }

    // Spread the slots evenly across the work area rather than packing
    // them left, so a half-full board still looks like a desktop.
    // A window spanning N columns cannot start in the last N-1 of them.
    const startCols = Math.max(1, cols - (span.cols - 1))
    const startRows = Math.max(1, rows - (span.rows - 1))
    const spreadW = cols > 1 ? (w - SLOT_W) / (cols - 1) : 0
    const spreadH = rows > 1 ? (h - SLOT_H) / (rows - 1) : 0
    const slots = Math.max(1, startCols * startRows)
    const start = this.cascadeIndex % slots
    this.cascadeIndex += 1
    let fallback: { x: number; y: number } | null = null

    for (let i = 0; i < slots; i++) {
      const slot = (start + i) % slots
      const col = slot % startCols
      const row = Math.floor(slot / startCols)
      const candidate = {
        x: Math.round(col * spreadW),
        y: Math.round(row * spreadH),
      }
      fallback ??= candidate
      if (this.slotTaken(candidate.x, candidate.y, spanW, spanH)) continue
      if (this.overlapsAvoid(candidate.x, candidate.y, spanW, spanH)) continue
      return this.clampToBoard(candidate, w, h, spanW)
    }
    return this.clampToBoard(fallback ?? { x: 0, y: 0 }, w, h, spanW)
  }

  /** Never place a window where part of it cannot be reached. */
  private clampToBoard(
    p: { x: number; y: number },
    w: number,
    h: number,
    spanW = SLOT_W,
  ): { x: number; y: number } {
    // Coordinates are relative to the work area now, so the clamp is just
    // "inside the box" rather than a set of guessed viewport insets.
    return {
      x: Math.max(0, Math.min(p.x, Math.max(0, w - spanW))),
      y: Math.max(0, Math.min(p.y, Math.max(0, h - 120))),
    }
  }

  private ensureBackdrop(): void {
    if (this.backdrop) return
    this.backdrop = document.createElement('div')
    this.backdrop.className = 'win-backdrop'
    this.layer.insertBefore(this.backdrop, this.layer.firstChild)
  }

  private removeBackdrop(): void {
    this.backdrop?.remove()
    this.backdrop = null
  }
}
