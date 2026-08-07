import { playSfx } from '@/audio/sounds'
import { hex, int, pick, shuffle, type Rng } from '@/core/rng'
import type { LineTone } from '@/core/events'

/**
 * A GATE -- the one thing in this game that stops the world.
 *
 * "certain attempts to kick you out pauses the whole thing until you enter
 * the password, drag the files, etc. the user must handle THIS problem
 * before continuing."
 *
 * Everything else the target does to you -- waves, reverse hacks, the
 * manhunt, the field op -- runs ALONGSIDE a fully playable board, which is
 * why none of it ever felt consequential: you could ignore all of it and
 * keep mashing. A gate cannot be ignored. The simulation freezes behind
 * it, every keystroke belongs to it, and the run does not continue until
 * you deal with it.
 *
 * The freeze is not new machinery: `onTick` and `handleKey` already
 * early-out on `if (this.lockout) return`, which is exactly the semantics
 * needed. A gate is a second flag at those same two points plus a scrim.
 *
 * Failing one COSTS you and the run continues (the agreed rule): a big
 * integrity hit, a heat spike, and the level's objective gets harder. It
 * is never an ending -- losing a ten-minute run to one missed prompt would
 * make gates the thing players dread rather than the thing that wakes them
 * up.
 */

export type GateKind = 'password' | 'purge'

export interface GateOptions {
  kind: GateKind
  org: string
  rng: Rng
  mount: HTMLElement
  /** How long you get. Generous on purpose -- the drama is the freeze, not the clock. */
  limitMs: number
  /**
   * A code an ally handed you earlier, if any. Present or not, the gate
   * always shows the code it wants: a blocking prompt you cannot answer is
   * a wall, not a challenge.
   */
  knownCode?: string | null
  line: (text: string, tone: LineTone) => void
  onResolve: (ok: boolean) => void
}

const CORRUPT_TELLS = ['CHECKSUM MISMATCH', 'SIG: INVALID', 'DOUBLE EXT', 'SIZE ANOMALY']
const CLEAN_NAMES = ['ledger', 'roster', 'manifest', 'backup', 'export', 'notes', 'index', 'audit']
const EXTS = ['db', 'sql', 'csv', 'pem', 'tar', 'pdf']

export class Gate {
  private el: HTMLElement
  private remainingMs: number
  private done = false
  private keyHandler: (e: KeyboardEvent) => void
  private clockEl!: HTMLElement
  private barEl!: HTMLElement

  /** password */
  private code = ''
  private typed = ''
  private slotsEl: HTMLElement | null = null

  /** purge */
  private badLeft = 0

  constructor(private opts: GateOptions) {
    this.remainingMs = opts.limitMs

    this.el = document.createElement('div')
    this.el.className = `gate gate--${opts.kind}`

    const frame = document.createElement('div')
    frame.className = 'gate__frame'

    const head = document.createElement('div')
    head.className = 'gate__head'
    head.textContent =
      opts.kind === 'password'
        ? `!! ${opts.org.toUpperCase()} LOCKED THIS SESSION`
        : `!! ${opts.org.toUpperCase()} IS PUSHING FILES AT YOU`

    const sub = document.createElement('div')
    sub.className = 'gate__sub'
    sub.textContent =
      opts.kind === 'password'
        ? 'everything is held until you re-key the session'
        : 'their payload is uploading itself -- bin the bad ones'

    const body = document.createElement('div')
    body.className = 'gate__body'

    this.clockEl = document.createElement('div')
    this.clockEl.className = 'gate__clock'

    const track = document.createElement('div')
    track.className = 'gate__track'
    this.barEl = document.createElement('div')
    this.barEl.className = 'gate__bar'
    track.appendChild(this.barEl)

    frame.append(head, sub, body, this.clockEl, track)
    this.el.appendChild(frame)
    opts.mount.appendChild(this.el)

    if (opts.kind === 'password') this.buildPassword(body)
    else this.buildPurge(body)

    // Capture phase, like the lockout: the board's own listeners must not
    // also see these keys, or a gate meant to stop everything would still
    // be advancing panels behind itself.
    this.keyHandler = (e) => this.onKey(e)
    window.addEventListener('keydown', this.keyHandler, true)

    playSfx('alarm')
    this.paint()
    opts.line(
      opts.kind === 'password'
        ? `!!!! SESSION LOCKED -- re-key with ${this.code} to continue`
        : '!!!! INBOUND PAYLOAD -- purge the corrupted files to continue',
      'danger',
    )
  }

  // -- password ----------------------------------------------------------

  private buildPassword(body: HTMLElement): void {
    // If an ally gave you a code earlier, that IS the code -- which is what
    // makes reading the messenger worth something rather than decorative.
    this.code = (this.opts.knownCode ?? hex(this.opts.rng, 3)).toUpperCase()

    const label = document.createElement('div')
    label.className = 'gate__label'
    label.textContent = this.opts.knownCode
      ? 'YOUR CONTACT ALREADY GAVE YOU THIS. TYPE IT.'
      : 'TYPE THIS EXACTLY'

    const codeEl = document.createElement('div')
    codeEl.className = 'gate__code'
    codeEl.textContent = this.code

    this.slotsEl = document.createElement('div')
    this.slotsEl.className = 'gate__slots'
    for (let i = 0; i < this.code.length; i++) {
      const s = document.createElement('span')
      s.className = 'gate__slot'
      this.slotsEl.appendChild(s)
    }

    body.append(label, codeEl, this.slotsEl)
  }

