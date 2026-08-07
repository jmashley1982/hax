import { float, hex, int, pick, shuffle } from '@/core/rng'
import type { WindowManager } from '@/ui/windows/manager'
import { TaskPanel, type PanelContext } from './panel'

/**
 * FILE SYSTEM NAVIGATOR -- fly through their storage and find the file.
 *
 * "i always loved this little 3d file system bit from Jurassic Park, so
 * lets incorporate that into one of the layers. not exactly like this, but
 * something similar in feel."
 *
 * The feel worth stealing is not the polygons, it is that the file system
 * is a PLACE. Every other panel here is a grid you solve from outside; in
 * this one you are inside the thing, the answer is somewhere over there,
 * and finding it means going and looking. That is why it earns a 2x2
 * window and a whole level of its own.
 *
 * Deliberately not a 3D engine: a fixed-height camera on rails over a
 * ground plane, one pinhole projection, painter's algorithm over ~24
 * directory platforms. Canvas 2D, no dependencies, ~200 lines of maths --
 * the same budget as media/entityMap.ts, which is the precedent for "the
 * one thing on screen that isn't a rectangle".
 *
 * The search fields are the other half of the original, and they are what
 * keep it from being a needle hunt: type part of a name, or bound the size
 * or the age, and everything that does not match dims out. Skill here is
 * knowing what to filter on, not flying well.
 */

/** Eye height, in world units, above the floor. */
const EYE_Y = 1.55
/** Focal length in pixels-at-unit-depth. Wider than life so more is in view. */
const FOCAL = 320
const MOVE_PER_STEP = 0.55
const TURN_PER_STEP = 0.09
/** Margin kept around the file tree, so you can circle it but not leave it. */
const MARGIN = 9

const DIR_NAMES = [
  'archive', 'backup', 'exports', 'finance', 'hr', 'legal', 'ops', 'projects',
  'research', 'scratch', 'shared', 'vault', 'logs', 'media', 'staging', 'tmp',
]
const FILE_STEMS = [
  'ledger', 'roster', 'manifest', 'minutes', 'schematic', 'invoice', 'contract',
  'payroll', 'audit', 'sample', 'transcript', 'inventory', 'permit', 'claim',
]
const FILE_EXTS = ['db', 'sql', 'csv', 'pem', 'tar', 'pdf', 'rgb', 'dat']

interface FileBlock {
  /** World position of the block's centre on the floor. */
  x: number
  z: number
  w: number
  d: number
  /** Height, which encodes size -- a big file is a tall block. */
  h: number
  name: string
  sizeKb: number
  ageDays: number
  isTarget: boolean
  /** Filled each frame by the projector, and reused for hit-testing. */
  screen: { x: number; y: number; w: number; h: number; depth: number } | null
  dim: boolean
}

interface Platform {
  x: number
  z: number
  size: number
  label: string
  files: FileBlock[]
}

export class FileSystem3dPanel extends TaskPanel {
  private canvas!: HTMLCanvasElement
  private ctx2d!: CanvasRenderingContext2D
  private platforms: Platform[] = []
  private cam = { x: 0, z: -9, yaw: 0 }
  private target!: FileBlock
  private raf = 0
  private readoutEl!: HTMLElement
  private filters = { name: '', size: '', age: '' }
  private dragging: { id: number; x: number; yaw: number } | null = null
  private selected: FileBlock | null = null
  private targeted = false
  private arrowHandler: ((e: KeyboardEvent) => void) | null = null
  /**
   * The extent of the file tree, plus a margin.
   *
   * The camera used to clamp to a fixed +-26 that had nothing to do with
   * where the world actually was, so flying forward took you straight out
   * the back of it into empty space -- the "empty window" in the report.
   * Computed from the geometry, so you can always see something.
   */
  private bounds = { minX: -12, maxX: 12, minZ: -12, maxZ: 12 }

