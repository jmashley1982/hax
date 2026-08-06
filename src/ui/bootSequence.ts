import { int, pick, type Rng } from '@/core/rng'
import { sectorLabel, type Contract } from '@/sim/contracts'

/**
 * The connection sequence between JACK IN and the board.
 *
 * The session used to appear fully formed the instant you picked a
 * contract, which skipped the one moment the fiction most wants: actually
 * reaching the target. This is that beat, in three acts:
 *
 *   RECON   who they are -- mark, sector, tier, open ports, stack
 *   RELAY   the hop chain draws itself, then you pick an exit node
 *   BREACH  one [ ENGAGE ] under a soft auto-advance
 *
 * The relay choice is the "mild easy interaction" that was asked for, and
 * it is a real trade rather than three identical buttons: a fast exit puts
 * you inside immediately but hot, a cold one starts you at zero heat and
 * makes you sit through the extra handshake. The cost is paid in seconds
 * you can feel, not in a number on a card.
 *
 * NON-NEGOTIABLE (plan §13a): this must never be able to stall. Any key or
 * click still skips the whole thing, the relay auto-picks if untouched, and
 * a hard cap fires regardless of input. The one subtlety is that the skip
 * listeners must not eat the sequence's own controls -- see `onPointerDown`.
 */

/**
 * The absolute ceiling, raised from 9s when the sequence grew a choice in
 * it. Worst case with no input at all is ~8.3s (recon 1.2 + relay draw 0.7
 * + auto-pick wait 3.5 + cold handshake 1.4 + engage 1.6), so a 9s cap
 * would have fired *during* the last act and read as a crash.
 */
const HARD_CAP_MS = 13_000

const RECON_LINE_MS = 190
const HOP_MS = 130
/** How long the relay choice waits before picking for you. */
const RELAY_AUTO_MS = 3500
const HANDSHAKE_LINE_MS = 175
const ENGAGE_AUTO_MS = 1600

export interface RelayChoice {
  id: string
  city: string
  latencyMs: number
  /** Heat the session starts on. The fast exit is the loud one. */
  startHeat: number
  /** Extra handshake lines streamed after choosing -- the latency, felt. */
  handshakeLines: number
  note: string
}

export interface BootResult {
  relayId: string
  startHeat: number
}

const CITIES = [
  'reykjavik',
  'sofia',
  'lagos',
  'quito',
  'perth',
  'tallinn',
  'valparaiso',
  'kaunas',
  'da nang',
]

type Act = 'recon' | 'relay' | 'breach'

export interface BootOptions {
  contract: Contract
  rng: Rng
  handle: string
  onDone: (result: BootResult) => void
}

export class BootSequence {
  private el: HTMLElement
  private timers: Array<ReturnType<typeof setTimeout>> = []
  private interval: ReturnType<typeof setInterval> | null = null
  private done = false
  private act: Act = 'recon'
  private keyHandler: (e: KeyboardEvent) => void
  private pointerHandler: (e: PointerEvent) => void

  private head!: HTMLElement
  private log!: HTMLElement
  private stage!: HTMLElement
  private fill!: HTMLElement
  private skip!: HTMLElement

  private relays: RelayChoice[]
  private chosen: RelayChoice | null = null

  constructor(mount: HTMLElement, private opts: BootOptions) {
    this.relays = buildRelays(opts.rng)

    this.el = document.createElement('div')
    this.el.className = 'boot'

    const frame = document.createElement('div')
    frame.className = 'boot__frame'

    this.head = document.createElement('div')
    this.head.className = 'boot__head'

    this.log = document.createElement('div')
    this.log.className = 'boot__log'

    // Act-specific furniture (the mark, the hop chain, the buttons) lives
    // here so streaming log lines never have to be interleaved with it.
    this.stage = document.createElement('div')
    this.stage.className = 'boot__stage'

    const bar = document.createElement('div')
    bar.className = 'boot__bar'
    this.fill = document.createElement('div')
    this.fill.className = 'boot__bar-fill'
    bar.appendChild(this.fill)

    this.skip = document.createElement('div')
    this.skip.className = 'boot__skip'

    frame.append(this.head, this.stage, this.log, bar, this.skip)
    this.el.appendChild(frame)
    mount.appendChild(this.el)

    // Both escapes: any input, and an absolute ceiling regardless of input.
    this.keyHandler = (e) => this.onKeyDown(e)
    this.pointerHandler = (e) => this.onPointerDown(e)
    window.addEventListener('keydown', this.keyHandler, true)
    this.el.addEventListener('pointerdown', this.pointerHandler)
    this.timers.push(setTimeout(() => this.finish(), HARD_CAP_MS))

    this.startRecon()
  }

