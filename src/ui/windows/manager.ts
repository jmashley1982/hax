import { int, type Rng } from '@/core/rng'
import { Win, type WindowOptions } from './window'

/**
 * How many throwaway (unpinned, non-modal) windows may be alive at once --
 * background process windows and transient dialogs. Task panels are pinned
 * and never counted against this.
 */
const MAX_TRANSIENT = 6

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

  constructor(mountPoint: HTMLElement, private rng: Rng) {
    this.layer = document.createElement('div')
    this.layer.className = 'win-layer'
    mountPoint.appendChild(this.layer)
  }

  get hasModal(): boolean {
    return this.modalStack.length > 0
  }

  spawn(
    opts: Omit<WindowOptions, 'x' | 'y'>,
    placement: Placement = 'cascade',
  ): Win {
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
      if (win.isModal) {
        this.modalStack = this.modalStack.filter((w) => w !== win)
        if (this.modalStack.length === 0) this.removeBackdrop()
      }
    })

    win.el.addEventListener('pointerdown', () => {
      this.zCounter += 1
      win.focus(this.zCounter)
    })

    // Evict the oldest *unpinned* windows when the desk gets crowded.
    // Pinned windows (task panels, the TARGET site) are exempt -- the
    // Director owns their lifecycle and closing one mid-solve would destroy
    // player work.
    //
    // The budget counts ONLY evictable windows. It used to compare the
    // total non-modal count against the cap, which meant the pinned task
    // panels alone (5-7 of them at the deep layers) already exceeded it --
    // so every background process window was culled the instant it opened,
    // exactly where the churn is supposed to be heaviest.
    const evictable = this.windows.filter((w) => !w.isModal && !w.isPinned)
    for (let i = 0; i <= evictable.length - MAX_TRANSIENT; i++) {
      evictable[i]?.close()
    }

    return win
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

  private computePosition(placement: Placement): { x: number; y: number } {
    const vw = Math.max(window.innerWidth, 480)
    const vh = Math.max(window.innerHeight, 360)
    if (placement === 'center') {
      return { x: vw / 2 - 190, y: vh / 2 - 110 }
    }
    if (placement === 'random') {
      // Task panels place into loose slots across the right ~72% of the
      // screen (the left strip belongs to the terminal), jittered so the
      // board looks scattered and busy rather than gridded. Slots account
      // for panel size (PANEL_W/H) so spawns don't stack on top of each
      // other -- overlap should come from the player dragging, not from
      // the spawner piling windows in one corner.
      const PANEL_W = 300
      const PANEL_H = 210
      const fieldLeft = Math.round(vw * 0.26)
      const fieldTop = 90
      const cols = Math.max(1, Math.floor((vw - fieldLeft - 24) / PANEL_W))
      const rows = Math.max(1, Math.floor((vh - fieldTop - 90) / PANEL_H))
      const slot = this.cascadeIndex % (cols * rows)
      this.cascadeIndex += 1
      const col = slot % cols
      const row = Math.floor(slot / cols)
      const spreadW = (vw - fieldLeft - PANEL_W - 24) / Math.max(1, cols - 1)
      const spreadH = (vh - fieldTop - PANEL_H - 90) / Math.max(1, rows - 1)
      return {
        x: fieldLeft + col * (cols > 1 ? spreadW : 0) + int(this.rng, -14, 14),
        y: fieldTop + row * (rows > 1 ? spreadH : 0) + int(this.rng, -14, 14),
      }
    }
    this.cascadeIndex = (this.cascadeIndex + 1) % 8
    return { x: 80 + this.cascadeIndex * 28, y: 100 + this.cascadeIndex * 24 }
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