  constructor(manager: WindowManager, ctx: PanelContext) {
    // Closable, uniquely among task panels. Every other panel can be
    // finished by mashing; this one cannot, so without a way out an
    // unsolved navigator sits on the board for the rest of the run --
    // reported exactly that way: "it never goes away, just an empty window
    // on the page for the rest of the game".
    super(manager, ctx, `fs3d-${hex(ctx.rng, 4)}`, 'FILE SYSTEM NAVIGATOR', { cols: 2, rows: 2 }, true)
    this.init()
  }

  get objectiveText(): string {
    return this.isDone
      ? 'located'
      : `FLY the tree and CLICK ${this.target?.name ?? 'the file'}`
  }

  // -- world -------------------------------------------------------------

  protected buildBody(): void {
    this.buildWorld()

    const hint = document.createElement('div')
    hint.className = 'panel__hint'
    hint.textContent = `find ${this.target.name} -- arrows fly, drag to look, click a block`

    const stage = document.createElement('div')
    stage.className = 'fsn'

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'fsn__canvas'
    const c = this.canvas.getContext('2d')
    if (!c) throw new Error('2d context unavailable')
    this.ctx2d = c

    const rail = document.createElement('div')
    rail.className = 'fsn__rail'
    rail.append(
      this.buildSearchField('name', 'NAME'),
      this.buildSearchField('size', 'SIZE >'),
      this.buildSearchField('age', 'AGE <'),
    )
    const home = document.createElement('button')
    home.className = 'fsn__home'
    home.textContent = 'RECENTER'
    home.addEventListener('click', (e) => {
      e.stopPropagation()
      this.recenter()
    })
    rail.appendChild(home)

    this.readoutEl = document.createElement('div')
    this.readoutEl.className = 'fsn__readout'
    rail.appendChild(this.readoutEl)

    stage.append(rail, this.canvas)
    this.root.append(hint, stage)

    this.recenter()
    this.bindInput()
    this.applyFilters()
    // rAF rather than the shell tick: this is a view, and it must keep
    // rendering while the simulation is paced by something else.
    const loop = (): void => {
      this.draw()
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
    this.win.onClose(() => cancelAnimationFrame(this.raf))
  }

  private buildWorld(): void {
    const rng = this.rng
    // Denser at depth, but never so dense the answer is unfindable.
    const cols = 4
    const rows = 5 + Math.round(this.intensity * 2)
    const spacing = 7.5
    const names = shuffle(rng, DIR_NAMES)

    const all: FileBlock[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = (c - (cols - 1) / 2) * spacing
        const pz = r * spacing + 4
        const label = `/${names[(r * cols + c) % names.length] ?? 'data'}`
        const files: FileBlock[] = []
        const count = int(rng, 1, 3)
        for (let i = 0; i < count; i++) {
          const w = float(rng, 1.0, 1.7, 2)
          const sizeKb = int(rng, 12, 900_000)
          const block: FileBlock = {
            // Files sit on their platform, offset so a stack reads as a stack.
            x: px + (i - (count - 1) / 2) * 1.9,
            z: pz,
            w,
            d: w,
            // Height encodes size, which is what makes "SIZE >" a visual
            // filter rather than a text one: after typing a bound, the
            // remaining tall blocks are the candidates.
            h: 0.5 + Math.min(3.2, Math.log10(sizeKb) * 0.72),
            name: `${pick(rng, FILE_STEMS)}_${hex(rng, 2)}.${pick(rng, FILE_EXTS)}`,
            sizeKb,
            ageDays: int(rng, 1, 2400),
            isTarget: false,
            screen: null,
            dim: false,
          }
          files.push(block)
          all.push(block)
        }
        this.platforms.push({ x: px, z: pz, size: spacing * 0.62, label, files })
      }
    }

    const halfW = ((cols - 1) / 2) * spacing
    const lastZ = (rows - 1) * spacing + 4
    this.bounds = {
      minX: -halfW - MARGIN,
      maxX: halfW + MARGIN,
      // Behind the front row you can still see the whole tree. The far
      // clamp stops a FULL ROW short of the back, because standing between
      // the last platforms leaves you looking down an empty aisle at
      // nothing -- measured, and it is indistinguishable from the panel
      // being broken.
      minZ: -MARGIN - 4,
      maxZ: Math.max(4, lastZ - spacing * 1.4),
    }

    // The objective file replaces a real one rather than being added, so the
    // count of blocks gives nothing away.
    const chosen = all[int(rng, 0, all.length - 1)]
    if (!chosen) throw new Error('no blocks generated')
    chosen.isTarget = true
    chosen.name = this.ctx.findTarget ?? `keyfile_${hex(rng, 3)}.db`
    this.target = chosen
  }

