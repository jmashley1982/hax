import { hex, int, shuffle } from '@/core/rng'
import type { WindowManager } from '@/ui/windows/manager'
import { TaskPanel, type PanelContext } from './panel'

/**
 * PORT SCAN -- a grid of ports. Click each to probe it: open ones flip
 * green and count toward the goal, closed ones dim out harmlessly. Clear
 * all the open ports to crack the panel.
 *
 * Deliberately forgiving (plan §13c "easy, not a skill test"): clicking a
 * closed port costs nothing, so the only way to play is forward. Every
 * click flips a cell, which is the point -- the action visibly lands on a
 * specific thing.
 */
export class PortScanPanel extends TaskPanel {
  private openPorts = new Set<number>()
  private foundCount = 0
  private totalOpen = 0

  constructor(manager: WindowManager, ctx: PanelContext) {
    const id = `ports-${hex(ctx.rng, 4)}`
    super(manager, ctx, id, `PORT SCAN ${int(ctx.rng, 10, 99)}.${int(ctx.rng, 10, 99)}`)
    this.init()
  }

  get objectiveText(): string {
    return `CLICK the open ports (${this.foundCount}/${this.totalOpen} found)`
  }

  protected buildBody(): void {
    const cellCount = 12 + Math.floor(this.intensity * 8) // 12-20 cells
    this.totalOpen = Math.max(3, Math.round(cellCount * 0.35))

    const indices = shuffle(this.rng, Array.from({ length: cellCount }, (_, i) => i))
    for (let i = 0; i < this.totalOpen; i++) this.openPorts.add(indices[i]!)

    const hint = document.createElement('div')
    hint.className = 'panel__hint'
    hint.textContent = 'probe ports -- find the open ones'
    this.root.appendChild(hint)

    const grid = document.createElement('div')
    grid.className = 'cell-grid'
    grid.style.gridTemplateColumns = 'repeat(4, 1fr)'

    for (let i = 0; i < cellCount; i++) {
      const cell = document.createElement('button')
      cell.className = 'cell'
      cell.dataset.idx = String(i)
      cell.textContent = String(int(this.rng, 20, 9999))
      cell.addEventListener('click', () => this.probe(i, cell))
      grid.appendChild(cell)
    }
    this.root.appendChild(grid)
    this.updateTitle()
  }

  /**
   * Mashing probes a random unresolved cell. Every panel must do something
   * visible with a keystroke -- a targeted panel that ignores keys makes
   * mashing feel broken, which is the exact failure this rewrite exists to
   * fix. Clicking is still faster and more precise; this just guarantees a
   * key is never a no-op.
   */
  override onKeyBurst(): boolean {
    if (this.isDone) return false
    const cells = Array.from(this.root.querySelectorAll<HTMLElement>('.cell'))
    const unresolved = cells.filter(
      (c) => !c.classList.contains('is-open') && !c.classList.contains('is-closed'),
    )
    const target = unresolved[0]
    if (!target) return false
    this.probe(Number(target.dataset.idx), target)
    return true
  }

  private probe(idx: number, cell: HTMLElement): void {
    if (this.isDone) return
    if (cell.classList.contains('is-open') || cell.classList.contains('is-closed')) return

    cell.classList.add('is-flash')
    setTimeout(() => cell.classList.remove('is-flash'), 240)

    if (this.openPorts.has(idx)) {
      cell.classList.add('is-open')
      this.foundCount += 1
      this.floatText('+OPEN')
      this.addProgress(1 / this.totalOpen)
    } else {
      cell.classList.add('is-closed')
      // Still a visible reaction, just no progress -- never punishing.
      this.pulse()
    }
    this.updateTitle()
  }

  private updateTitle(): void {
    this.setTitleSuffix(`${this.foundCount}/${this.totalOpen} OPEN`)
  }
}
