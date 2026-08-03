import { int, type Rng } from '@/core/rng'
import { Win, type WindowOptions } from './window'

const MAX_NONMODAL = 6

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

    const nonModal = this.windows.filter((w) => !w.isModal)
    if (nonModal.length > MAX_NONMODAL) {
      nonModal[0]?.close()
    }

    return win
  }

  closeAll(): void {
    for (const w of [...this.windows]) w.close()
  }

  private computePosition(placement: Placement): { x: number; y: number } {
    const vw = Math.max(window.innerWidth, 480)
    const vh = Math.max(window.innerHeight, 360)
    if (placement === 'center') {
      return { x: vw / 2 - 190, y: vh / 2 - 110 }
    }
    if (placement === 'random') {
      return { x: int(this.rng, 40, vw - 380), y: int(this.rng, 80, vh - 280) }
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
