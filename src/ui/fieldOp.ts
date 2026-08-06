import { int, pick, hex, type Rng } from '@/core/rng'
import type { PlayModeProfile } from '@/core/progress'
import type { WindowManager } from '@/ui/windows/manager'
import type { Win } from '@/ui/windows/window'

/**
 * THE FIELD OP -- the beat where you are waiting on a person.
 *
 * "moments that emerge where you're waiting on a person in real-time that
 * is supposed to input a USB stick on site somewhere. a warning msg is
 * sent to you alerting you that your guy is on-site, estimate contact
 * time in 1 minute, and a timer pops up you wait for the next message
 * from the guy who says execute, and you have to quickly run the transfer
 * so the guy can get it on the drive, rip the stick out, and run."
 *
 * Everything else in the game answers instantly. This one makes you sit
 * and watch a clock you do not control, and then gives you a very short
 * window to act -- which is the entire point. The waiting is the beat.
 *
 * Modelled on ui/chain/chain.ts: all timing runs off the shell's tick
 * rather than setTimeout, so a lockout freezing the simulation freezes
 * the courier too. A courier whose ETA kept burning while the player's
 * machine was dead would be indefensible.
 */

export type FieldOpPhase = 'inbound' | 'execute' | 'done'

export interface FieldOpCallbacks {
  line: (text: string, tone: 'normal' | 'success' | 'warning' | 'danger' | 'system') => void
  onSuccess: () => void
  onFailure: () => void
}

export interface FieldOpOptions {
  manager: WindowManager
  rng: Rng
  org: string
  mode: PlayModeProfile
  cb: FieldOpCallbacks
}

const COURIERS = ['DELIVERY', 'NIGHT CLEANER', 'CONTRACTOR', 'AGENCY TEMP', 'HVAC ENGINEER']
const SITES = ['LOADING BAY', 'REAR ENTRY', 'SERVER ROOM', 'RECORDS ANNEX', 'PLANT ROOM']

/** How long you get once EXECUTE lands. Short on purpose, shorter when it should be. */
function executeWindowMs(mode: PlayModeProfile): number {
  if (mode.id === 'casual') return 14_000
  if (mode.id === 'leet') return 10_000
  return 7000
}

export class FieldOp {
  private phase: FieldOpPhase = 'inbound'
  private win: Win | null = null
  private courier: string
  private site: string
  private serial: string
  /** Counts down to contact, then counts down the transfer window. */
  private remainingMs: number
  private progress = 0
  private destroyed = false

  private etaEl: HTMLElement | null = null
  private barEl: HTMLElement | null = null
  private readoutEl: HTMLElement | null = null

  constructor(private opts: FieldOpOptions) {
    this.courier = pick(opts.rng, COURIERS)
    this.site = pick(opts.rng, SITES)
    this.serial = hex(opts.rng, 4).toUpperCase()
    // Long enough that you can finish whatever you were doing, short
    // enough that you will still be thinking about it.
    this.remainingMs = int(opts.rng, 22_000, 32_000)
    this.openInbound()
  }

  get active(): boolean {
    return !this.destroyed && this.phase !== 'done'
  }

  /**
   * True only during the transfer window.
   *
   * Everything else on the board backs off while this is set -- waves,
   * lockouts, chains, ambient popups, and above all the objective bar.
   * A panel completing mid-transfer would otherwise overwrite the EXECUTE
   * prompt within about two seconds.
   */
  get critical(): boolean {
    return this.phase === 'execute'
  }

  // -- 1. inbound: a clock you do not control ----------------------------

  private openInbound(): void {
    const win = this.spawn(`FIELD :: ${this.courier}`, 'fieldwin--inbound')
    const body = document.createElement('div')
    body.className = 'fieldop'

    const from = document.createElement('div')
    from.className = 'fieldop__from'
    from.textContent = 'handler@relay'

    const text = document.createElement('div')
    text.className = 'fieldop__text'
    text.textContent =
      `our guy is on site at ${this.opts.org} -- ${this.site}. he has drive ${this.serial}. ` +
      `he plugs in and you get one shot. stand by.`

    this.etaEl = document.createElement('div')
    this.etaEl.className = 'fieldop__eta'

    const hint = document.createElement('div')
    hint.className = 'fieldop__hint'
    hint.textContent = 'keep working -- he will say when'

    body.append(from, text, this.etaEl, hint)
    win.setBody(body)
    this.paintEta()
    this.opts.cb.line(`>> FIELD OP :: courier on site at ${this.site}, stand by`, 'system')
  }

