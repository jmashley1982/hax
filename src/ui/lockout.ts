import { int, pick, type Rng } from '@/core/rng'
import { isMobileLayout } from '@/core/device'

/**
 * LOCKOUT -- the target turns the tables and kills *your* terminal.
 *
 * Every other setback in the game happens to your connection. This one
 * happens to your machine: the screen dies, and you have to physically
 * bring the rig back up through a boot ceremony before you can keep
 * working. It's the one moment the player is on the back foot completely.
 *
 * Design rules, same as every other interaction here: dramatic but never
 * hard. Each reboot step is a handful of taps/keys, impossible to fail,
 * and the whole sequence runs about fifteen seconds. The tension comes
 * from being locked out of your own board, not from difficulty.
 *
 * Input is deliberately device-agnostic: every stage accepts a keypress
 * OR a tap on its own control, so the ceremony plays identically with a
 * keyboard or a thumb.
 */
export type LockoutStage = 'seize' | 'dead' | 'post' | 'power' | 'volumes' | 'rekey' | 'reconnect'

const POWER_HITS = 14
const VOLUME_COUNT = 4
const REKEY_SLOTS = 4
const GLYPHS = '0123456789ABCDEF'

const POST_LINES = [
  'NULLSTACK BIOS v2.14 -- POST',
  'CPU0: 8 cores @ 3.60GHz .......... OK',
  'MEM: counting ....................',
  'MEM: 32768MB ..................... OK',
  'AHCI: enumerating channels ....... OK',
  'CRYPTO: TPM self-test ............ OK',
  'NIC0: link down (no carrier)',
  'WARN: previous session ended abnormally',
]

const VOLUME_NAMES = ['/dev/sda1  root', '/dev/sda2  keys', '/dev/mapper/vault', '/dev/nvme0  scratch']

export interface LockoutOptions {
  /** The org that pulled the plug -- named so it reads as retaliation, not a glitch. */
  org: string
  rng: Rng
  onComplete: () => void
}

export class LockoutOverlay {
  private el: HTMLElement
  private stageEl: HTMLElement
  private titleEl: HTMLElement
  private stepEl: HTMLElement
  private stage: LockoutStage = 'seize'
  private rng: Rng
  private timers: Array<ReturnType<typeof setTimeout>> = []
  private intervals: Array<ReturnType<typeof setInterval>> = []
  private keyHandler: (e: KeyboardEvent) => void
  private done = false

  // per-stage progress
  private powerHits = 0
  private volumesMounted = 0
  private rekeyIndex = 0
  private rekeyCode: string[] = []

