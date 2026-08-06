import { int, pick, hex, type Rng } from '@/core/rng'
import type { PlayModeProfile } from '@/core/progress'
import { makeToken, type Token, type TokenKind } from '@/sim/tokens'
import type { WindowManager } from '@/ui/windows/manager'
import type { Win } from '@/ui/windows/window'

/**
 * Interactive chains -- one window leading to another leading to a task
 * leading to a reward.
 *
 * The board's task panels are all "press or click until a bar fills". This
 * is the other thing: a side-thread you run *while* hacking, made of three
 * linked windows that each ask for a different kind of attention.
 *
 *   1. LEAD    -- an ally names a threat and hands you a command to run.
 *   2. SCANNER -- a meter that crawls on its own and JAMS. Each jam is a
 *                 small thing to clear; the board stays fully playable
 *                 underneath, so this competes for attention rather than
 *                 replacing the game.
 *   3. RESULT  -- what the scan found, and a decision about it.
 *
 * Finishing it pays a token (sim/tokens.ts) -- a skeleton key or a trojan
 * bypass -- which is the first thing in the game you *earn* rather than
 * are handed.
 *
 * Input rules, which matter: a chain window NEVER consumes a raw keystroke.
 * Mashing must keep flowing to the board exactly as before (the Round-5
 * routing fix). Chains are advanced by clicking, or by typing their code
 * and pressing ENTER -- both deliberate acts.
 */

export type ChainStage = 'lead' | 'scanner' | 'result' | 'done'

export interface ChainCallbacks {
  line: (text: string, tone: 'normal' | 'success' | 'warning' | 'danger' | 'system' | 'dim') => void
  damage: (amount: number) => void
  repair: (amount: number) => void
  coolHeat: (amount: number) => void
  grantToken: (token: Token) => void
}

export interface ChainOptions {
  manager: WindowManager
  rng: Rng
  org: string
  mode: PlayModeProfile
  cb: ChainCallbacks
}

/** The threat each chain is about. Flavour, but it drives every string in the chain. */
interface ChainTheme {
  /** The ally's warning, e.g. "don't pull anything dated after the 14th". */
  warning: string
  /** What the scan is looking for. */
  hunting: string
  /** The result line, with {n} for the count. */
  found: string
  /** The affirmative button. */
  act: string
  reward: TokenKind
}

const THEMES: readonly ChainTheme[] = [
  {
    warning: "don't pull anything dated after the 14th -- they seeded that batch",
    hunting: 'poisoned files in the export queue',
    found: '{n} FILES FLAGGED -- PAYLOAD SIGNATURES MATCH',
    act: 'PURGE',
    reward: 'skeleton',
  },
  {
    warning: 'their canary tokens are in the .pem files. leave those alone',
    hunting: 'canary tokens across the share',
    found: '{n} CANARIES LOCATED -- STILL SILENT',
    act: 'SILENCE THEM',
    reward: 'trojan',
  },
  {
    warning: 'someone else is already on this box. check before you move',
    hunting: 'foreign sessions on the host',
    found: '{n} FOREIGN SESSIONS -- NOT YOURS',
    act: 'KILL SESSIONS',
    reward: 'skeleton',
  },
  {
    warning: 'edge appliance still trusts an expired CA. that is your way in',
    hunting: 'trust anchors on the edge appliance',
    found: '{n} STALE ANCHORS -- STILL TRUSTED',
    act: 'FORGE CERT',
    reward: 'trojan',
  },
  {
    warning: 'they mirror every session to cold storage. scrub as you go',
    hunting: 'session mirrors in cold storage',
    found: '{n} MIRRORED SESSIONS OF YOURS',
    act: 'SCRUB',
    reward: 'skeleton',
  },
]

const ALLY_HANDLES = ['ghostwire', 'm0th', 'null_saint', 'brownout', 'tessellate', 'pale_rider']

/** Snags per scan, by mode. CASUAL still snags -- it just forgives you for being slow. */
function snagCountFor(mode: PlayModeProfile, rng: Rng): number {
  if (mode.id === 'casual') return int(rng, 1, 2)
  if (mode.id === 'irl') return int(rng, 3, 4)
  return int(rng, 2, 3)
}

/**
 * How long a jam waits before it clears itself.
 *
 * CASUAL clears on its own quickly -- "they can still be typed/tapped
 * through like before on easier modes". IRL never does: it sits there
 * bleeding integrity until you deal with it.
 */
function snagAutoReleaseMs(mode: PlayModeProfile): number {
  if (mode.id === 'casual') return 6000
  if (mode.id === 'leet') return 16000
  return Number.POSITIVE_INFINITY
}

export class Chain {
  stage: ChainStage = 'lead'
  private win: Win | null = null
  private theme: ChainTheme
  private handle: string
  private command: string
  private destroyed = false

