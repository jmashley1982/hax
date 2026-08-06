import { int, pick, type Rng } from '@/core/rng'
import type { WindowManager } from './windows/manager'
import type { Win } from './windows/window'

/**
 * REVERSE HACK -- they are inside YOUR machine now (plan §16E).
 *
 * Distinct from both existing setbacks on purpose:
 *   ejection  they throw you out of THEIR network.
 *   lockout   they kill your terminal and you reboot.
 *   this      they are actively working your box while you watch.
 *
 * It escalates rather than firing at full strength, so it starts as
 * something you fight off around the edges of a live board and only becomes
 * a screen-stopping emergency if you ignore it:
 *
 *   1. infestation -- hostile windows crawl the desktop; kill each one.
 *   2. escalation  -- every window you let expire spawns two more.
 *   3. takeover    -- handed back to the caller to run the full-screen
 *                     assault (shell wires this to the lockout ceremony).
 *
 * Every window shows *your* data being worked on, not theirs -- that
 * inversion is the whole point of the beat.
 */

const HOSTILE_KINDS = [
  { title: 'enumerating /home', lines: ['~/.ssh/id_ed25519', '~/keys/vault.pem', '~/contracts/*.json', '~/.bash_history'] },
  { title: 'keylogger active', lines: ['captured: 148 keystrokes', 'buffer flushed to remote', 'window focus: NULLSTACK', 'clipboard read'] },
  { title: 'encrypting volume', lines: ['crypt/ .............. 12%', 'crypt/ .............. 38%', 'crypt/ .............. 61%', 'crypt/ .............. 84%'] },
  { title: 'exfil to unknown host', lines: ['POST 4.2MB -> 91.x.x.x', 'POST 8.8MB', 'POST 14.1MB', 'session recorded'] },
  { title: 'webcam handle opened', lines: ['/dev/video0 acquired', 'frame 001 captured', 'frame 002 captured', 'stream opened'] },
]

export interface ReverseHackOptions {
  manager: WindowManager
  mount: HTMLElement
  rng: Rng
  org: string
  /** Severity 0..1 -- scales how many windows arrive and how fast. */
  intensity: number
  /** A window the player failed to kill in time. */
  onBreach: () => void
  /** Every hostile window cleared -- the attack is beaten. */
  onRepelled: () => void
  /** Escalated past the point of fighting it off at the desktop. */
  onTakeover: () => void
}

interface Hostile {
  win: Win
  timer: ReturnType<typeof setTimeout>
  interval: ReturnType<typeof setInterval>
  killed: boolean
}

export class ReverseHack {
  private hostiles: Hostile[] = []
  private breaches = 0
  private spawnedTotal = 0
  private finished = false
  private maxBreaches: number

  constructor(private opts: ReverseHackOptions) {
    // Deeper/hotter attacks tolerate fewer mistakes before going full-screen.
    this.maxBreaches = Math.max(2, 4 - Math.round(opts.intensity * 2))
    opts.mount.classList.add('is-reverse-hacked')

    const initial = 2 + Math.round(opts.intensity * 2)
    for (let i = 0; i < initial; i++) this.spawnHostile()
  }

  get active(): boolean {
    return !this.finished
  }

  private spawnHostile(): void {
    if (this.finished) return
    // A hard ceiling so a runaway escalation can't bury the machine in
    // windows faster than anyone could possibly click them.
    if (this.spawnedTotal >= 14) return
    this.spawnedTotal += 1

    const kind = pick(this.opts.rng, HOSTILE_KINDS)
    const win = this.opts.manager.spawn(
      { title: `⚠ ${kind.title}`, modal: false, closable: false, decor: 'danger', pinned: true },
      'random',
    )
    win.el.classList.add('hostile')

    const body = document.createElement('div')
    body.className = 'hostile__body'

    const log = document.createElement('div')
    log.className = 'hostile__log'
    body.appendChild(log)

    const kill = document.createElement('button')
    kill.className = 'hostile__kill'
    kill.textContent = 'KILL PROCESS'
    body.appendChild(kill)

    const bar = document.createElement('div')
    bar.className = 'hostile__bar'
    const fill = document.createElement('div')
    fill.className = 'hostile__bar-fill'
    bar.appendChild(fill)
    body.appendChild(bar)

    win.setBody(body)

    const ttl = Math.max(3200, 7000 - this.opts.intensity * 3000)
    requestAnimationFrame(() => {
      fill.style.transition = `transform ${ttl}ms linear`
      fill.style.transform = 'scaleX(0)'
    })

    let i = 0
    const interval = setInterval(() => {
      const line = document.createElement('div')
      line.textContent = kind.lines[i % kind.lines.length] ?? ''
      log.appendChild(line)
      while (log.childElementCount > 4) log.firstElementChild?.remove()
      i += 1
    }, Math.max(420, ttl / 5))

    const hostile: Hostile = {
      win,
      timer: setTimeout(() => this.expire(hostile), ttl),
      interval,
      killed: false,
    }
    this.hostiles.push(hostile)

    kill.addEventListener('click', () => this.kill(hostile))
  }

  private kill(h: Hostile): void {
    if (h.killed || this.finished) return
    h.killed = true
    clearTimeout(h.timer)
    clearInterval(h.interval)
    h.win.el.classList.add('is-killed')
    setTimeout(() => h.win.close(), 260)
    this.hostiles = this.hostiles.filter((x) => x !== h)
    if (this.hostiles.length === 0) this.finish(true)
  }

  private expire(h: Hostile): void {
    if (h.killed || this.finished) return
    h.killed = true
    clearInterval(h.interval)
    h.win.el.classList.add('is-breached')
    setTimeout(() => h.win.close(), 400)
    this.hostiles = this.hostiles.filter((x) => x !== h)

    this.breaches += 1
    this.opts.onBreach()

    if (this.breaches >= this.maxBreaches) {
      this.finish(false)
      this.opts.onTakeover()
      return
    }

    // Escalation: ignoring one costs you two more.
    this.spawnHostile()
    this.spawnHostile()
  }

  private finish(repelled: boolean): void {
    if (this.finished) return
    this.finished = true
    this.opts.mount.classList.remove('is-reverse-hacked')
    if (repelled) this.opts.onRepelled()
  }

  /** Tear down without firing any outcome -- used when the session ends under it. */
  destroy(): void {
    this.finished = true
    for (const h of this.hostiles) {
      clearTimeout(h.timer)
      clearInterval(h.interval)
      h.win.close()
    }
    this.hostiles = []
    this.opts.mount.classList.remove('is-reverse-hacked')
  }
}

/** Flavour line naming who is doing this to you. */
export function reverseHackOpener(org: string, rng: Rng): string {
  return pick(rng, [
    `!!!! ${org} PIVOTED THROUGH YOUR TUNNEL -- HOSTILE PROCESSES ON THIS MACHINE`,
    `!!!! PAYLOAD DETONATED -- ${org} HAS CODE RUNNING LOCALLY`,
    `!!!! REVERSE SHELL ESTABLISHED FROM ${org} -- KILL IT`,
  ]) + ` [${int(rng, 2, 9)} PID]`
}