  constructor(mount: HTMLElement, private opts: LockoutOptions) {
    this.rng = opts.rng
    this.el = document.createElement('div')
    this.el.className = 'lockout lockout--seize'

    // A bounded firmware-console frame rather than text floating in a void
    // -- this is the player's own machine talking to them, so it should
    // look like a BIOS screen, not like more of the hacking UI.
    const frame = document.createElement('div')
    frame.className = 'lockout__frame'

    const head = document.createElement('div')
    head.className = 'lockout__head'
    head.textContent = 'NULLSTACK WORKSTATION :: LOCAL NODE'

    this.titleEl = document.createElement('div')
    this.titleEl.className = 'lockout__title'

    this.stageEl = document.createElement('div')
    this.stageEl.className = 'lockout__stage'

    this.stepEl = document.createElement('div')
    this.stepEl.className = 'lockout__steps'

    frame.append(head, this.titleEl, this.stageEl, this.stepEl)
    this.el.appendChild(frame)
    mount.appendChild(this.el)

    // A single global key listener drives every stage, so mashing carries
    // the player through the whole ceremony without ever having to aim.
    this.keyHandler = (e) => {
      if (e.key === 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      this.onInput()
    }
    window.addEventListener('keydown', this.keyHandler, true)

    this.runSeize()
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms))
  }

  /** Any keypress, or a tap on the stage's own control, advances the current stage. */
  private onInput(): void {
    switch (this.stage) {
      case 'dead':
        this.runPost()
        break
      case 'power':
        this.hitPower()
        break
      case 'volumes':
        this.mountNextVolume()
        break
      case 'rekey':
        this.hitRekey(null)
        break
      default:
        break
    }
  }

  /** Which of the three hands-on recovery steps a stage represents (0 = not one). */
  private static readonly STEP_OF: Partial<Record<LockoutStage, number>> = {
    power: 1,
    volumes: 2,
    rekey: 3,
  }

  private setStage(stage: LockoutStage, title: string): void {
    this.stage = stage
    this.el.className = `lockout lockout--${stage}`
    this.titleEl.textContent = title
    this.stageEl.replaceChildren()
    // Showing "STEP 2 OF 3" turns an opaque forced interruption into
    // something with a visible end -- the player can see themselves
    // getting back up rather than just enduring it.
    const step = LockoutOverlay.STEP_OF[stage]
    this.stepEl.textContent = step ? `RECOVERY STEP ${step} OF 3` : ''
  }

  // -- 1. the kill ------------------------------------------------------

  private runSeize(): void {
    this.setStage('seize', 'SESSION TERMINATED')
    const p = document.createElement('p')
    p.className = 'lockout__lead'
    p.textContent = `${this.opts.org} traced the intrusion and pushed a kill command back down your own tunnel.`
    const p2 = document.createElement('p')
    p2.className = 'lockout__lead lockout__lead--dim'
    p2.textContent = 'Your terminal is going down.'
    this.stageEl.append(p, p2)
    this.after(2200, () => this.runDead())
  }

  // -- 2. dead machine, waiting for a human ------------------------------

  private runDead(): void {
    this.setStage('dead', '')
    const halted = document.createElement('div')
    halted.className = 'lockout__halted'
    halted.textContent = 'SYSTEM HALTED'

    const btn = document.createElement('button')
    btn.className = 'lockout__power'
    btn.textContent = isMobileLayout() ? '⏻  TAP TO POWER ON' : '⏻  PRESS ANY KEY TO POWER ON'
    btn.addEventListener('click', () => this.onInput())

    this.stageEl.append(halted, btn)
  }

  // -- 3. POST ----------------------------------------------------------

  private runPost(): void {
    this.setStage('post', 'POWER ON SELF TEST')
    const log = document.createElement('div')
    log.className = 'lockout__log'
    this.stageEl.appendChild(log)

    let i = 0
    const iv = setInterval(() => {
      if (i >= POST_LINES.length) {
        clearInterval(iv)
        this.after(500, () => this.runPower())
        return
      }
      const line = document.createElement('div')
      line.textContent = POST_LINES[i] ?? ''
      log.appendChild(line)
      log.scrollTop = log.scrollHeight
      i += 1
    }, 170)
    this.intervals.push(iv)
  }

  // -- 4. restore power --------------------------------------------------

  private runPower(): void {
    this.setStage('power', 'RESTORE POWER RAIL')
    this.powerHits = 0

    const hint = document.createElement('p')
    hint.className = 'lockout__hint'
    hint.textContent = isMobileLayout() ? 'TAP REPEATEDLY to spin the supply back up' : 'MASH ANY KEY to spin the supply back up'

    const rail = document.createElement('div')
    rail.className = 'lockout__rail'
    const fill = document.createElement('div')
    fill.className = 'lockout__rail-fill'
    rail.appendChild(fill)

    const btn = document.createElement('button')
    btn.className = 'lockout__bigbtn'
    btn.textContent = 'CHARGE'
    btn.addEventListener('click', () => this.hitPower())

    this.stageEl.append(hint, rail, btn)
  }

  private hitPower(): void {
    this.powerHits += 1
    const fill = this.stageEl.querySelector('.lockout__rail-fill') as HTMLElement | null
    if (fill) fill.style.width = `${Math.min(100, (this.powerHits / POWER_HITS) * 100)}%`
    if (this.powerHits >= POWER_HITS) this.after(280, () => this.runVolumes())
  }

  // -- 5. remount volumes ------------------------------------------------

  private runVolumes(): void {
    this.setStage('volumes', 'REMOUNT VOLUMES')
    this.volumesMounted = 0

    const hint = document.createElement('p')
    hint.className = 'lockout__hint'
    hint.textContent = isMobileLayout() ? 'TAP each volume to remount it' : 'CLICK each volume (or press any key) to remount it'

    const list = document.createElement('div')
    list.className = 'lockout__volumes'
    for (let i = 0; i < VOLUME_COUNT; i++) {
      const row = document.createElement('button')
      row.className = 'lockout__volume'
      row.dataset.index = String(i)
      row.textContent = `${VOLUME_NAMES[i] ?? `/dev/vol${i}`}   [ UNMOUNTED ]`
      row.addEventListener('click', () => this.mountVolume(row))
      list.appendChild(row)
    }

    this.stageEl.append(hint, list)
  }

  private mountNextVolume(): void {
    const next = this.stageEl.querySelector('.lockout__volume:not(.is-mounted)') as HTMLElement | null
    if (next) this.mountVolume(next)
  }

  private mountVolume(row: HTMLElement): void {
    if (row.classList.contains('is-mounted')) return
    row.classList.add('is-mounted')
    const name = VOLUME_NAMES[Number(row.dataset.index)] ?? 'volume'
    row.textContent = `${name}   [ MOUNTED ]`
    this.volumesMounted += 1
    if (this.volumesMounted >= VOLUME_COUNT) this.after(320, () => this.runRekey())
  }

  // -- 6. re-key the session --------------------------------------------

  private runRekey(): void {
    this.setStage('rekey', 'RE-KEY SESSION')
    this.rekeyIndex = 0
    this.rekeyCode = Array.from({ length: REKEY_SLOTS }, () => pick(this.rng, GLYPHS.split('')))

    const hint = document.createElement('p')
    hint.className = 'lockout__hint'
    hint.textContent = isMobileLayout()
      ? 'TAP the glyphs in order to rebuild the key'
      : 'CLICK the glyphs in order (or press any key) to rebuild the key'

    const row = document.createElement('div')
    row.className = 'lockout__rekey'
    this.rekeyCode.forEach((g, i) => {
      const slot = document.createElement('button')
      slot.className = 'lockout__glyph'
      slot.textContent = g
      slot.dataset.index = String(i)
      slot.addEventListener('click', () => this.hitRekey(i))
      row.appendChild(slot)
    })

    this.stageEl.append(hint, row)
  }

  /**
   * Tapping out of order still counts. Requiring the exact next glyph
   * would turn the one moment the player is already on the back foot into
   * a precision test -- the ceremony is meant to be tense, not hard.
   */
  private hitRekey(_index: number | null): void {
    const slot = this.stageEl.querySelector('.lockout__glyph:not(.is-set)') as HTMLElement | null
    if (!slot) return
    slot.classList.add('is-set')
    this.rekeyIndex += 1
    if (this.rekeyIndex >= REKEY_SLOTS) this.after(320, () => this.runReconnect())
  }

  // -- 7. back online ----------------------------------------------------

  private runReconnect(): void {
    this.setStage('reconnect', 'RECONNECTING')
    const log = document.createElement('div')
    log.className = 'lockout__log'
    this.stageEl.appendChild(log)

    const lines = [
      'bringing up nic0 ................. OK',
      `re-establishing relay chain (${int(this.rng, 3, 7)} hops)`,
      'restoring session keys ........... OK',
      `re-attaching to ${this.opts.org} ...`,
      'TUNNEL RE-ESTABLISHED',
    ]
    let i = 0
    const iv = setInterval(() => {
      if (i >= lines.length) {
        clearInterval(iv)
        this.after(700, () => this.finish())
        return
      }
      const el = document.createElement('div')
      el.textContent = lines[i] ?? ''
      if (i === lines.length - 1) el.className = 'is-ok'
      log.appendChild(el)
      log.scrollTop = log.scrollHeight
      i += 1
    }, 260)
    this.intervals.push(iv)
  }

  private finish(): void {
    if (this.done) return
    this.done = true
    this.el.classList.add('is-closing')
    this.after(420, () => {
      this.destroy()
      this.opts.onComplete()
    })
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyHandler, true)
    for (const t of this.timers) clearTimeout(t)
    for (const i of this.intervals) clearInterval(i)
    this.el.remove()
  }
}
