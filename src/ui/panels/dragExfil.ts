import { hex, int, pick } from '@/core/rng'
import type { WindowManager } from '@/ui/windows/manager'
import { TaskPanel, type PanelContext } from './panel'
import { isMobileLayout } from '@/core/device'
import { beginInteraction, endInteraction } from '@/core/interaction'

/**
 * DRAG EXFIL -- pull files off the target and drop them in your local vault
 * (plan §16D).
 *
 * Two jobs. First, it breaks up the key mashing with a completely
 * different verb: you physically drag. Second, it is where the tables can
 * turn -- some files are corrupted, and dropping one into your own vault
 * is what invites the reverse hack in.
 *
 * The corruption is *inspectable*, never a coin flip: a bad file always
 * carries at least one visible tell (a checksum mismatch, an absurd size, a
 * double extension, an invalid signature). SCAN reveals a file's status
 * outright for a time cost, so the real decision is when to spend time
 * verifying versus just grabbing -- which is a judgement, not luck.
 *
 * Dragging is implemented with pointer events rather than HTML5
 * drag-and-drop, which does not fire on touch at all and would have made
 * this panel dead weight on the phone build.
 */

const CLEAN_NAMES = ['ledger', 'roster', 'schematic', 'contract', 'archive', 'index', 'manifest', 'backup']
const CLEAN_EXTS = ['sql', 'csv', 'db', 'tar', 'pdf', 'pem']

interface FileEntry {
  el: HTMLElement
  name: string
  corrupted: boolean
  tell: string
  scanned: boolean
  taken: boolean
  /** The contract's objective file. */
  isArtifact?: boolean
}

export class DragExfilPanel extends TaskPanel {
  private files: FileEntry[] = []
  private vault!: HTMLElement
  private pulled = 0
  private needed = 0
  private dragging: FileEntry | null = null
  private ghost: HTMLElement | null = null

  /** Set by the shell so a corrupted drop can trigger the reverse hack. */
  static onCorrupted: ((panelId: string) => void) | null = null

  /**
   * The contract's actual objective file, seeded by the Shell once the run
   * reaches the job's layer. The next panel built claims it, shows it as a
   * marked row, and clears the slot -- so the thing named in the brief is a
   * real object you have to find and pull, not flavour text.
   */
  static pendingArtifact: string | null = null
  static onArtifactSecured: (() => void) | null = null

  private artifactRow: FileEntry | null = null

  constructor(manager: WindowManager, ctx: PanelContext) {
    super(manager, ctx, `dragExfil-${hex(ctx.rng, 4)}`, `VAULT PULL ${hex(ctx.rng, 3).toUpperCase()}`)
    this.init()
  }

  get objectiveText(): string {
    return `DRAG clean files into the vault (${this.pulled}/${this.needed} secured)`
  }

  protected buildBody(): void {
    const total = 4 + Math.round(this.intensity * 2)
    // Always at least one bad file, and more the deeper you are -- but never
    // so many that a careful player can't make progress.
    const corruptCount = Math.max(1, Math.round(this.intensity * 2))
    this.needed = total - corruptCount

    const hint = document.createElement('div')
    hint.className = 'panel__hint'
    hint.textContent = isMobileLayout()
      ? 'drag files to the VAULT -- tap SCAN if one looks wrong'
      : 'drag files to the VAULT -- click SCAN if one looks wrong'
    this.root.appendChild(hint)

    const wrap = document.createElement('div')
    wrap.className = 'dexfil'

    const remote = document.createElement('div')
    remote.className = 'dexfil__remote'

    const flags = [...Array<boolean>(corruptCount).fill(true), ...Array<boolean>(total - corruptCount).fill(false)]
    // shuffle so the bad ones aren't always last
    for (let i = flags.length - 1; i > 0; i--) {
      const j = int(this.rng, 0, i)
      ;[flags[i], flags[j]] = [flags[j]!, flags[i]!]
    }

    for (const corrupted of flags) {
      remote.appendChild(this.buildFileRow(corrupted))
    }

    // Claim the objective file if one is waiting.
    const artifact = DragExfilPanel.pendingArtifact
    if (artifact) {
      DragExfilPanel.pendingArtifact = null
      const row = this.buildFileRow(false, artifact)
      row.classList.add('is-objective')
      remote.insertBefore(row, remote.firstChild)
      this.artifactRow = this.files[this.files.length - 1] ?? null
      if (this.artifactRow) this.artifactRow.isArtifact = true
    }

    this.vault = document.createElement('div')
    this.vault.className = 'dexfil__vault'
    this.vault.innerHTML = '<span class="dexfil__vault-label">LOCAL VAULT</span>'

    wrap.append(remote, this.vault)
    this.root.appendChild(wrap)
    this.updateTitle()
  }

