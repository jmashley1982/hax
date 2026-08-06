import { int, pick, hex, type Rng } from '@/core/rng'
import type { WindowManager } from './windows/manager'
import type { Win } from './windows/window'

/**
 * THE MANHUNT -- the deep-layer boss fight.
 *
 * A reverse hack (ui/reverseHack.ts) is them working your box. This is
 * what happens when they win that fight at depth: they stop trying to
 * push you off the network and start trying to find out who and where you
 * are. The role reverses completely -- the objective is no longer the
 * contract, it is staying anonymous.
 *
 * It runs as four things at once, which is what makes it a boss rather
 * than another window to click:
 *
 *   1. DOXX     a panel filling in with your real details, one line at a
 *               time, from redacted to complete.
 *   2. TRACE    a map with a blinking red dot converging on you.
 *   3. DISPATCH a law-enforcement ETA counting down.
 *   4. STRIPPING their operator killing your utilities one by one.
 *
 * You fight it by scrubbing: each scrub action pushes the doxx back,
 * widens the trace circle and adds time to the ETA. A hacker friend
 * offering interference (ui/messenger.ts) is the other way out, and the
 * reason to have been reading the messenger all game.
 *
 * The map is drawn to a canvas rather than embedded from a tile service:
 * the whole app is offline-static with zero external requests, so a real
 * map image is not available at any price. A generated street grid with a
 * converging search radius reads correctly at 240px and costs nothing.
 */

export interface ManhuntOptions {
  manager: WindowManager
  mount: HTMLElement
  rng: Rng
  org: string
  /** The player's chosen handle -- naming it is the point of the doxx. */
  handle: string
  /** Seconds on the dispatch clock. */
  etaSeconds: number
  line: (text: string, tone: 'warning' | 'danger' | 'success') => void
  /** Survived it -- they lost the thread. */
  onEscaped: () => void
  /** The clock ran out. */
  onCaught: () => void
}

/** Progressively less redacted. Index = how many scrubs behind you are. */
const DOXX_FIELDS: ReadonlyArray<{ label: string; redacted: string; real: (h: string, rng: Rng) => string }> = [
  { label: 'HANDLE', redacted: '[ ---------- ]', real: (h) => h },
  { label: 'EXIT NODE', redacted: '[ ---------- ]', real: (_h, r) => `${int(r, 2, 254)}.${int(r, 2, 254)}.${int(r, 2, 254)}.${int(r, 2, 254)}` },
  { label: 'ISP', redacted: '[ ---------- ]', real: (_h, r) => pick(r, ['NORTHWIND BROADBAND', 'CIVIC FIBRE', 'ARCLIGHT TELECOM', 'MERIDIAN CABLE']) },
  { label: 'CITY', redacted: '[ ---------- ]', real: (_h, r) => pick(r, ['LEEDS', 'ROTTERDAM', 'TALLINN', 'PORTLAND', 'VALENCIA', 'HAMILTON']) },
  { label: 'BILLING NAME', redacted: '[ ---------- ]', real: (_h, r) => pick(r, ['R. OKONKWO', 'S. HALVORSEN', 'D. PARK', 'A. MERCADO', 'J. FAIRWEATHER']) },
  { label: 'STREET', redacted: '[ ---------- ]', real: (_h, r) => `${int(r, 4, 190)} ${pick(r, ['CANAL', 'BEECHWOOD', 'FOUNDRY', 'LARKSPUR', 'HARBOUR'])} ${pick(r, ['ST', 'RD', 'LANE'])}` },
]

const STRIP_TARGETS = [
  'tor-relay',
  'vpn-tunnel',
  'mac-spoofer',
  'log-scrubber',
  'kill-switch',
  'traffic-shaper',
]

export class Manhunt {
  private win: Win | null = null
  private mapWin: Win | null = null
  private revealed = 0
  private scrubs = 0
  private remainingMs: number
  private finished = false
  private elapsed = 0
  private nextStripAt = 6000
  private strippedCount = 0

  private doxxRows: HTMLElement[] = []
  private etaEl: HTMLElement | null = null
  private stripEl: HTMLElement | null = null
  private canvas: HTMLCanvasElement | null = null
  /** 1 = they have no idea; 0 = they are at the door. */
  private searchRadius = 1
  private blink = 0

  constructor(private opts: ManhuntOptions) {
    this.remainingMs = opts.etaSeconds * 1000
    opts.mount.classList.add('is-manhunt')
    this.openDoxx()
    this.openMap()
    opts.line(
      `!!!! ${opts.org} HAS STOPPED DEFENDING AND STARTED HUNTING. THEY ARE LOOKING FOR YOU.`,
      'danger',
    )
  }

