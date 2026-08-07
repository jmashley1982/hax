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

export type { GateKind } from '@/sim/levels'
import type { GateKind } from '@/sim/levels'

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
const GLYPHS = '0123456789ABCDEF'.split('')
/** Route tells, consistent so they can be learned rather than guessed. */
const SAFE_TELLS = [
  'cert expired 2 years ago',
  'unpatched CVE-2019-0708',
  'default creds still set',
  'abandoned subdomain, no logging',
  'verbose stack traces on error',
  'legacy protocol, no MFA',
]
const TRAP_TELLS = [
  'patched this week',
  'EDR agent reporting',
  'canary token in the path',
  'MFA enforced, hardware key',
  'suspiciously wide open',
  'honeypot banner mismatch',
]
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

  /** rekey: the glyph sequence, and which slot is lit right now. */
  private rekeyGlyphs: string[] = []
  private rekeyOrder: number[] = []
  private rekeyAt = 0

  /** trace: hops left to cut, in order. */
  private traceHops: HTMLElement[] = []
  private traceAt = 0

  constructor(private opts: GateOptions) {
    this.remainingMs = opts.limitMs

    this.el = document.createElement('div')
    this.el.className = `gate gate--${opts.kind}`

    const frame = document.createElement('div')
    frame.className = 'gate__frame'

    const head = document.createElement('div')
    head.className = 'gate__head'
    const org = opts.org.toUpperCase()
    head.textContent = {
      password: `!! ${org} LOCKED THIS SESSION`,
      purge: `!! ${org} IS PUSHING FILES AT YOU`,
      rekey: `!! ${org} ROLLED THE SESSION KEY`,
      trace: `!! ${org} IS TRACING YOU RIGHT NOW`,
      route: `!! YOUR ROUTE JUST DIED`,
    }[opts.kind]

    const sub = document.createElement('div')
    sub.className = 'gate__sub'
    sub.textContent = {
      password: 'everything is held until you re-key the session',
      purge: 'their payload is uploading itself -- bin the bad ones',
      rekey: 'type each glyph as it lights -- not in order',
      trace: 'cut the hops in sequence before it reaches you',
      route: 'pick another way in. read the intel.',
    }[opts.kind]

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
    else if (opts.kind === 'purge') this.buildPurge(body)
    else if (opts.kind === 'rekey') this.buildRekey(body)
    else if (opts.kind === 'trace') this.buildTrace(body)
    else this.buildRoute(body)

    // Capture phase, like the lockout: the board's own listeners must not
    // also see these keys, or a gate meant to stop everything would still
    // be advancing panels behind itself.
    this.keyHandler = (e) => this.onKey(e)
    window.addEventListener('keydown', this.keyHandler, true)

    playSfx('alarm')
    this.paint()
    opts.line(
      {
        password: `!!!! SESSION LOCKED -- re-key with ${this.code} to continue`,
        purge: '!!!! INBOUND PAYLOAD -- purge the corrupted files to continue',
        rekey: '!!!! KEY ROLLED -- re-enter the glyphs as they light',
        trace: '!!!! LIVE TRACE -- cut the hops before it lands',
        route: '!!!! ROUTE DEAD -- pick another way in',
      }[opts.kind],
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
    if (this.opts.kind === 'rekey') return this.onRekeyKey(e)
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

  // -- rekey -------------------------------------------------------------

  /**
   * The lockout's re-key pad, promoted to a gate.
   *
   * Different from PASSWORD in the one way that matters: the slots light
   * in a RANDOM order rather than left to right, so you cannot type the
   * code as a word. You have to watch. Same four hex glyphs, same "a wrong
   * key only shakes" rule -- it is attention, not difficulty.
   */
  private buildRekey(body: HTMLElement): void {
    const { rng } = this.opts
    this.rekeyGlyphs = Array.from({ length: 4 }, () => pick(rng, GLYPHS))
    this.rekeyOrder = shuffle(rng, [0, 1, 2, 3])

    const label = document.createElement('div')
    label.className = 'gate__label'
    label.textContent = 'TYPE THE LIT GLYPH'

    this.slotsEl = document.createElement('div')
    this.slotsEl.className = 'gate__slots'
    for (const g of this.rekeyGlyphs) {
      const s = document.createElement('span')
      s.className = 'gate__slot'
      s.textContent = g
      this.slotsEl.appendChild(s)
    }
    body.append(label, this.slotsEl)
    this.litRekeySlot()
  }

  private litRekeySlot(): void {
    if (!this.slotsEl) return
    const idx = this.rekeyOrder[this.rekeyAt]
    for (let i = 0; i < this.slotsEl.children.length; i++) {
      this.slotsEl.children[i]?.classList.toggle('is-lit', i === idx)
    }
  }

  private onRekeyKey(e: KeyboardEvent): void {
    const idx = this.rekeyOrder[this.rekeyAt]
    if (idx === undefined) return
    const want = this.rekeyGlyphs[idx]
    if (!want) return
    if (e.key.toUpperCase() !== want) {
      playSfx('error')
      this.slotsEl?.classList.remove('is-wrong')
      void this.slotsEl?.offsetWidth
      this.slotsEl?.classList.add('is-wrong')
      return
    }
    const slot = this.slotsEl?.children[idx] as HTMLElement | undefined
    slot?.classList.add('is-set')
    slot?.classList.remove('is-lit')
    this.rekeyAt += 1
    if (this.rekeyAt >= this.rekeyOrder.length) this.finish(true)
    else this.litRekeySlot()
  }

  // -- trace -------------------------------------------------------------

  /**
   * Their trace, drawn as the hop chain it is. Cut them in order.
   *
   * Reuses NODE PATH's whole idea -- only the next hop counts, a wrong
   * click just shudders -- because the player has already learned it, and
   * a blocking prompt is the worst possible place to teach a new verb.
   */
  private buildTrace(body: HTMLElement): void {
    const { rng } = this.opts
    const label = document.createElement('div')
    label.className = 'gate__label'
    label.textContent = 'CUT THE HOPS IN ORDER -- NEAREST FIRST'

    const chain = document.createElement('div')
    chain.className = 'gate__chain'
    const hops = int(rng, 4, 5)
    for (let i = 0; i < hops; i++) {
      const node = document.createElement('button')
      node.className = 'gate__hop'
      node.textContent = `${int(rng, 10, 250)}.${int(rng, 0, 255)}`
      node.addEventListener('click', () => this.cutHop(i))
      this.traceHops.push(node)
      chain.appendChild(node)
    }
    body.append(label, chain)
    this.markNextHop()
  }

  private markNextHop(): void {
    this.traceHops.forEach((n, i) => n.classList.toggle('is-next', i === this.traceAt))
  }

  private cutHop(idx: number): void {
    if (this.done) return
    const node = this.traceHops[idx]
    if (!node) return
    if (idx !== this.traceAt) {
      playSfx('error')
      node.classList.add('is-reject')
      setTimeout(() => node.classList.remove('is-reject'), 240)
      return
    }
    node.classList.add('is-cut')
    node.classList.remove('is-next')
    this.traceAt += 1
    playSfx('panelClear')
    if (this.traceAt >= this.traceHops.length) this.finish(true)
    else this.markNextHop()
  }

  // -- route -------------------------------------------------------------

  /**
   * The route choice §16F described and never built, finally, and blocking.
   *
   * The tells are FIXED lists, not adjectives sprinkled at random: a stale
   * cert is always safe, a canary token is always a trap. That is what
   * makes this learnable across runs instead of a coin flip -- and a coin
   * flip that freezes the board would be the meanest thing in the game.
   */
  private buildRoute(body: HTMLElement): void {
    const { rng } = this.opts
    const label = document.createElement('div')
    label.className = 'gate__label'
    label.textContent = 'PICK THE WAY IN'

    const list = document.createElement('div')
    list.className = 'gate__routes'
    const safeIdx = int(rng, 0, 2)
    const safe = shuffle(rng, SAFE_TELLS)
    const trap = shuffle(rng, TRAP_TELLS)
    for (let i = 0; i < 3; i++) {
      const good = i === safeIdx
      const btn = document.createElement('button')
      btn.className = 'gate__route'
      const name = document.createElement('span')
      name.className = 'gate__route-name'
      name.textContent = `${pick(rng, ['vpn', 'jump', 'edge', 'mgmt', 'legacy'])}-${int(rng, 1, 19)}.${this.opts.org.toLowerCase().replace(/[^a-z]/g, '').slice(0, 9)}`
      const tell = document.createElement('span')
      tell.className = 'gate__route-tell'
      tell.textContent = good ? (safe[i] ?? SAFE_TELLS[0]!) : (trap[i] ?? TRAP_TELLS[0]!)
      btn.append(name, tell)
      btn.addEventListener('click', () => this.takeRoute(good, btn))
      list.appendChild(btn)
    }
    body.append(label, list)
  }

  private takeRoute(good: boolean, btn: HTMLElement): void {
    if (this.done) return
    if (good) {
      btn.classList.add('is-good')
      this.finish(true)
      return
    }
    // A wrong route ends the gate immediately rather than letting you try
    // again -- picking is the whole action, so a retry would make it free.
    btn.classList.add('is-bad')
    this.finish(false)
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