  // -- skip plumbing -----------------------------------------------------

  /**
   * A pointerdown anywhere skips -- EXCEPT on the sequence's own controls.
   *
   * Without this guard, clicking a relay button would skip the entire boot
   * instead of choosing, because the skip listener is bound to the whole
   * overlay and fires first. That is the exact failure the plan calls out.
   */
  private onPointerDown(e: PointerEvent): void {
    const t = e.target as Element | null
    if (t?.closest('[data-boot-interactive]')) return
    this.finish()
  }

  /**
   * Any key skips, with one carve-out: while the relay choice is up, the
   * digits that select a relay must select rather than skip. Everything
   * else -- including mashing, which is what a player does here -- still
   * gets them straight to the board.
   */
  private onKeyDown(e: KeyboardEvent): void {
    if (this.act === 'relay' && !this.chosen) {
      const idx = ['1', '2', '3'].indexOf(e.key)
      if (idx >= 0) {
        const relay = this.relays[idx]
        if (relay) {
          e.preventDefault()
          this.chooseRelay(relay)
          return
        }
      }
    }
    this.finish()
  }

  // -- act 1: recon ------------------------------------------------------

  private startRecon(): void {
    const { contract, handle } = this.opts
    this.head.textContent = `RECON :: ${contract.facts.domain}`
    this.skip.textContent = 'PRESS ANY KEY TO SKIP'
    this.setProgress(0.06)

    this.stage.replaceChildren(this.buildMark())
    this.stream(this.reconLines(handle), RECON_LINE_MS, () => {
      this.setProgress(0.34)
      this.startRelay()
    })
  }

  /** The org as an object on screen: monogram, sector, tier pips. */
  private buildMark(): HTMLElement {
    const { contract } = this.opts
    const wrap = document.createElement('div')
    wrap.className = 'boot__mark'

    const glyph = document.createElement('div')
    glyph.className = 'boot__mark-glyph'
    glyph.textContent = monogram(contract.facts.org)

    const meta = document.createElement('div')
    meta.className = 'boot__mark-meta'

    const org = document.createElement('div')
    org.className = 'boot__mark-org'
    org.textContent = contract.facts.org

    const sec = document.createElement('div')
    sec.className = 'boot__mark-sub'
    sec.textContent = `${sectorLabel(contract.sector)}  ·  ${contract.facts.subnet}`

    const tier = document.createElement('div')
    tier.className = 'boot__mark-tier'
    tier.textContent = `SECURITY ${'◆'.repeat(contract.tier)}${'◇'.repeat(5 - contract.tier)}`

    meta.append(org, sec, tier)
    wrap.append(glyph, meta)
    return wrap
  }

  private reconLines(handle: string): string[] {
    const { contract, rng } = this.opts
    const d = contract.facts.domain
    return [
      `operator ${handle} :: session key generated`,
      `resolving ${d} ......... ${contract.facts.subnet.split('/')[0]}`,
      `port sweep ............. 22/tcp ${pick(rng, ['filtered', 'open'])}  443/tcp open  ${int(rng, 3000, 9000)}/tcp open`,
      `banner ................. ${pick(rng, ['nginx/1.24.0', 'Apache/2.4.57', 'cloudflare', 'IIS/10.0'])}`,
      `stack .................. ${pick(rng, ['java/17', 'php-fpm/8.2', 'node/20', 'dotnet/8'])} · ${pick(rng, ['postgres', 'oracle', 'mssql', 'mongo'])}`,
      `edge filter ............ ${pick(rng, ['WAF present', 'rate-limited', 'geo-fenced'])}`,
    ]
  }