  // scanner state
  private progress = 0
  private snagsLeft = 0
  private snagCode: string | null = null
  private snagSinceMs = 0
  private bar: HTMLElement | null = null
  private readout: HTMLElement | null = null
  private snagBox: HTMLElement | null = null
  private foundCount = 0

  constructor(private opts: ChainOptions) {
    const { rng } = opts
    this.theme = pick(rng, THEMES)
    this.handle = pick(rng, ALLY_HANDLES)
    // Reads like something the target's own tooling would emit, which is
    // the point -- the player is meant to feel handed a real command.
    this.command = `run_scan=x.${int(rng, 10, 28)}.${hex(rng, 4)}*`
    this.foundCount = int(rng, 3, 26)
    this.snagsLeft = snagCountFor(opts.mode, rng)
    this.openLead()
  }

  get active(): boolean {
    return !this.destroyed && this.stage !== 'done'
  }

  /** The string the player can type to advance the chain right now, if any. */
  get pendingCode(): string | null {
    if (this.destroyed) return null
    if (this.stage === 'lead') return this.command
    if (this.stage === 'scanner' && this.snagCode) return this.snagCode
    return null
  }

  /**
   * Try to advance the chain with a typed line. Returns true if it was
   * consumed, so the shell can skip its normal command handling.
   */
  trySubmit(raw: string): boolean {
    const want = this.pendingCode
    if (!want) return false
    const norm = (s: string): string => s.replace(/[^a-z0-9]/gi, '').toLowerCase()
    if (!norm(raw) || norm(raw) !== norm(want)) return false
    if (this.stage === 'lead') this.openScanner()
    else this.clearSnag()
    return true
  }

  // -- 1. LEAD ------------------------------------------------------------

  private openLead(): void {
    const win = this.spawn(`MSG :: ${this.handle}@relay`, 'chainwin--lead')
    const body = document.createElement('div')
    body.className = 'chain'

    const from = document.createElement('div')
    from.className = 'chain__from'
    from.textContent = `${this.handle}@relay`

    const text = document.createElement('div')
    text.className = 'chain__text'
    text.textContent = `${this.opts.org}: ${this.theme.warning}. run this on your side:`

    // The command is the interactive element. Click it or type it -- both
    // are deliberate, and neither steals a raw keystroke from the board.
    const cmd = document.createElement('button')
    cmd.className = 'chain__cmd'
    cmd.textContent = this.command
    cmd.addEventListener('click', () => this.openScanner())

    const hint = document.createElement('div')
    hint.className = 'chain__hint'
    hint.textContent = 'click it, or type it and press ENTER'

    body.append(from, text, cmd, hint)
    win.setBody(body)
  }

  // -- 2. SCANNER ---------------------------------------------------------

  private openScanner(): void {
    if (this.stage !== 'lead' || this.destroyed) return
    this.stage = 'scanner'
    this.detachCurrent()

    const win = this.spawn(`SCAN :: ${this.theme.hunting.toUpperCase()}`, 'chainwin--scan', true)
    const body = document.createElement('div')
    body.className = 'chain'

    this.readout = document.createElement('div')
    this.readout.className = 'chain__readout'

    const track = document.createElement('div')
    track.className = 'chain__track'
    this.bar = document.createElement('div')
    this.bar.className = 'chain__bar'
    track.appendChild(this.bar)

    this.snagBox = document.createElement('div')
    this.snagBox.className = 'chain__snag'

    body.append(this.readout, track, this.snagBox)
    win.setBody(body)
    this.paintScanner()
    this.opts.cb.line(`scan started -- ${this.theme.hunting}`, 'system')
  }

  /**
   * Advance the scan. Called from the shell's tick, so it runs at the same
   * pace as everything else and keeps running while the player works the
   * board -- which is the entire point of the beat.
   */
  tick(dtMs: number): void {
    if (this.destroyed || this.stage !== 'scanner') return

    if (this.snagCode) {
      this.snagSinceMs += dtMs
      const limit = snagAutoReleaseMs(this.opts.mode)
      // IRL never auto-releases, and a jam left sitting costs you.
      if (this.opts.mode.idleDrainPerSec > 0 && this.snagSinceMs > 3000) {
        this.opts.cb.damage((1.2 * dtMs) / 1000)
      }
      if (this.snagSinceMs >= limit) {
        this.opts.cb.line('scan head freed itself -- resuming', 'system')
        this.clearSnag()
      }
      this.paintScanner()
      return
    }

    // Slow on purpose: this has to still be running while several panels
    // come and go, or it is just another progress bar.
    this.progress = Math.min(100, this.progress + (dtMs / 1000) * 7.5)

    // Jams are spread across the run rather than rolled per-tick, so a
    // scan never finishes without any and never jams three times in a row.
    const nextGate = 100 - (this.snagsLeft * 100) / (this.snagsLeft + 1)
    if (this.snagsLeft > 0 && this.progress >= nextGate) this.raiseSnag()

    if (this.progress >= 100) this.openResult()
    this.paintScanner()
  }