  get active(): boolean {
    return !this.finished
  }

  // -- the doxx panel -----------------------------------------------------

  private openDoxx(): void {
    const win = this.opts.manager.spawn(
      { title: `⚠ ${this.opts.org.toUpperCase()} :: SUBJECT IDENTIFICATION`, modal: false, closable: false, decor: 'danger', pinned: true },
      'random',
    )
    win.el.classList.add('hostile', 'manhunt-win')
    this.win = win

    const body = document.createElement('div')
    body.className = 'manhunt'

    const rows = document.createElement('div')
    rows.className = 'manhunt__rows'
    for (const f of DOXX_FIELDS) {
      const row = document.createElement('div')
      row.className = 'manhunt__row'
      const l = document.createElement('span')
      l.className = 'manhunt__label'
      l.textContent = f.label
      const v = document.createElement('span')
      v.className = 'manhunt__value'
      v.textContent = f.redacted
      row.append(l, v)
      rows.appendChild(row)
      this.doxxRows.push(v)
    }

    this.stripEl = document.createElement('div')
    this.stripEl.className = 'manhunt__strip'

    this.etaEl = document.createElement('div')
    this.etaEl.className = 'manhunt__eta'

    const scrub = document.createElement('button')
    scrub.className = 'manhunt__scrub'
    scrub.textContent = 'SCRUB / REROUTE'
    scrub.addEventListener('click', () => this.scrub())

    const hint = document.createElement('div')
    hint.className = 'manhunt__hint'
    hint.textContent = 'scrub to push them back -- or get a friend on the relay to misdirect them'

    body.append(rows, this.stripEl, this.etaEl, scrub, hint)
    win.setBody(body)
    this.paint()
  }

  // -- the trace map ------------------------------------------------------

  private openMap(): void {
    const win = this.opts.manager.spawn(
      { title: '⚠ TRACE :: SUBJECT LOCATION', modal: false, closable: false, decor: 'danger', pinned: true },
      'random',
    )
    win.el.classList.add('hostile', 'manhunt-map')
    this.mapWin = win

    const body = document.createElement('div')
    body.className = 'manhunt__mapbody'
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 170
    canvas.className = 'manhunt__canvas'
    this.canvas = canvas
    body.appendChild(canvas)

    const cap = document.createElement('div')
    cap.className = 'manhunt__mapcap'
    cap.textContent = `GEOLOCATING -- ${hex(this.opts.rng, 6).toUpperCase()}`
    body.appendChild(cap)

    win.setBody(body)
    this.drawMap()
  }

