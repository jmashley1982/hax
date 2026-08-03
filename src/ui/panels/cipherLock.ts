import { hex, int, pick } from '@/core/rng'
import type { WindowManager } from '@/ui/windows/manager'
import { TaskPanel, type PanelContext } from './panel'

const GLYPHS = '0123456789ABCDEF'.split('')

/**
 * CIPHER LOCK -- a row of glyphs, each cycling through values. Click one to
 * advance it; when it hits its correct value it locks green and stops
 * responding. Clear every slot to crack the panel.
 *
 * The reward here is precision rather than speed: each click is a discrete,
 * visible step toward a lock, and locked slots stay locked, so the panel
 * reads as steadily solving rather than fighting back.
 */
export class CipherLockPanel extends TaskPanel {
  private slots: Array<{ el: HTMLElement; current: number; target: number; locked: boolean }> = []
  private lockedCount = 0

  constructor(manager: WindowManager, ctx: PanelContext) {
    const id = `cipher-${hex(ctx.rng, 4)}`
    super(manager, ctx, id, `CIPHER LOCK ${hex(ctx.rng, 3).toUpperCase()}`)
    this.init()
  }

  get objectiveText(): string {
    return `CLICK glyphs to align the cipher (${this.lockedCount}/${this.slots.length} locked)`
  }

  protected buildBody(): void {
    const slotCount = 4 + Math.floor(this.intensity * 3) // 4-7 slots

    const hint = document.createElement('div')
    hint.className = 'panel__hint'
    hint.textContent = 'click each glyph until it locks'
    this.root.appendChild(hint)

    const grid = document.createElement('div')
    grid.className = 'cell-grid'
    grid.style.gridTemplateColumns = `repeat(${slotCount}, 1fr)`

    for (let i = 0; i < slotCount; i++) {
      // Keep every slot within a few clicks of its target -- easy by design.
      const target = int(this.rng, 0, GLYPHS.length - 1)
      const offset = int(this.rng, 1, 4)
      const current = (target - offset + GLYPHS.length) % GLYPHS.length

      const el = document.createElement('button')
      el.className = 'cell'
      el.style.fontSize = '15px'
      el.textContent = pick(this.rng, [GLYPHS[current]!])
      el.dataset.slot = String(i)
      const slot = { el, current, target, locked: false }
      el.addEventListener('click', () => this.advance(slot))
      this.slots.push(slot)
      grid.appendChild(el)
    }
    this.root.appendChild(grid)
    this.updateTitle()
  }

  /**
   * Mashing cycles the first unlocked glyph. Slower than clicking the right
   * tile deliberately, but guarantees a keystroke is never a no-op -- a
   * targeted panel that ignores keys is what made mashing feel broken.
   */
  override onKeyBurst(): boolean {
    if (this.isDone) return false
    const slot = this.slots.find((s) => !s.locked)
    if (!slot) return false
    this.advance(slot)
    return true
  }

  private advance(slot: { el: HTMLElement; current: number; target: number; locked: boolean }): void {
    if (this.isDone || slot.locked) return

    slot.current = (slot.current + 1) % GLYPHS.length
    slot.el.textContent = GLYPHS[slot.current]!
    slot.el.classList.add('is-flash')
    setTimeout(() => slot.el.classList.remove('is-flash'), 240)

    if (slot.current === slot.target) {
      slot.locked = true
      slot.el.classList.add('is-locked')
      this.lockedCount += 1
      this.floatText('+LOCK')
      this.addProgress(1 / this.slots.length)
    } else {
      this.pulse()
    }
    this.updateTitle()
  }

  private updateTitle(): void {
    this.setTitleSuffix(`${this.lockedCount}/${this.slots.length} LOCKED`)
  }
}
