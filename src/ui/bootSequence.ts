import { int, pick, type Rng } from '@/core/rng'
import type { Contract } from '@/sim/contracts'

/**
 * The connection sequence between JACK IN and the board.
 *
 * The session used to appear fully formed the instant you picked a
 * contract, which skipped the one moment the fiction most wants: actually
 * reaching the target. This is that beat -- relays, handshake, tunnel --
 * and it names the org, so it reads as connecting to *them* rather than as
 * a generic loading screen.
 *
 * Always skippable on any key or click, and it hard-caps its own runtime:
 * a boot screen you can get stuck on is the one failure mode this must not
 * have (plan §13a).
 */

const HARD_CAP_MS = 9000

export interface BootOptions {
  contract: Contract
  rng: Rng
  handle: string
  onDone: () => void
}

export class BootSequence {
  private el: HTMLElement
  private timers: Array<ReturnType<typeof setTimeout>> = []
  private interval: ReturnType<typeof setInterval> | null = null
  private done = false
  private keyHandler: () => void

  constructor(mount: HTMLElement, private opts: BootOptions) {
    const { contract } = opts

    this.el = document.createElement('div')
    this.el.className = 'boot'

    const frame = document.createElement('div')
    frame.className = 'boot__frame'

    const head = document.createElement('div')
    head.className = 'boot__head'
    head.textContent = `ESTABLISHING TUNNEL :: ${contract.facts.domain}`

    const log = document.createElement('div')
    log.className = 'boot__log'

    const bar = document.createElement('div')
    bar.className = 'boot__bar'
    const fill = document.createElement('div')
    fill.className = 'boot__bar-fill'
    bar.appendChild(fill)

    const skip = document.createElement('div')
    skip.className = 'boot__skip'
    skip.textContent = 'PRESS ANY KEY TO SKIP'

    frame.append(head, log, bar, skip)
    this.el.appendChild(frame)
    mount.appendChild(this.el)

    const lines = this.buildLines()
    fill.style.transition = `transform ${lines.length * 260}ms linear`
    requestAnimationFrame(() => {
      fill.style.transform = 'scaleX(1)'
    })

    let i = 0
    this.interval = setInterval(() => {
      if (i >= lines.length) {
        this.finish()
        return
      }
      const row = document.createElement('div')
      row.textContent = lines[i] ?? ''
      if (i === lines.length - 1) row.className = 'is-ok'
      log.appendChild(row)
      log.scrollTop = log.scrollHeight
      i += 1
    }, 260)

    // Both escapes: any input, and an absolute ceiling regardless of input.
    this.keyHandler = () => this.finish()
    window.addEventListener('keydown', this.keyHandler, true)
    this.el.addEventListener('pointerdown', this.keyHandler)
    this.timers.push(setTimeout(() => this.finish(), HARD_CAP_MS))
  }

  private buildLines(): string[] {
    const { contract, rng, handle } = this.opts
    const d = contract.facts.domain
    return [
      `operator ${handle} :: session key generated`,
      `resolving ${d} ......... ${contract.facts.subnet.split('/')[0]}`,
      `relay chain: ${int(rng, 4, 9)} hops via ${pick(rng, ['reykjavik', 'sofia', 'lagos', 'quito', 'perth', 'tallinn'])}`,
      `negotiating TLS ........ ${pick(rng, ['TLS1.3', 'TLS1.2'])} / ${pick(rng, ['X25519', 'P-384'])}`,
      `probing ${d}:443 ....... open`,
      `banner: ${pick(rng, ['nginx/1.24.0', 'Apache/2.4.57', 'cloudflare', 'IIS/10.0'])}`,
      `bypassing edge filter ... ok`,
      `tunnel established -- you are inside ${contract.facts.org}`,
    ]
  }

  private finish(): void {
    if (this.done) return
    this.done = true
    this.destroy()
    this.opts.onDone()
  }

  destroy(): void {
    this.done = true
    window.removeEventListener('keydown', this.keyHandler, true)
    if (this.interval) clearInterval(this.interval)
    for (const t of this.timers) clearTimeout(t)
    this.el.classList.add('is-closing')
    setTimeout(() => this.el.remove(), 260)
  }
}