  // -- search ------------------------------------------------------------

  private buildSearchField(key: 'name' | 'size' | 'age', label: string): HTMLElement {
    const wrap = document.createElement('label')
    wrap.className = 'fsn__field'
    const l = document.createElement('span')
    l.textContent = label
    const input = document.createElement('input')
    input.className = 'fsn__input'
    input.spellcheck = false
    input.autocomplete = 'off'
    input.placeholder = key === 'name' ? 'substring' : key === 'size' ? 'kb' : 'days'
    // Typing here must not also reach the board's global key handler, or
    // searching for a file would be advancing panels behind this window.
    input.addEventListener('keydown', (e) => e.stopPropagation())
    input.addEventListener('input', () => {
      this.filters[key] = input.value.trim()
      this.applyFilters()
    })
    wrap.append(l, input)
    return wrap
  }

  private applyFilters(): void {
    const name = this.filters.name.toLowerCase()
    const minSize = Number.parseFloat(this.filters.size)
    const maxAge = Number.parseFloat(this.filters.age)
    let shown = 0
    let total = 0
    for (const p of this.platforms) {
      for (const f of p.files) {
        total += 1
        const okName = !name || f.name.toLowerCase().includes(name)
        const okSize = !Number.isFinite(minSize) || f.sizeKb >= minSize
        const okAge = !Number.isFinite(maxAge) || f.ageDays <= maxAge
        f.dim = !(okName && okSize && okAge)
        if (!f.dim) shown += 1
      }
    }
    this.readoutEl.textContent = this.selected
      ? `${this.selected.name}\n${fmtSize(this.selected.sizeKb)} · ${this.selected.ageDays}d old`
      : `${shown} / ${total} match`
  }

  // -- input -------------------------------------------------------------

  /** Mashing walks you forward. Exploring IS the task, so this is real help. */
  override onKeyBurst(): boolean {
    if (this.isDone) return false
    // Report honestly whether the key did anything. Returning true
    // unconditionally meant a camera pinned against the far wall swallowed
    // every keystroke on the board while visibly doing nothing -- the exact
    // "mashing feels broken" failure this project keeps having to fix.
    return this.move(MOVE_PER_STEP)
  }