  /**
   * A generated street grid with a search circle closing on a fixed point.
   *
   * Drawn once for the streets and redrawn per tick for the circle and the
   * blinking marker -- redrawing the whole grid every frame would jitter
   * the streets around, which reads as noise rather than as a map.
   */
  private drawMap(): void {
    const c = this.canvas
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const { width: W, height: H } = c
    const rng = this.opts.rng

    ctx.fillStyle = '#0a0c10'
    ctx.fillRect(0, 0, W, H)

    // Streets. Seeded off the same rng stream, so they are stable for a
    // given session but different between them.
    if (!this.streets) {
      this.streets = []
      for (let i = 0; i < 7; i++) this.streets.push({ v: true, p: int(rng, 8, W - 8), w: rng() < 0.25 ? 2 : 1 })
      for (let i = 0; i < 5; i++) this.streets.push({ v: false, p: int(rng, 8, H - 8), w: rng() < 0.25 ? 2 : 1 })
    }
    ctx.strokeStyle = 'rgba(120,150,170,0.5)'
    for (const s of this.streets) {
      ctx.lineWidth = s.w
      ctx.beginPath()
      if (s.v) { ctx.moveTo(s.p, 0); ctx.lineTo(s.p, H) } else { ctx.moveTo(0, s.p); ctx.lineTo(W, s.p) }
      ctx.stroke()
    }

    const cx = W * 0.56
    const cy = H * 0.48

    // The search radius: wide and vague at first, tight and specific at the end.
    const r = 12 + this.searchRadius * 74
    ctx.strokeStyle = 'rgba(255,64,64,0.75)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,64,64,0.10)'
    ctx.fill()

    // The dot. Blinks; solid and bright once the circle is tight.
    const on = this.blink % 2 === 0
    if (on) {
      ctx.fillStyle = '#ff3b3b'
      ctx.beginPath()
      ctx.arc(cx, cy, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,59,59,0.6)'
      ctx.beginPath()
      ctx.arc(cx, cy, 9, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.fillStyle = 'rgba(220,235,245,0.85)'
    ctx.font = '9px ui-monospace, Menlo, monospace'
    ctx.fillText(`CONFIDENCE ${Math.round((1 - this.searchRadius) * 100)}%`, 6, H - 7)
  }

  private streets: Array<{ v: boolean; p: number; w: number }> | null = null

  // -- the clock ----------------------------------------------------------

  tick(dtMs: number): void {
    if (this.finished) return
    this.elapsed += dtMs
    this.remainingMs -= dtMs

    // The doxx fills in on its own schedule, minus whatever you have
    // scrubbed back. Standing still loses.
    const shouldReveal = Math.max(0, Math.floor(this.elapsed / 4200) - this.scrubs)
    if (shouldReveal !== this.revealed) {
      this.revealed = Math.min(DOXX_FIELDS.length, Math.max(0, shouldReveal))
      this.paint()
    }

    this.searchRadius = Math.max(0.06, 1 - this.revealed / DOXX_FIELDS.length)

    if (this.elapsed >= this.nextStripAt) {
      this.nextStripAt = this.elapsed + int(this.opts.rng, 7000, 12_000)
      this.stripUtility()
    }

    this.blink = Math.floor(this.elapsed / 420)
    this.drawMap()
    this.paintEta()

    if (this.revealed >= DOXX_FIELDS.length || this.remainingMs <= 0) this.finish(false)
  }

  /** They pull one of your tools offline. Cosmetic, but it is the "stripping your workstation" beat. */
  private stripUtility(): void {
    if (this.strippedCount >= STRIP_TARGETS.length || !this.stripEl) return
    const name = STRIP_TARGETS[this.strippedCount]
    this.strippedCount += 1
    const row = document.createElement('div')
    row.className = 'manhunt__stripped'
    row.textContent = `-- ${name} REMOVED`
    this.stripEl.appendChild(row)
    while (this.stripEl.childElementCount > 3) this.stripEl.firstElementChild?.remove()
    this.opts.line(`they pulled ${name} off your machine`, 'warning')
  }

  private paint(): void {
    DOXX_FIELDS.forEach((f, i) => {
      const el = this.doxxRows[i]
      if (!el) return
      const shown = i < this.revealed
      el.textContent = shown ? f.real(this.opts.handle, this.opts.rng) : f.redacted
      el.classList.toggle('is-revealed', shown)
    })
  }

  private paintEta(): void {
    if (!this.etaEl) return
    const s = Math.max(0, Math.ceil(this.remainingMs / 1000))
    this.etaEl.textContent = `LOCAL UNITS DISPATCHED -- ETA ${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`
    this.etaEl.classList.toggle('is-close', s <= 20)
  }

  // -- fighting back ------------------------------------------------------

  /** Manual scrub: buys back one revealed field and a little time. */
  scrub(): void {
    if (this.finished) return
    this.scrubs += 1
    this.remainingMs += 4000
    this.revealed = Math.max(0, this.revealed - 1)
    this.searchRadius = Math.max(0.06, 1 - this.revealed / DOXX_FIELDS.length)
    this.paint()
    this.opts.line('rerouted -- they lost a hop', 'success')
    if (this.revealed === 0 && this.scrubs >= 4) this.finish(true)
  }

  /**
   * A friend on the relay misdirects the responders. This is the big one:
   * it wipes the doxx and adds real time, and it is the payoff for having
   * kept an eye on the messenger.
   */
  applyInterference(from: string): void {
    if (this.finished) return
    this.scrubs += 3
    this.revealed = 0
    this.remainingMs += 25_000
    this.searchRadius = 1
    this.paint()
    this.opts.line(`${from} fed them a bad address -- units are rolling to the wrong side of town`, 'success')
    this.finish(true)
  }

  private finish(escaped: boolean): void {
    if (this.finished) return
    this.finished = true
    this.opts.mount.classList.remove('is-manhunt')
    this.win?.close()
    this.mapWin?.close()
    this.win = null
    this.mapWin = null
    if (escaped) this.opts.onEscaped()
    else this.opts.onCaught()
  }

  destroy(): void {
    this.finished = true
    this.opts.mount.classList.remove('is-manhunt')
    this.win?.close()
    this.mapWin?.close()
    this.win = null
    this.mapWin = null
  }
}
