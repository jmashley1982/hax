import { int, pick, type Rng } from '@/core/rng'
import type { Token } from '@/sim/tokens'
import { makeToken } from '@/sim/tokens'

/**
 * The messenger -- a small docked buddy list, always there.
 *
 * Allies previously arrived as one-off popup windows that said something
 * and vanished, which made them decoration. This is a persistent panel
 * instead: a roster of other hackers who come online and go offline while
 * you work, chatter at you, and occasionally offer something real.
 *
 * The design rule that makes it worth having: **most messages are not
 * important, and a few save your run**. If every message mattered the
 * window would be a checklist; if none did it would be wallpaper. So the
 * roster idles with small talk, and then -- when the authorities are
 * actually rolling on you -- somebody you have been ignoring for ten
 * minutes offers to go and misdirect them, and that offer is loud,
 * pinned, and on a clock.
 *
 * Offers are accepted by clicking, or by typing the buddy's handle at the
 * prompt. Never by mashing: an offer that a stray keystroke could burn
 * would be worse than no offer.
 */

export type OfferKind = 'interference' | 'skeleton' | 'heat' | 'repair'

export interface Buddy {
  handle: string
  /** Their thing, shown under the handle. Flavour, but it makes them people. */
  spec: string
  online: boolean
}

export interface MessengerCallbacks {
  /** Accepted an offer. Return true if it was actually applied. */
  onAccept: (offer: Offer) => void
  line: (text: string) => void
}

export interface Offer {
  id: string
  kind: OfferKind
  from: string
  /** What they are offering, in their voice. */
  text: string
  /** Button label. */
  action: string
  /** ms before the offer lapses. */
  ttlMs: number
  /** Only for 'skeleton': the code they hand over. */
  token?: Token
}

const ROSTER: ReadonlyArray<Omit<Buddy, 'online'>> = [
  { handle: 'ghostwire', spec: 'traffic shaping / relay ops' },
  { handle: 'm0th', spec: 'social eng / phones' },
  { handle: 'null_saint', spec: 'firmware, mostly' },
  { handle: 'brownout', spec: 'ICS and anything with a breaker' },
  { handle: 'tessellate', spec: 'crypto, badly' },
  { handle: 'pale_rider', spec: 'dispatch systems' },
  { handle: 'kettle', spec: 'makes tea, reads packets' },
  { handle: 'orbit_decay', spec: 'satcom' },
]

/** Small talk. Deliberately not useful -- that is what makes the useful ones land. */
const CHATTER: readonly string[] = [
  'you still on that {org} box?',
  'saw your traffic. subtle as a brick, mate',
  'brb, landlord',
  'anyone else getting rate limited tonight',
  'this coffee is a war crime',
  'that {org} job pays what they said it pays?',
  'my uplink keeps flapping, ignore me',
  'if you find their VPN concentrator lmk',
  'told you their SOC was a skeleton crew',
  'watching a stream of someone playing this badly. relatable',
  'nice. that was clean',
  'careful. they escalate fast when they notice',
  'do NOT touch the .pem files. trust me',
  'their night shift clocks on in ten',
]

const GREETINGS = ['hey', 'evening', 'oi', 'yo', 'still alive?', 'sup']

export class Messenger {
  private el: HTMLElement
  private rosterEl: HTMLElement
  private logEl: HTMLElement
  private intelEl: HTMLElement
  private offerEl: HTMLElement
  private unreadEl!: HTMLElement
  private unread = 0
  private buddies: Buddy[]
  private offer: Offer | null = null
  private offerAgeMs = 0
  private nextChatterMs = 12_000
  private nextRosterMs = 18_000
  private elapsed = 0

  constructor(
    mount: HTMLElement,
    private rng: Rng,
    private org: string,
    private cb: MessengerCallbacks,
  ) {
    this.buddies = ROSTER.map((b, i) => ({ ...b, online: i < 3 }))

    this.el = document.createElement('div')
    this.el.className = 'msgr'

    const head = document.createElement('div')
    head.className = 'msgr__head'
    const headLabel = document.createElement('span')
    headLabel.textContent = 'RELAY :: CONTACTS'
    this.unreadEl = document.createElement('span')
    this.unreadEl.className = 'msgr__unread'
    head.append(headLabel, this.unreadEl)

    this.rosterEl = document.createElement('div')
    this.rosterEl.className = 'msgr__roster'

    this.logEl = document.createElement('div')
    this.logEl.className = 'msgr__log'

    this.intelEl = document.createElement('div')
    this.intelEl.className = 'msgr__intel'

    this.offerEl = document.createElement('div')
    this.offerEl.className = 'msgr__offer'

    this.el.append(head, this.rosterEl, this.logEl, this.intelEl, this.offerEl)
    this.el.addEventListener('pointerenter', this.markRead)
    this.el.addEventListener('pointerdown', this.markRead)
    mount.appendChild(this.el)

    this.paintRoster()
    this.say(pick(rng, this.online())?.handle ?? 'ghostwire', pick(rng, GREETINGS))
  }