  private buildFileRow(corrupted: boolean, forcedName?: string): HTMLElement {
    const base = pick(this.rng, CLEAN_NAMES)
    const ext = pick(this.rng, CLEAN_EXTS)
    const sizeK = corrupted && this.rng() < 0.4 ? int(this.rng, 90_000, 400_000) : int(this.rng, 8, 4000)

    // Every corrupted file gets exactly one visible tell, so it is always
    // *possible* to spot without scanning.
    const tells = [
      `CRC MISMATCH`,
      `SIG: INVALID`,
      `${sizeK}K -- SIZE ANOMALY`,
      `DOUBLE EXT`,
    ]
    const tell = corrupted ? pick(this.rng, tells) : ''
    const name = forcedName ?? (corrupted && tell === 'DOUBLE EXT' ? `${base}.${ext}.exe` : `${base}_${hex(this.rng, 2)}.${ext}`)

    const row = document.createElement('div')
    row.className = 'dexfil__file'

    const label = document.createElement('span')
    label.className = 'dexfil__name'
    label.textContent = name

    const meta = document.createElement('span')
    meta.className = 'dexfil__meta'
    meta.textContent = `${sizeK}K`

    const scan = document.createElement('button')
    scan.className = 'dexfil__scan'
    scan.textContent = 'SCAN'

    row.append(label, meta, scan)

    const entry: FileEntry = { el: row, name, corrupted, tell, scanned: false, taken: false }
    this.files.push(entry)

    scan.addEventListener('pointerdown', (e) => e.stopPropagation())
    scan.addEventListener('click', (e) => {
      e.stopPropagation()
      this.scan(entry)
    })
    row.addEventListener('pointerdown', (e) => this.startDrag(e, entry))

    return row
  }

  /** Reveals the truth outright -- the price is the time it costs you. */
  private scan(entry: FileEntry): void {
    if (entry.scanned || entry.taken) return
    entry.scanned = true
    entry.el.classList.add(entry.corrupted ? 'is-bad' : 'is-clean')
    const meta = entry.el.querySelector('.dexfil__meta') as HTMLElement | null
    if (meta) meta.textContent = entry.corrupted ? entry.tell : 'CLEAN'
    this.pulse()
  }

  // -- pointer dragging (works for mouse AND touch) -----------------------

  private startDrag(e: PointerEvent, entry: FileEntry): void {
    if (entry.taken || this.isDone) return
    e.preventDefault()
    this.dragging = entry
    entry.el.classList.add('is-dragging')
    beginInteraction()
    // Lift the whole panel while dragging so nothing can render between the
    // file and the vault it's headed for.
    this.win.el.classList.add('is-drag-host')
    // Capture so the drag survives the cursor crossing another window or
    // leaving the viewport; guarded because it throws on a dead pointer.
    try {
      entry.el.setPointerCapture(e.pointerId)
    } catch {
      /* non-fatal -- the window-level listeners below still drive the drag */
    }

    this.ghost = document.createElement('div')
    this.ghost.className = 'dexfil__ghost'
    this.ghost.textContent = entry.name
    document.body.appendChild(this.ghost)
    this.moveGhost(e.clientX, e.clientY)

    const move = (ev: PointerEvent): void => {
      this.moveGhost(ev.clientX, ev.clientY)
      const over = this.isOverVault(ev.clientX, ev.clientY)
      this.vault.classList.toggle('is-hot', over)
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('blur', cancel)
      this.win.el.classList.remove('is-drag-host')
      endInteraction()
      this.endDrag(ev.clientX, ev.clientY)
    }
    // A lost pointer (window blur, browser taking the gesture) must end the
    // drag too, or the ghost follows the cursor forever.
    const cancel = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('blur', cancel)
      this.win.el.classList.remove('is-drag-host')
      endInteraction()
      this.endDrag(-1, -1)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('blur', cancel)
  }

  private moveGhost(x: number, y: number): void {
    if (!this.ghost) return
    this.ghost.style.left = `${x + 12}px`
    this.ghost.style.top = `${y - 10}px`
  }

  private isOverVault(x: number, y: number): boolean {
    const r = this.vault.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }

  private endDrag(x: number, y: number): void {
    const entry = this.dragging
    this.dragging = null
    this.ghost?.remove()
    this.ghost = null
    this.vault.classList.remove('is-hot')
    if (!entry) return
    entry.el.classList.remove('is-dragging')
    if (!this.isOverVault(x, y)) return
    this.drop(entry)
  }

  private drop(entry: FileEntry): void {
    if (entry.taken || this.isDone) return
    entry.taken = true
    entry.el.classList.add('is-taken')

    if (entry.corrupted) {
      entry.el.classList.add('is-bad')
      this.floatText('INFECTED')
      this.vault.classList.add('is-breached')
      DragExfilPanel.onCorrupted?.(this.id)
      return
    }

    if (entry.isArtifact) {
      this.floatText('OBJECTIVE SECURED')
      DragExfilPanel.onArtifactSecured?.()
    }

    this.pulled += 1
    this.floatText('+SECURED')
    this.addProgress(1 / this.needed)
    this.updateTitle()
  }

  /**
   * Mashing cannot pull files -- that is the point of this panel. It scans
   * instead, so a keystroke is never wasted here but also never bypasses
   * the drag.
   */
  override onKeyBurst(): boolean {
    if (this.isDone) return false
    const next = this.files.find((f) => !f.scanned && !f.taken)
    if (!next) return false
    this.scan(next)
    return true
  }

  private updateTitle(): void {
    this.setTitleSuffix(`${this.pulled}/${this.needed} SECURED`)
  }
}