  private onKey(e: KeyboardEvent): void {
    if (this.done) return
    // Swallow everything: the whole point is that nothing else gets input.
    e.preventDefault()
    e.stopPropagation()
    if (this.opts.kind !== 'password') return

    const want = this.code[this.typed.length]
    if (!want) return
    if (e.key.toUpperCase() !== want) {
      // Wrong keys cost nothing but a shake. Four hex glyphs against a
      // clock is enough pressure without punishing a fumble.
      playSfx('error')
      this.slotsEl?.classList.remove('is-wrong')
      void this.slotsEl?.offsetWidth
      this.slotsEl?.classList.add('is-wrong')
      return
    }
    this.typed += want
    const slot = this.slotsEl?.children[this.typed.length - 1] as HTMLElement | undefined
    if (slot) {
      slot.textContent = want
      slot.classList.add('is-set')
    }
    if (this.typed.length >= this.code.length) this.finish(true)
  }

  // -- purge -------------------------------------------------------------

  private buildPurge(body: HTMLElement): void {
    const { rng } = this.opts
    const total = int(rng, 5, 6)
    const bad = int(rng, 2, 3)
    this.badLeft = bad

    const label = document.createElement('div')
    label.className = 'gate__label'
    label.textContent = `BIN THE ${bad} CORRUPTED FILES -- LEAVE THE REST`

    const list = document.createElement('div')
    list.className = 'gate__files'

    const flags = shuffle(rng, [
      ...Array.from({ length: bad }, () => true),
      ...Array.from({ length: total - bad }, () => false),
    ])

    for (const corrupted of flags) {
      const base = pick(rng, CLEAN_NAMES)
      const ext = pick(rng, EXTS)
      const tell = corrupted ? pick(rng, CORRUPT_TELLS) : ''
      const name = corrupted && tell === 'DOUBLE EXT' ? `${base}.${ext}.exe` : `${base}_${hex(rng, 2)}.${ext}`

      const row = document.createElement('div')
      row.className = 'gate__file'

      const nameEl = document.createElement('span')
      nameEl.className = 'gate__file-name'
      nameEl.textContent = name

      // The tell is ALWAYS visible. A timed prompt whose answer needs a
      // separate scan action would be a guess, and a blocking guess is the
      // worst thing this system could be.
      const tellEl = document.createElement('span')
      tellEl.className = corrupted ? 'gate__file-tell is-bad' : 'gate__file-tell'
      tellEl.textContent = corrupted ? tell : 'SIG: OK'

      const btn = document.createElement('button')
      btn.className = 'gate__bin'
      btn.textContent = 'BIN'
      btn.addEventListener('click', () => this.bin(row, corrupted))

      row.append(nameEl, tellEl, btn)
      list.appendChild(row)
    }

    body.append(label, list)
  }

  private bin(row: HTMLElement, corrupted: boolean): void {
    if (this.done || row.classList.contains('is-gone')) return
    row.classList.add('is-gone')
    if (corrupted) {
      playSfx('panelClear')
      this.badLeft -= 1
      if (this.badLeft <= 0) this.finish(true)
      return
    }
    // Binning a clean file costs time, not the gate. Same philosophy as
    // every other panel here: a mistake should sting, never dead-end.
    playSfx('error')
    this.remainingMs = Math.max(600, this.remainingMs - 2500)
    this.opts.line('-- that one was clean. seconds gone.', 'warning')
  }

  // -- clock -------------------------------------------------------------

  /**
   * Driven from the Shell's tick, called BEFORE the freeze early-out --
   * the gate is the one thing that must keep moving while everything else
   * is stopped.
   */
  tick(dtMs: number): void {
    if (this.done) return
    this.remainingMs -= dtMs
    this.paint()
    if (this.remainingMs <= 0) this.finish(false)
  }

  private paint(): void {
    const s = Math.max(0, this.remainingMs / 1000)
    this.clockEl.textContent = `${s.toFixed(1)}s`
    this.clockEl.classList.toggle('is-close', s <= 4)
    this.barEl.style.width = `${Math.max(0, Math.min(100, (this.remainingMs / this.opts.limitMs) * 100))}%`
  }

  private finish(ok: boolean): void {
    if (this.done) return
    this.done = true
    this.el.classList.add(ok ? 'is-cleared' : 'is-failed')
    playSfx(ok ? 'token' : 'powerDown')
    this.teardown(ok ? 420 : 900)
    this.opts.onResolve(ok)
  }

  private teardown(delayMs: number): void {
    window.removeEventListener('keydown', this.keyHandler, true)
    setTimeout(() => this.el.remove(), delayMs)
  }

  /** The board was swept out from under it (lockout, ejection, finale). */
  destroy(): void {
    if (this.done) return
    this.done = true
    this.teardown(0)
  }
}