  private online(): Buddy[] {
    return this.buddies.filter((b) => b.online)
  }

  /** Whether an offer is currently on the table -- the shell checks this before firing its own beats. */
  get hasOffer(): boolean {
    return this.offer !== null
  }

  get offerFrom(): string | null {
    return this.offer?.from ?? null
  }

  tick(dtMs: number): void {
    this.elapsed += dtMs

    if (this.offer) {
      this.offerAgeMs += dtMs
      this.paintOfferTimer()
      if (this.offerAgeMs >= this.offer.ttlMs) {
        const from = this.offer.from
        this.offer = null
        this.offerEl.innerHTML = ''
        this.el.classList.remove('is-urgent')
        this.say(from, 'too slow. i tried.')
      }
    }

    if (this.elapsed >= this.nextChatterMs) {
      this.nextChatterMs = this.elapsed + int(this.rng, 16_000, 34_000)
      const who = pick(this.rng, this.online())
      if (who) this.say(who.handle, pick(this.rng, CHATTER).replace(/\{org\}/g, this.org))
    }

    if (this.elapsed >= this.nextRosterMs) {
      this.nextRosterMs = this.elapsed + int(this.rng, 20_000, 40_000)
      this.churnRoster()
    }
  }

  /**
   * People coming and going is what makes the roster feel like a room
   * rather than a menu. At least two stay online at all times -- an empty
   * contact list at the moment you need help would just be cruel.
   */
  private churnRoster(): void {
    const candidates = this.buddies.filter((b) => !b.online)
    if (this.online().length <= 2 || this.rng() < 0.55) {
      const who = pick(this.rng, candidates)
      if (who) {
        who.online = true
        this.say(who.handle, pick(this.rng, GREETINGS), 'join')
      }
    } else {
      const who = pick(this.rng, this.online())
      if (who) {
        who.online = false
        this.say(who.handle, 'afk', 'part')
      }
    }
    this.paintRoster()
  }

  private paintRoster(): void {
    this.rosterEl.innerHTML = ''
    for (const b of this.buddies) {
      const row = document.createElement('div')
      row.className = `msgr__buddy${b.online ? ' is-online' : ''}`
      const dot = document.createElement('span')
      dot.className = 'msgr__dot'
      const name = document.createElement('span')
      name.className = 'msgr__handle'
      name.textContent = b.handle
      row.append(dot, name)
      row.title = b.spec
      this.rosterEl.appendChild(row)
    }
  }

  private say(from: string, text: string, kind: 'msg' | 'join' | 'part' = 'msg'): void {
    const row = document.createElement('div')
    row.className = `msgr__line msgr__line--${kind}`
    if (kind === 'msg') {
      const who = document.createElement('span')
      who.className = 'msgr__who'
      who.textContent = `${from}:`
      const body = document.createElement('span')
      body.textContent = ` ${text}`
      row.append(who, body)
    } else {
      row.textContent = kind === 'join' ? `-- ${from} is online` : `-- ${from} went dark`
    }
    // Highlight the newest line briefly and bump the unread pip, so an
    // arrival registers in peripheral vision. Nothing pulses the whole
    // panel -- that stays reserved for offers, which is what makes an
    // offer mean something.
    row.classList.add('is-new')
    setTimeout(() => row.classList.remove('is-new'), 1700)
    this.unread += 1
    this.unreadEl.textContent = String(this.unread)

    this.logEl.appendChild(row)
    while (this.logEl.children.length > 14) this.logEl.firstElementChild?.remove()
    this.logEl.scrollTop = this.logEl.scrollHeight
  }

  /** Clear the pip once the player has plainly looked at it. */
  private markRead = (): void => {
    this.unread = 0
    this.unreadEl.textContent = ''
  }

  /**
   * A contact hands you something you will need shortly, and it STAYS.
   *
   * Ordinary chatter is evicted from the log at 14 lines, so a credential
   * delivered as a normal message could be scrolled away by small talk
   * before the gate that wants it arrives -- turning the one mechanically
   * load-bearing message in the game into a coin flip on how talkative the
   * roster happened to be. This pins it above the offer slot instead.
   *
   * Returns the handle it came from, or null if the roster is somehow
   * empty -- the caller must not promise the player a key nobody sent.
   */
  pinIntel(text: string): string | null {
    // Drag someone online if nobody is, exactly as raiseOffer does: intel
    // that cannot arrive is worse than no roster at all.
    let who: Buddy | undefined = pick(this.rng, this.online())
    if (!who) {
      who = this.buddies[0]
      if (who) {
        who.online = true
        this.paintRoster()
      }
    }
    if (!who) return null

    this.say(who.handle, text)
    this.intelEl.textContent = `${who.handle} :: ${text}`
    return who.handle
  }

