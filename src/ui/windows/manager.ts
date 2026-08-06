import { int, type Rng } from '@/core/rng'
import { Win, type WindowOptions } from './window'

/**
 * Nominal window footprint used to lay out the occupancy grid. Real
 * windows vary a little around this; the grid only has to be close enough
 * that neighbouring slots do not visibly collide.
 */
const SLOT_W = 280
const SLOT_H = 245

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

  constructor(mountPoint: HTMLElement, private rng: Rng) {
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
    // A priority window never queues behind clutter. Only when the board
    // is actually full does it take an ambient slot by force -- a warning
    // you cannot see because six process windows got there first is worse
    // than no warning at all. Evicting unconditionally would thin the
    // board every time a message arrived, which is the opposite problem.
    if (opts.priority) {
      const cap = this.getCapacity?.() ?? Infinity
      if (this.budgetedCount >= cap) this.evictOldestAmbient()
    }
    const { x, y } = this.computePosition(placement)
    const win = new Win({ ...opts, x, y })

    this.zCounter += 1
    win.focus(this.zCounter)
    this.layer.appendChild(win.el)
    this.windows.push(win)

    if (win.isModal) {
      this.modalStack.push(win)
      this.ensureBackdrop()
    }

    win.onClose(() => {
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
    const vw = Math.max(window.innerWidth, 480)
    const vh = Math.max(window.innerHeight, 360)
    const fieldLeft = Math.round(Math.min(vw * 0.22, 330))
    const cols = Math.max(1, Math.floor((vw - fieldLeft - 24) / SLOT_W))
    const rows = Math.max(1, Math.floor((vh - 90 - 90) / SLOT_H))
    return cols * rows
  }

  /**
   * Windows that count against the board budget: everything the spawner
   * put there, minus the fixtures. The TARGET dossier, task panels the
   * Director owns, hostiles, threats and modals are the game talking to
   * you -- starving those would be worse than the pile.
   */
  get budgetedCount(): number {
    return this.windows.filter((w) => !w.isModal && !w.isFixture && !w.isClosed).length
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
  private avoidRect: DOMRect | null = null

  setAvoidRect(rect: DOMRect | null): void {
    this.avoidRect = rect
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
  private slotTaken(x: number, y: number): boolean {
    for (const w of this.windows) {
      if (w.isClosed) continue
      const el = w.el
      const wx = el.offsetLeft
      const wy = el.offsetTop
      const ww = el.offsetWidth || SLOT_W
      const wh = el.offsetHeight || SLOT_H
      // Deliberately generous: touching edges still counts as a collision,
      // because two windows flush against each other read as a pile.
      if (x < wx + ww && x + SLOT_W > wx && y < wy + wh && y + SLOT_H > wy) return true
    }
    return false
  }

  private computePosition(placement: Placement): { x: number; y: number } {
    const vw = Math.max(window.innerWidth, 480)
    const vh = Math.max(window.innerHeight, 360)

    // Preferred spots for the non-grid placements. If the preferred spot is
    // free we take it; if not we fall through to the grid search rather
    // than dropping a window on top of whatever is already there. Skipping
    // this check is what left the TARGET dossier permanently overlapped by
    // centre-placed threat windows.
    if (placement === 'center') {
      const p = { x: vw / 2 - 190, y: vh / 2 - 110 }
      if (!this.slotTaken(p.x, p.y)) return this.clampToBoard(p, vw, vh)
    }
    if (placement === 'cascade') {
      this.cascadeIndex = (this.cascadeIndex + 1) % 8
      const p = { x: 80 + this.cascadeIndex * 28, y: 100 + this.cascadeIndex * 24 }
      if (!this.slotTaken(p.x, p.y)) return this.clampToBoard(p, vw, vh)
    }

    {
      // Task panels place into loose slots across the right ~72% of the
      // screen (the left strip belongs to the terminal), jittered so the
      // board looks scattered and busy rather than gridded. Slots account
      // for panel size (PANEL_W/H) so spawns don't stack on top of each
      // other -- overlap should come from the player dragging, not from
      // the spawner piling windows in one corner.
      const PANEL_W = 300
      const PANEL_H = 210
      const fieldLeft = Math.round(Math.min(vw * 0.22, 330))
      const fieldTop = 90
      const cols = Math.max(1, Math.floor((vw - fieldLeft - 24) / PANEL_W))
      const rows = Math.max(1, Math.floor((vh - fieldTop - 90) / PANEL_H))
      const spreadW = (vw - fieldLeft - PANEL_W - 24) / Math.max(1, cols - 1)
      const spreadH = (vh - fieldTop - PANEL_H - 90) / Math.max(1, rows - 1)
      // Walk every slot looking for one that is genuinely free, starting
      // from a rotating offset so the board does not always fill
      // top-left-first. Only if the whole grid is occupied do we fall back
      // to the least-bad option -- which the budget should make rare.
      const slots = Math.max(1, cols * rows)
      const start = this.cascadeIndex % slots
      this.cascadeIndex += 1
      let fallback: { x: number; y: number } | null = null

      for (let i = 0; i < slots; i++) {
        const slot = (start + i) % slots
        const col = slot % cols
        const row = Math.floor(slot / cols)
        // Jitter is small and applied AFTER the occupancy test would be
        // meaningful, so it never pushes a window into its neighbour.
        const candidate = {
          x: Math.round(fieldLeft + col * (cols > 1 ? spreadW : 0) + int(this.rng, -6, 6)),
          y: Math.round(fieldTop + row * (rows > 1 ? spreadH : 0) + int(this.rng, -6, 6)),
        }
        fallback ??= candidate
        if (this.slotTaken(candidate.x, candidate.y)) continue
        if (this.overlapsAvoid(candidate.x, candidate.y)) continue
        return this.clampToBoard(candidate, vw, vh)
      }
      return this.clampToBoard(fallback ?? { x: fieldLeft, y: fieldTop }, vw, vh)
    }
  }

  /** Never place a window where part of it cannot be reached. */
  private clampToBoard(p: { x: number; y: number }, vw: number, vh: number): { x: number; y: number } {
    return {
      x: Math.max(8, Math.min(p.x, vw - SLOT_W - 12)),
      y: Math.max(52, Math.min(p.y, vh - 140)),
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