  // -- act 2: relay ------------------------------------------------------

  private startRelay(): void {
    this.act = 'relay'
    this.head.textContent = 'RELAY :: BUILDING HOP CHAIN'
    // The recon lines stay. Clearing them left a dead rectangle under the
    // relay buttons for the whole act, and the log caps itself at 7 rows
    // anyway, so the handshake lines push them out on their own.
    const chain = document.createElement('div')
    chain.className = 'boot__chain'
    this.stage.replaceChildren(chain)

    const hops = int(this.opts.rng, 4, 6)
    let i = 0
    this.interval = setInterval(() => {
      if (i >= hops) {
        this.clearInterval()
        this.setProgress(0.52)
        this.offerRelays()
        return
      }
      const node = document.createElement('span')
      node.className = 'boot__hop'
      const city = pick(this.opts.rng, CITIES)
      node.textContent = `${city} ${int(this.opts.rng, 12, 240)}ms`
      chain.appendChild(node)
      i += 1
    }, HOP_MS)
  }

  private offerRelays(): void {
    this.head.textContent = 'RELAY :: CHOOSE AN EXIT NODE'
    this.skip.textContent = 'PICK ONE, OR PRESS 1 / 2 / 3'

    const box = document.createElement('div')
    box.className = 'boot__relays'

    this.relays.forEach((relay, i) => {
      const btn = document.createElement('button')
      btn.className = 'boot__relay'
      // Load-bearing: the overlay-wide pointerdown skip checks for this
      // attribute and stands down, so the click reaches the button.
      btn.setAttribute('data-boot-interactive', '')
      btn.dataset.relayId = relay.id

      const name = document.createElement('span')
      name.className = 'boot__relay-name'
      name.textContent = `${i + 1}. ${relay.city.toUpperCase()}`

      const lat = document.createElement('span')
      lat.className = 'boot__relay-lat'
      lat.textContent = `${relay.latencyMs}ms`

      const note = document.createElement('span')
      note.className = 'boot__relay-note'
      note.textContent = relay.note

      btn.append(name, lat, note)
      btn.addEventListener('click', () => this.chooseRelay(relay))
      box.appendChild(btn)
    })

    this.stage.appendChild(box)

    // Untouched, the middle option takes itself. A choice that can block
    // the sequence is a gate, and this must never be a gate.
    this.timers.push(
      setTimeout(() => {
        if (!this.chosen) this.chooseRelay(this.relays[1] ?? this.relays[0]!)
      }, RELAY_AUTO_MS),
    )
  }

  private chooseRelay(relay: RelayChoice): void {
    if (this.chosen || this.done) return
    this.chosen = relay

    for (const el of this.stage.querySelectorAll('.boot__relay')) {
      el.classList.toggle('is-chosen', (el as HTMLElement).dataset.relayId === relay.id)
      ;(el as HTMLButtonElement).disabled = true
    }

    this.head.textContent = `RELAY :: ${relay.city.toUpperCase()} — HANDSHAKE`
    this.skip.textContent = 'PRESS ANY KEY TO SKIP'
    this.setProgress(0.72)

    // The latency IS the wait. A slow exit streams more handshake before it
    // lets you in, which is what makes "cooler but slower" a real trade
    // rather than a label on a button.
    this.stream(this.handshakeLines(relay), HANDSHAKE_LINE_MS, () => this.startBreach())
  }

  private handshakeLines(relay: RelayChoice): string[] {
    const { rng, contract } = this.opts
    const pool = [
      `exit node ${relay.city} .... ${relay.latencyMs}ms rtt`,
      `negotiating TLS ........ ${pick(rng, ['TLS1.3', 'TLS1.2'])} / ${pick(rng, ['X25519', 'P-384'])}`,
      `session ticket ......... ${pick(rng, ['issued', 'resumed'])}`,
      `scrubbing headers ...... ${int(rng, 3, 11)} removed`,
      `padding traffic ........ ${int(rng, 40, 400)} kB decoy`,
      `rotating MAC ........... ok`,
      `dns over relay ......... ${contract.facts.domain} cached`,
      `bypassing edge filter .. ok`,
    ]
    return pool.slice(0, Math.max(1, relay.handshakeLines))
  }

