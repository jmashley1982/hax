import { hex, shuffle } from '@/core/rng'
import type { WindowManager } from '@/ui/windows/manager'
import { TaskPanel, type PanelContext } from './panel'

/**
 * KEY RECOVERY -- a grid of hidden byte pairs. Click to reveal; two
 * matching bytes lock together permanently. Forgiving by design: a
 * mismatch just re-hides after a beat, no penalty, no timer.
 */
export class KeyRecoveryPanel extends TaskPanel {
  private cells: Array<{ el: HTMLElement; value: string; locked: boolean }> = []
  private revealed: number[] = []
  private pairsFound = 0
  private totalPairs = 0
  private busy = false

  constructor(manager: WindowManager, ctx: PanelContext) {
    super(manager, ctx, `keyRecovery-${hex(ctx.rng, 4)}`, `KEY RECOVERY ${hex(ctx.rng, 2).toUpperCase()}`)
    this.init()
  }

  get objectiveText(): string {
    return `CLICK cells to match byte pairs (${this.pairsFound}/${this.totalPairs} recovered)`
  }

  protected buildBody(): void {
    this.totalPairs = 3 + Math.round(this.intensity * 2)

    const hint = document.createElement('div')
    hint.className = 'panel__hint'
    hint.textContent = 'reveal matching byte pairs'
    this.root.appendChild(hint)

    const values: string[] = []
    for (let i = 0; i < this.totalPairs; i++) {
      const v = hex(this.rng, 2).toUpperCase()
      values.push(v, v)
    }
    const deck = shuffle(this.rng, values)

    const grid = document.createElement('div')
    grid.className = 'cell-grid'
    grid.style.gridTemplateColumns = `repeat(${Math.min(6, this.totalPairs)}, 1fr)`

    deck.forEach((value, i) => {
      const el = document.createElement('button')
      el.className = 'cell'
      el.textContent = '··'
      const entry = { el, value, locked: false }
      el.addEventListener('click', () => this.reveal(i))
      this.cells.push(entry)
      grid.appendChild(el)
    })
    this.root.appendChild(grid)
    this.updateTitle()
  }

  override onKeyBurst(): void {
    if (this.busy) return
    const idx = this.cells.findIndex((c, i) => !c.locked && !this.revealed.includes(i))
    if (idx >= 0) this.reveal(idx)
  }

  private reveal(idx: number): void {
    if (this.isDone || this.busy) return
    const cell = this.cells[idx]
    if (!cell || cell.locked || this.revealed.includes(idx)) return

    cell.el.textContent = cell.value
    cell.el.classList.add('is-open')
    this.revealed.push(idx)
    this.pulse()

    if (this.revealed.length < 2) return

    const [aIdx, bIdx] = this.revealed as [number, number]
    const a = this.cells[aIdx]!
    const b = this.cells[bIdx]!
    this.revealed = []

    if (a.value === b.value) {
      a.locked = b.locked = true
      a.el.classList.add('is-locked')
      b.el.classList.add('is-locked')
      this.pairsFound += 1
      this.floatText('+PAIR')
      this.addProgress(1 / this.totalPairs)
      this.updateTitle()
      return
    }

    // Mismatch: re-hide after a beat. No penalty -- easy by design.
    this.busy = true
    setTimeout(() => {
      for (const c of [a, b]) {
        if (c.locked) continue
        c.el.textContent = '··'
        c.el.classList.remove('is-open')
      }
      this.busy = false
    }, 500)
  }

  private updateTitle(): void {
    this.setTitleSuffix(`${this.pairsFound}/${this.totalPairs} PAIRS`)
  }
}
