import type { WindowManager } from '@/ui/windows/manager'

/**
 * Desktop icons in the taskbar.
 *
 * The bar was designed to hold these from the start (see layout.ts) and
 * held only the prompt and the status line. They are not decoration: the
 * trashcan is the payoff for the PURGE verb in the vault-pull panel, and
 * WIPE.sh is a real one-shot ability.
 *
 * The trash closes a loop the brief described exactly: an ally warns you
 * about a batch of files, you run the scan, you purge what it flags, and
 * "your desktop trashcan shows its full now. click on it and empty
 * trash". Purging previously rewarded you with nothing but the absence
 * of a mistake.
 */

export interface DesktopIconsOptions {
  manager: WindowManager
  /** Contract intel, shown by README. */
  intel: string
  org: string
  line: (text: string) => void
  /** Emptying the trash pays out. */
  onEmptied: (count: number) => void
  /** WIPE.sh -- a one-shot heat dump. Returns false if still on cooldown. */
  onWipe: () => boolean
  /** How many ambient spawns the board budget has turned away. */
  suppressedCount: () => number
}

interface TrashItem {
  name: string
  corrupted: boolean
}

export class DesktopIcons {
  private el: HTMLElement
  private trash: TrashItem[] = []
  private trashIcon!: HTMLElement
  private trashLabel!: HTMLElement
  private heldEl!: HTMLElement
  private wipeUsed = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(mount: HTMLElement, private opts: DesktopIconsOptions) {
    this.el = document.createElement('div')
    this.el.className = 'icons'

    this.trashIcon = this.makeIcon('🗑', 'TRASH', () => this.openTrash())
    this.trashLabel = this.trashIcon.querySelector('.icons__label') as HTMLElement

    const readme = this.makeIcon('📄', 'README', () => this.openReadme())
    const wipe = this.makeIcon('⌫', 'WIPE.sh', () => this.runWipe())

    // The budget deliberately turns ambient popups away when the board is
    // full. Without a readout that reads as the game going quiet rather
    // than as the system holding traffic back.
    this.heldEl = document.createElement('span')
    this.heldEl.className = 'icons__held'

    this.el.append(this.trashIcon, readme, wipe, this.heldEl)
    mount.appendChild(this.el)

    this.paint()
    this.timer = setInterval(() => this.paintHeld(), 1000)
  }

  private makeIcon(glyph: string, label: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('button')
    btn.className = 'icons__icon'
    btn.title = label
    const g = document.createElement('span')
    g.className = 'icons__glyph'
    g.textContent = glyph
    const l = document.createElement('span')
    l.className = 'icons__label'
    l.textContent = label
    btn.append(g, l)
    btn.addEventListener('click', onClick)
    return btn
  }

  /** A file was shredded off the remote share. */
  addToTrash(item: TrashItem): void {
    this.trash.push(item)
    this.paint()
  }

  /** The chain's PURGE step flags a batch at once. */
  addManyToTrash(count: number, label: string): void {
    for (let i = 0; i < count; i++) {
      this.trash.push({ name: `${label}_${String(i + 1).padStart(2, '0')}`, corrupted: true })
    }
    this.paint()
  }

  private paint(): void {
    const n = this.trash.length
    this.trashIcon.classList.toggle('is-full', n > 0)
    this.trashLabel.textContent = n > 0 ? `TRASH (${n})` : 'TRASH'
    this.paintHeld()
  }

  private paintHeld(): void {
    const n = this.opts.suppressedCount()
    this.heldEl.textContent = n > 0 ? `${n} HELD` : ''
  }

  private openTrash(): void {
    const win = this.opts.manager.spawn(
      { title: 'TRASH', modal: false, closable: true, decor: 'normal', span: { cols: 1, rows: 1 } },
      'random',
    )
    win.el.classList.add('trashwin')

    const body = document.createElement('div')
    body.className = 'trashwin__body'

    if (this.trash.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'trashwin__empty'
      empty.textContent = 'Trash is empty.'
      body.appendChild(empty)
      win.setBody(body)
      return
    }

    const list = document.createElement('div')
    list.className = 'trashwin__list'
    for (const item of this.trash.slice(-12)) {
      const row = document.createElement('div')
      row.className = `trashwin__row${item.corrupted ? ' is-bad' : ''}`
      row.textContent = item.name
      list.appendChild(row)
    }

    const btn = document.createElement('button')
    btn.className = 'trashwin__empty-btn'
    btn.textContent = `EMPTY TRASH (${this.trash.length})`
    btn.addEventListener('click', () => {
      const n = this.trash.length
      this.trash = []
      this.paint()
      list.classList.add('is-shredding')
      btn.disabled = true
      btn.textContent = 'SHREDDING...'
      setTimeout(() => {
        this.opts.onEmptied(n)
        this.opts.line(`trash emptied -- ${n} file${n === 1 ? '' : 's'} unrecoverable`)
        win.close()
      }, 700)
    })

    body.append(list, btn)
    win.setBody(body)
  }

  private openReadme(): void {
    const win = this.opts.manager.spawn(
      { title: 'README.txt', modal: false, closable: true, decor: 'normal' },
      'random',
    )
    win.el.classList.add('readmewin')
    const body = document.createElement('div')
    body.className = 'readmewin__body'
    body.textContent = `TARGET: ${this.opts.org}\n\nINTEL: ${this.opts.intel}\n\nKeep your integrity up. Scan anything that looks wrong before you pull it. Purge what the scan flags.`
    win.setBody(body)
  }

  private runWipe(): void {
    if (this.wipeUsed) {
      this.opts.line('wipe.sh already spent this run')
      return
    }
    if (!this.opts.onWipe()) return
    this.wipeUsed = true
    this.el.querySelectorAll('.icons__icon')[2]?.classList.add('is-spent')
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.el.remove()
  }
}