  // -- act 3: breach -----------------------------------------------------

  private startBreach(): void {
    this.act = 'breach'
    this.head.textContent = `BREACH :: ${this.opts.contract.facts.org}`
    this.setProgress(0.92)

    const wrap = document.createElement('div')
    wrap.className = 'boot__engage-wrap'

    const btn = document.createElement('button')
    btn.className = 'boot__engage'
    btn.setAttribute('data-boot-interactive', '')
    btn.textContent = '[  E N G A G E  ]'
    btn.addEventListener('click', () => this.finish())

    wrap.appendChild(btn)
    this.stage.replaceChildren(wrap)
    this.pushLine(`tunnel established -- you are inside ${this.opts.contract.facts.org}`, true)

    // Soft auto-advance: a beat, not a gate.
    this.timers.push(setTimeout(() => this.finish(), ENGAGE_AUTO_MS))
  }

  // -- plumbing ----------------------------------------------------------

  private stream(lines: string[], everyMs: number, then: () => void): void {
    this.clearInterval()
    let i = 0
    this.interval = setInterval(() => {
      if (i >= lines.length) {
        this.clearInterval()
        then()
        return
      }
      this.pushLine(lines[i] ?? '', false)
      i += 1
    }, everyMs)
  }

  private pushLine(text: string, ok: boolean): void {
    const row = document.createElement('div')
    row.textContent = text
    if (ok) row.className = 'is-ok'
    this.log.appendChild(row)
    // The frame is a fixed height; old lines scroll rather than grow it.
    while (this.log.childElementCount > 7) this.log.firstElementChild?.remove()
    this.log.scrollTop = this.log.scrollHeight
  }

  private setProgress(v: number): void {
    this.fill.style.transform = `scaleX(${v})`
  }

  private clearInterval(): void {
    if (this.interval) clearInterval(this.interval)
    this.interval = null
  }

  private finish(): void {
    if (this.done) return
    this.done = true
    // Skipping still yields a relay. A caller that had to handle "no
    // choice" would need a second default anyway, and two defaults drift.
    const relay = this.chosen ?? this.relays[1] ?? this.relays[0]!
    this.destroy()
    this.opts.onDone({ relayId: relay.id, startHeat: relay.startHeat })
  }

  destroy(): void {
    this.done = true
    window.removeEventListener('keydown', this.keyHandler, true)
    this.el.removeEventListener('pointerdown', this.pointerHandler)
    this.clearInterval()
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    this.el.classList.add('is-closing')
    setTimeout(() => this.el.remove(), 260)
  }
}

// -- helpers ---------------------------------------------------------------

/**
 * Three exits with one axis of trade-off: seconds against heat.
 *
 * Deliberately not "one good, two bad" -- a fast exit is genuinely the
 * right call if you want to start moving, and the cold one is genuinely
 * right if you plan to go deep.
 */
function buildRelays(rng: Rng): RelayChoice[] {
  const cities = [...CITIES]
  const take = (): string => {
    const i = int(rng, 0, cities.length - 1)
    return cities.splice(i, 1)[0] ?? 'reykjavik'
  }
  return [
    {
      id: 'fast',
      city: take(),
      latencyMs: int(rng, 28, 58),
      startHeat: 18,
      handshakeLines: 1,
      note: 'straight in — they see the door move',
    },
    {
      id: 'mid',
      city: take(),
      latencyMs: int(rng, 150, 220),
      startHeat: 9,
      handshakeLines: 4,
      note: 'two extra hops — quieter',
    },
    {
      id: 'cold',
      city: take(),
      latencyMs: int(rng, 380, 470),
      startHeat: 0,
      handshakeLines: 8,
      note: 'slow, fully laundered — you arrive cold',
    },
  ]
}

/** Up to three initials from the org name, spaced out like a stamped mark. */
function monogram(org: string): string {
  const letters = org
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3)
  return letters || 'X'
}