  private bindInput(): void {
    /*
     * Arrows are bound on WINDOW and gated on being the targeted panel,
     * not on DOM focus.
     *
     * Focus was the obvious choice and it is the wrong one: the board
     * spawns windows, gates steal input, and clicking a search field or
     * anything else on the desktop moves focus away -- so "click the
     * panel, then fly" would work in a quiet moment and silently stop
     * working in a busy one. Measured exactly that: a scripted run flew
     * fine in isolation and produced a byte-identical frame in the middle
     * of a live level.
     *
     * Targeting is the game's own answer to "which panel is my input
     * for", every other panel already uses it, and it survives everything
     * that disturbs focus.
     */
    this.arrowHandler = (e) => {
      if (!this.targeted || this.isDone) return
      this.onArrow(e)
    }
    window.addEventListener('keydown', this.arrowHandler)
    this.win.onClose(() => {
      if (this.arrowHandler) window.removeEventListener('keydown', this.arrowHandler)
      this.arrowHandler = null
    })
    // Focus still works when you have it -- it just is not required.
    this.canvas.addEventListener('keydown', (e) => this.onArrow(e))

    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.focus()
      try {
        this.canvas.setPointerCapture(e.pointerId)
      } catch {
        /* pointer already gone -- an unguarded throw here aborts the handler */
      }
      this.dragging = { id: e.pointerId, x: e.clientX, yaw: this.cam.yaw }
    })
    const endDrag = (e: PointerEvent): void => {
      if (!this.dragging || this.dragging.id !== e.pointerId) return
      const moved = Math.abs(e.clientX - this.dragging.x)
      this.dragging = null
      // A drag is a look, a tap is a click. Without the threshold every
      // attempt to turn also selects whatever was under your finger.
      if (moved < 5) this.pick(e)
    }
    this.canvas.addEventListener('pointerup', endDrag)
    this.canvas.addEventListener('pointercancel', endDrag)
    this.canvas.addEventListener('lostpointercapture', endDrag)
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging || this.dragging.id !== e.pointerId) return
      this.cam.yaw = this.dragging.yaw + (e.clientX - this.dragging.x) * 0.005
    })
    this.canvas.tabIndex = 0
  }

  /** The shell tells every panel when it is the input target. */
  override setTargeted(targeted: boolean): void {
    super.setTargeted(targeted)
    this.targeted = targeted && !this.isDone
    // Take DOM focus too, so arrows arrive by either route.
    //
    // The window-level handler above is the one that survives a busy
    // board, and it is sufficient in principle -- but "in principle" is
    // how this panel already lost an hour: a key that reaches window in
    // one state and not another is indistinguishable from a dead control
    // to the person pressing it. Focusing the canvas gives the same
    // keystroke a second, entirely independent path in.
    if (this.targeted) {
      try {
        this.canvas?.focus({ preventScroll: true })
      } catch {
        /* not focusable yet -- the window handler still covers it */
      }
    }
  }

  private onArrow(e: KeyboardEvent): void {
    const step = e.shiftKey ? 2 : 1
    if (e.key === 'ArrowUp') this.move(MOVE_PER_STEP * step * 2)
    else if (e.key === 'ArrowDown') this.move(-MOVE_PER_STEP * step * 2)
    else if (e.key === 'ArrowLeft') this.cam.yaw -= TURN_PER_STEP * step
    else if (e.key === 'ArrowRight') this.cam.yaw += TURN_PER_STEP * step
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  /** Returns whether the camera actually moved. */
  private move(amount: number): boolean {
    const beforeX = this.cam.x
    const beforeZ = this.cam.z
    this.cam.x = clamp(this.cam.x + Math.sin(this.cam.yaw) * amount, this.bounds.minX, this.bounds.maxX)
    this.cam.z = clamp(this.cam.z + Math.cos(this.cam.yaw) * amount, this.bounds.minZ, this.bounds.maxZ)
    return this.cam.x !== beforeX || this.cam.z !== beforeZ
  }

  /** Back to the front of the tree, facing in. Always available. */
  private recenter(): void {
    this.cam.x = 0
    this.cam.z = this.bounds.minZ + 1
    this.cam.yaw = 0
  }

  private pick(e: PointerEvent): void {
    if (this.isDone) return
    const r = this.canvas.getBoundingClientRect()
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    // Nearest first: a block in front must win over one behind it.
    const hits: FileBlock[] = []
    for (const p of this.platforms) {
      for (const f of p.files) {
        const s = f.screen
        if (!s || f.dim) continue
        if (px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h) hits.push(f)
      }
    }
    hits.sort((a, b) => (a.screen?.depth ?? 0) - (b.screen?.depth ?? 0))
    const hit = hits[0]
    if (!hit) return

    this.selected = hit
    this.applyFilters()
    if (hit.isTarget) {
      this.floatText('FOUND')
      this.setTitleSuffix('LOCATED')
      // One step to 1.0: the whole panel is the single find.
      this.addProgress(1)
      return
    }
    // Wrong block costs nothing. It shows you its details, which is how you
    // learn what to filter on.
    this.pulse()
  }

  // -- render ------------------------------------------------------------

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = this.canvas.clientWidth || 480
    const h = this.canvas.clientHeight || 260
    if (this.canvas.width === Math.round(w * dpr) && this.canvas.height === Math.round(h * dpr)) return
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  /** World point -> screen. Returns null behind the camera. */
  private project(
    x: number,
    y: number,
    z: number,
    cw: number,
    ch: number,
  ): { x: number; y: number; d: number } | null {
    const dx = x - this.cam.x
    const dz = z - this.cam.z
    const s = Math.sin(-this.cam.yaw)
    const c = Math.cos(-this.cam.yaw)
    const rx = dx * c - dz * s
    const rz = dx * s + dz * c
    if (rz <= 0.25) return null
    return {
      x: cw / 2 + (FOCAL * rx) / rz,
      y: ch / 2 - (FOCAL * (y - EYE_Y)) / rz,
      d: rz,
    }
  }

  private draw(): void {
    this.resize()
    const g = this.ctx2d
    const cw = this.canvas.clientWidth || 480
    const ch = this.canvas.clientHeight || 260

    // Sky over floor. The horizon sits at the camera's eye line, which is
    // what makes the floor read as a floor rather than a backdrop.
    const horizon = ch / 2
    g.fillStyle = '#0a1420'
    g.fillRect(0, 0, cw, horizon)
    g.fillStyle = '#071008'
    g.fillRect(0, horizon, cw, ch - horizon)

    this.drawFloorGrid(g, cw, ch)

    // Painter's algorithm: platforms far to near, files with them.
    const order = [...this.platforms].sort(
      (a, b) => dist2(b, this.cam) - dist2(a, this.cam),
    )
    for (const p of order) this.drawPlatform(g, p, cw, ch)
  }

  private drawFloorGrid(g: CanvasRenderingContext2D, cw: number, ch: number): void {
    g.strokeStyle = 'rgba(70, 200, 120, 0.20)'
    g.lineWidth = 1
    // Drawn from the world's own extent, generously overshot, so the floor
    // always reaches past whatever the camera can see.
    const { minX, maxX, minZ, maxZ } = this.bounds
    for (let x = Math.floor(minX / 5) * 5; x <= maxX + 5; x += 5) {
      this.line(g, x, minZ - 6, x, maxZ + 14, cw, ch)
    }
    for (let z = Math.floor(minZ / 5) * 5; z <= maxZ + 14; z += 5) {
      this.line(g, minX - 5, z, maxX + 5, z, cw, ch)
    }
  }

  private line(
    g: CanvasRenderingContext2D,
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    cw: number,
    ch: number,
  ): void {
    const a = this.project(x1, 0, z1, cw, ch)
    const b = this.project(x2, 0, z2, cw, ch)
    if (!a || !b) return
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, b.y)
    g.stroke()
  }

  private drawPlatform(g: CanvasRenderingContext2D, p: Platform, cw: number, ch: number): void {
    const half = p.size / 2
    const corners = [
      this.project(p.x - half, 0.02, p.z - half, cw, ch),
      this.project(p.x + half, 0.02, p.z - half, cw, ch),
      this.project(p.x + half, 0.02, p.z + half, cw, ch),
      this.project(p.x - half, 0.02, p.z + half, cw, ch),
    ]
    if (corners.every(Boolean)) {
      g.beginPath()
      g.moveTo(corners[0]!.x, corners[0]!.y)
      for (let i = 1; i < 4; i++) g.lineTo(corners[i]!.x, corners[i]!.y)
      g.closePath()
      g.fillStyle = 'rgba(40, 90, 150, 0.5)'
      g.fill()
      g.strokeStyle = 'rgba(120, 200, 255, 0.55)'
      g.stroke()
    }

    // Files back to front within the platform too.
    const files = [...p.files].sort((a, b) => dist2(b, this.cam) - dist2(a, this.cam))
    for (const f of files) this.drawBlock(g, f, cw, ch)

    const label = this.project(p.x, 0, p.z + half + 0.6, cw, ch)
    if (label && label.d < 34) {
      g.fillStyle = `rgba(190, 235, 255, ${clamp(1.3 - label.d / 34, 0.15, 0.95)})`
      g.font = `${clamp(Math.round(300 / label.d), 8, 15)}px ui-monospace, monospace`
      g.textAlign = 'center'
      g.fillText(p.label, label.x, label.y)
    }
  }

  private drawBlock(g: CanvasRenderingContext2D, f: FileBlock, cw: number, ch: number): void {
    const hw = f.w / 2
    const hd = f.d / 2
    // Only the three faces that can ever be visible from a camera that is
    // always above the block and outside it: top, front, right.
    const p = (x: number, y: number, z: number) => this.project(x, y, z, cw, ch)
    const tfl = p(f.x - hw, f.h, f.z - hd)
    const tfr = p(f.x + hw, f.h, f.z - hd)
    const tbr = p(f.x + hw, f.h, f.z + hd)
    const tbl = p(f.x - hw, f.h, f.z + hd)
    const bfl = p(f.x - hw, 0.05, f.z - hd)
    const bfr = p(f.x + hw, 0.05, f.z - hd)
    if (!tfl || !tfr || !tbr || !tbl || !bfl || !bfr) {
      f.screen = null
      return
    }

    const alpha = f.dim ? 0.16 : 1
    const hot = f.isTarget && !f.dim
    // The objective file is NOT visually special. Marking it would delete
    // the entire task -- the point is that you find it by its name.
    const face = f.dim ? 'rgba(150,150,150,' : hot ? 'rgba(210,150,255,' : 'rgba(196,140,240,'

    poly(g, [tfl, tfr, tbr, tbl], `${face}${0.85 * alpha})`)
    poly(g, [bfl, bfr, tfr, tfl], `${face}${0.55 * alpha})`)
    poly(g, [tfr, tbr, tbr, bfr], `${face}${0.4 * alpha})`)

    g.strokeStyle = `rgba(240, 220, 255, ${0.5 * alpha})`
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(tfl.x, tfl.y)
    g.lineTo(tfr.x, tfr.y)
    g.lineTo(tbr.x, tbr.y)
    g.lineTo(tbl.x, tbl.y)
    g.closePath()
    g.stroke()

    const xs = [tfl.x, tfr.x, tbr.x, tbl.x, bfl.x, bfr.x]
    const ys = [tfl.y, tfr.y, tbr.y, tbl.y, bfl.y, bfr.y]
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    f.screen = {
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY,
      depth: tfl.d,
    }

    // Names only render close up -- the whole reason to fly anywhere.
    if (tfl.d < 17 && !f.dim) {
      const fs = clamp(Math.round(190 / tfl.d), 7, 13)
      g.font = `${fs}px ui-monospace, monospace`
      g.textAlign = 'center'
      g.fillStyle = `rgba(255,255,255,${clamp(1.4 - tfl.d / 17, 0.2, 1)})`
      g.fillText(f.name, (tfl.x + tfr.x) / 2, Math.min(bfl.y, bfr.y) + fs + 2)
    }
  }
}

// -- helpers ---------------------------------------------------------------

function poly(
  g: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  fill: string,
): void {
  g.beginPath()
  g.moveTo(pts[0]!.x, pts[0]!.y)
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y)
  g.closePath()
  g.fillStyle = fill
  g.fill()
}

function dist2(a: { x: number; z: number }, cam: { x: number; z: number }): number {
  const dx = a.x - cam.x
  const dz = a.z - cam.z
  return dx * dx + dz * dz
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function fmtSize(kb: number): string {
  if (kb >= 1_000_000) return `${(kb / 1_000_000).toFixed(1)} GB`
  if (kb >= 1000) return `${(kb / 1000).toFixed(1)} MB`
  return `${kb} kB`
}
