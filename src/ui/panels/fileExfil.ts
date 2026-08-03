import { hex, int, pick } from '@/core/rng'
import type { WindowManager } from '@/ui/windows/manager'
import { TaskPanel, type PanelContext } from './panel'

const NAMES = [
  'payroll_q4', 'access_matrix', 'staff_roster', 'vault_manifest',
  'incident_rpt', 'keychain', 'cam_index', 'badge_db', 'contracts',
]
const EXTS = ['sql', 'csv', 'pem', 'db', 'zip', 'log']

/**
 * FILE EXFIL -- click rows to start transfers; clicking an in-flight row
 * boosts it. Several run at once, so this is the panel that rewards
 * managing a queue rather than hammering one thing, and it keeps ticking
 * in the background while you work other panels.
 */
export class FileExfilPanel extends TaskPanel {
  private rows: Array<{ el: HTMLElement; fill: HTMLElement; pct: number; done: boolean }> = []
  private doneCount = 0

  constructor(manager: WindowManager, ctx: PanelContext) {
    super(manager, ctx, `fileExfil-${hex(ctx.rng, 4)}`, `EXFIL ${hex(ctx.rng, 3).toUpperCase()}`)
    this.init()
  }

  get objectiveText(): string {
    return `CLICK files to pull them (${this.doneCount}/${this.rows.length} exfiltrated)`
  }

  protected buildBody(): void {
    const count = 3 + Math.round(this.intensity * 2)

    const hint = document.createElement('div')
    hint.className = 'panel__hint'
    hint.textContent = 'click a file to pull it -- click again to boost'
    this.root.appendChild(hint)

    const list = document.createElement('div')
    list.className = 'exfil-list'

    for (let i = 0; i < count; i++) {
      const row = document.createElement('button')
      row.className = 'exfil-row'

      const label = document.createElement('span')
      label.className = 'exfil-row__name'
      label.textContent = `${pick(this.rng, NAMES)}.${pick(this.rng, EXTS)}`

      const size = document.createElement('span')
      size.className = 'exfil-row__size'
      size.textContent = `${int(this.rng, 4, 980)}K`

      const bar = document.createElement('span')
      bar.className = 'exfil-row__bar'
      const fill = document.createElement('span')
      fill.className = 'exfil-row__fill'
      bar.appendChild(fill)

      row.append(label, size, bar)
      const entry = { el: row, fill, pct: 0, done: false }
      row.addEventListener('click', () => this.pull(entry))
      this.rows.push(entry)
      list.appendChild(row)
    }
    this.root.appendChild(list)
    this.updateTitle()
  }

  override onKeyBurst(): void {
    const next = this.rows.find((r) => !r.done)
    if (next) this.pull(next)
  }

  private pull(entry: { el: HTMLElement; fill: HTMLElement; pct: number; done: boolean }): void {
    if (this.isDone || entry.done) return

    entry.pct = Math.min(100, entry.pct + 24)
    entry.fill.style.width = `${entry.pct}%`
    entry.el.classList.add('is-pulling')
    this.pulse()

    if (entry.pct >= 100) {
      entry.done = true
      entry.el.classList.add('is-done')
      this.doneCount += 1
      this.floatText('+PULLED')
      this.addProgress(1 / this.rows.length)
    }
    this.updateTitle()
  }

  private updateTitle(): void {
    this.setTitleSuffix(`${this.doneCount}/${this.rows.length} PULLED`)
  }
}