  /** The pinned intel has been used or has expired with its gate. */
  clearIntel(): void {
    this.intelEl.textContent = ''
  }

  /**
   * Someone offers to save you.
   *
   * `interference` is the one the whole system exists for: they are
   * routing the authorities away from you, and it only exists because
   * something already went badly wrong.
   */
  raiseOffer(kind: OfferKind, force = false): Offer | null {
    // An interference offer arrives at the single worst moment of the run,
    // and a convenience offer that happened to be sitting there must not
    // block it. Measured on seed hunt2: a "TAKE THE KEY" offer raised
    // seconds earlier swallowed the interference offer entirely, so the
    // one beat the messenger exists for never appeared.
    if (this.offer && !force) return null
    if (this.offer && force) {
      this.offer = null
      this.offerEl.innerHTML = ''
      this.el.classList.remove('is-urgent', 'is-critical')
    }
    // Prefer an online contact; drag one online if nobody is, because a
    // help offer that cannot happen is worse than no roster at all.
    let who: Buddy | undefined = pick(this.rng, this.online())
    if (!who) {
      who = this.buddies[0]
      if (who) {
        who.online = true
        this.paintRoster()
      }
    }
    if (!who) return null

    const from = who.handle
    const offer: Offer =
      kind === 'interference'
        ? {
            id: `off-${this.elapsed}`,
            kind,
            from,
            text: `i can see the dispatch traffic. give me the word and i will feed them a bad address -- but i need you to hold their line open. NOW.`,
            action: `RUN INTERFERENCE`,
            ttlMs: 12_000,
          }
        : kind === 'skeleton'
          ? {
              id: `off-${this.elapsed}`,
              kind,
              from,
              text: `pulled a master credential off their jump host. it is yours if you want it.`,
              action: 'TAKE THE KEY',
              ttlMs: 20_000,
              token: makeToken(this.rng, 'skeleton'),
            }
          : kind === 'heat'
            ? {
                id: `off-${this.elapsed}`,
                kind,
                from,
                text: `their SOC is looking at me instead of you for a minute. want me to make it loud?`,
                action: 'MAKE IT LOUD',
                ttlMs: 18_000,
              }
            : {
                id: `off-${this.elapsed}`,
                kind,
                from,
                text: `your box looks rough from here. i have a clean image, i can push it now.`,
                action: 'PUSH THE IMAGE',
                ttlMs: 18_000,
              }

    this.offer = offer
    this.offerAgeMs = 0
    this.paintOffer(offer)
    this.say(from, offer.text)
    return offer
  }

  private paintOffer(offer: Offer): void {
    this.offerEl.innerHTML = ''
    this.el.classList.add('is-urgent')
    // Interference is life-or-death, so it gets the loudest treatment; the
    // others are useful but not urgent, and should not cry wolf.
    this.el.classList.toggle('is-critical', offer.kind === 'interference')

    const from = document.createElement('div')
    from.className = 'msgr__offer-from'
    from.textContent = `${offer.from} is offering:`

    const btn = document.createElement('button')
    btn.className = 'msgr__accept'
    btn.textContent = offer.action
    btn.addEventListener('click', () => this.accept())

    const hint = document.createElement('div')
    hint.className = 'msgr__offer-hint'
    hint.textContent = `click, or type ${offer.from} and press ENTER`

    const timer = document.createElement('div')
    timer.className = 'msgr__offer-timer'
    const fill = document.createElement('div')
    fill.className = 'msgr__offer-timer-fill'
    timer.appendChild(fill)

    this.offerEl.append(from, btn, hint, timer)
  }

  private paintOfferTimer(): void {
    const fill = this.offerEl.querySelector<HTMLElement>('.msgr__offer-timer-fill')
    if (!fill || !this.offer) return
    fill.style.width = `${Math.max(0, 100 - (this.offerAgeMs / this.offer.ttlMs) * 100)}%`
  }

  /** Typing a buddy's handle accepts their standing offer. */
  trySubmit(raw: string): boolean {
    if (!this.offer) return false
    const norm = raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (norm !== this.offer.from.toLowerCase().replace(/[^a-z0-9_]/g, '')) return false
    this.accept()
    return true
  }

  private accept(): void {
    const offer = this.offer
    if (!offer) return
    this.offer = null
    this.offerEl.innerHTML = ''
    this.el.classList.remove('is-urgent', 'is-critical')
    this.say(offer.from, 'on it. go.')
    this.cb.onAccept(offer)
  }

  destroy(): void {
    this.el.remove()
  }
}