  private raiseSnag(): void {
    this.snagsLeft -= 1
    this.snagSinceMs = 0
    this.snagCode = `${pick(this.opts.rng, ['blk', 'sec', 'acl', 'ids', 'ctl'])}-${hex(this.opts.rng, 2)}`
    this.opts.cb.line(`!! scan stalled at ${Math.round(this.progress)}% -- ${this.snagCode} is blocking`, 'warning')
    this.win?.el.classList.add('is-snagged')
  }

  private clearSnag(): void {
    if (!this.snagCode) return
    this.snagCode = null
    this.snagSinceMs = 0
    this.win?.el.classList.remove('is-snagged')
    this.paintScanner()
  }

  private paintScanner(): void {
    if (!this.bar || !this.readout || !this.snagBox) return
    this.bar.style.width = `${this.progress}%`
    this.readout.textContent = this.snagCode
      ? `STALLED AT ${Math.round(this.progress)}% -- BLOCKED BY ${this.snagCode.toUpperCase()}`
      : `SCANNING ${Math.round(this.progress)}%  --  ${this.theme.hunting}`

    if (!this.snagCode) {
      this.snagBox.innerHTML = ''
      return
    }
    if (this.snagBox.dataset.code === this.snagCode) return
    this.snagBox.dataset.code = this.snagCode
    this.snagBox.innerHTML = ''
    const btn = document.createElement('button')
    btn.className = 'chain__unstick'
    btn.textContent = `UNSTICK ${this.snagCode}`
    btn.addEventListener('click', () => this.clearSnag())
    const hint = document.createElement('div')
    hint.className = 'chain__hint'
    hint.textContent = 'click, or type the code and press ENTER'
    this.snagBox.append(btn, hint)
  }

  // -- 3. RESULT ----------------------------------------------------------

  private openResult(): void {
    if (this.destroyed || this.stage !== 'scanner') return
    this.stage = 'result'
    this.detachCurrent()

    const win = this.spawn('SCAN COMPLETE', 'chainwin--result')
    const body = document.createElement('div')
    body.className = 'chain'

    const head = document.createElement('div')
    head.className = 'chain__found'
    head.textContent = this.theme.found.replace('{n}', String(this.foundCount))

    const row = document.createElement('div')
    row.className = 'chain__actions'

    const yes = document.createElement('button')
    yes.className = 'chain__act'
    yes.textContent = this.theme.act
    yes.addEventListener('click', () => this.finish(true))

    const no = document.createElement('button')
    no.className = 'chain__act chain__act--soft'
    no.textContent = 'LEAVE THEM'
    no.addEventListener('click', () => this.finish(false))

    row.append(yes, no)
    body.append(head, row)
    win.setBody(body)
  }

  private finish(acted: boolean): void {
    if (this.stage === 'done') return
    this.stage = 'done'
    this.detachCurrent()
    const { cb, rng } = this.opts

    if (!acted) {
      // Not a punishment -- just a smaller outcome. Walking away from a
      // decision should be survivable, or the decision is fake.
      cb.coolHeat(6)
      cb.line('left them in place. their move.', 'warning')
      return
    }

    cb.repair(8)
    cb.coolHeat(14)
    const token = makeToken(rng, this.theme.reward)
    cb.grantToken(token)
    cb.line(`${this.theme.act} COMPLETE -- ${token.label} RECOVERED :: ${token.code}`, 'success')
    cb.line(`   spend it: click the chip in the HUD, or type ${token.code} and press ENTER`, 'system')
  }

  // -- plumbing -----------------------------------------------------------

  private spawn(title: string, cls: string, wide = false): Win {
    const win = this.opts.manager.spawn(
      {
        title,
        modal: false,
        closable: true,
        decor: 'normal',
        pinned: true,
        // The scanner is the one chain step that wants width: it is a
        // progress bar you watch while working elsewhere.
        span: wide ? { cols: 2, rows: 1 } : { cols: 1, rows: 1 },
      },
      'random',
    )
    win.el.classList.add('chainwin', cls)
    win.onClose(() => {
      // Closing a chain window abandons the chain rather than freezing it
      // half-open somewhere off-screen.
      if (this.win === win && this.stage !== 'done') this.abandon()
    })
    this.win = win
    return win
  }

  /**
   * Close the current window WITHOUT it counting as abandoning the chain.
   *
   * Every step closes its predecessor, and the close handler treats a
   * closed chain window as the player walking away -- so the handle has to
   * be dropped first, or advancing to step 2 would immediately cancel the
   * chain it just advanced.
   */
  private detachCurrent(): void {
    const old = this.win
    this.win = null
    old?.close()
  }

  private abandon(): void {
    if (this.stage === 'done') return
    this.stage = 'done'
    this.opts.cb.line('side task abandoned', 'dim')
  }

  destroy(): void {
    this.destroyed = true
    this.stage = 'done'
    this.win?.close()
    this.win = null
  }
}