  private paintEta(): void {
    if (!this.etaEl) return
    const s = Math.max(0, Math.ceil(this.remainingMs / 1000))
    this.etaEl.textContent = `ESTIMATED CONTACT  0:${String(s).padStart(2, '0')}`
    this.etaEl.classList.toggle('is-close', s <= 5)
  }

  // -- 2. execute: the short window --------------------------------------

  private openExecute(): void {
    if (this.phase !== 'inbound' || this.destroyed) return
    this.phase = 'execute'
    this.remainingMs = executeWindowMs(this.opts.mode)
    this.detach()

    const win = this.spawn('*** EXECUTE ***', 'fieldwin--execute', true)
    const body = document.createElement('div')
    body.className = 'fieldop'

    const shout = document.createElement('div')
    shout.className = 'fieldop__shout'
    shout.textContent = `HE IS PLUGGED IN. GO.`

    this.readoutEl = document.createElement('div')
    this.readoutEl.className = 'fieldop__readout'

    const track = document.createElement('div')
    track.className = 'fieldop__track'
    this.barEl = document.createElement('div')
    this.barEl.className = 'fieldop__bar'
    track.appendChild(this.barEl)

    const push = document.createElement('button')
    push.className = 'fieldop__push'
    push.textContent = 'PUSH TRANSFER'
    push.addEventListener('click', () => this.pushTransfer())

    const hint = document.createElement('div')
    hint.className = 'fieldop__hint'
    hint.textContent = 'hammer it -- click or mash any key'

    body.append(shout, this.readoutEl, track, push, hint)
    win.setBody(body)
    this.paint()
    this.opts.cb.line('!!!! EXECUTE -- RUN THE TRANSFER NOW', 'danger')
  }

  /** Every push moves the bar. Mashing is routed here by the shell. */
  pushTransfer(): void {
    if (this.phase !== 'execute' || this.destroyed) return
    this.progress = Math.min(1, this.progress + 0.055)
    this.barEl?.classList.add('is-hit')
    setTimeout(() => this.barEl?.classList.remove('is-hit'), 90)
    this.paint()
    if (this.progress >= 1) this.finish(true)
  }

  private paint(): void {
    if (this.barEl) this.barEl.style.width = `${Math.round(this.progress * 100)}%`
    if (this.readoutEl) {
      const s = Math.max(0, this.remainingMs / 1000).toFixed(1)
      this.readoutEl.textContent = `DRIVE ${this.serial}  ${Math.round(this.progress * 100)}%  --  ${s}s`
    }
  }

  // -- the clock ---------------------------------------------------------

  tick(dtMs: number): void {
    if (this.destroyed || this.phase === 'done') return
    this.remainingMs -= dtMs

    if (this.phase === 'inbound') {
      this.paintEta()
      if (this.remainingMs <= 0) this.openExecute()
      return
    }

    this.paint()
    if (this.remainingMs <= 0) this.finish(false)
  }

  private finish(landed: boolean): void {
    if (this.phase === 'done') return
    this.phase = 'done'
    this.detach()
    if (landed) {
      this.opts.cb.line(`>>>> TRANSFER COMPLETE -- drive ${this.serial} is out of the building`, 'success')
      this.opts.cb.onSuccess()
    } else {
      this.opts.cb.line(`!! he had to run. drive ${this.serial} never left the desk.`, 'danger')
      this.opts.cb.onFailure()
    }
  }

  /**
   * Something bigger took the board. Counts as a miss, but quietly -- the
   * player did not choose this, so it should not read as their failure.
   */
  abort(reason: string): void {
    if (this.phase === 'done') return
    this.phase = 'done'
    this.detach()
    this.opts.cb.line(`-- field op aborted: ${reason}`, 'warning')
  }

  // -- plumbing ----------------------------------------------------------

  private spawn(title: string, cls: string, priority = false): Win {
    const win = this.opts.manager.spawn(
      {
        title,
        modal: false,
        closable: false,
        decor: priority ? 'danger' : 'normal',
        pinned: true,
        fixture: true,
        priority,
      },
      'random',
    )
    win.el.classList.add('fieldwin', cls)
    this.win = win
    return win
  }

  /** Drop the current window without it counting as anything. */
  private detach(): void {
    const old = this.win
    this.win = null
    old?.close()
  }

  destroy(): void {
    this.destroyed = true
    this.phase = 'done'
    this.detach()
  }
}
