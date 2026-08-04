import { inputVerbs } from '@/core/device'
import type { ThreatEvent, ThreatKind } from '@/sim/counterHack'
import type { WindowManager } from '@/ui/windows/manager'
import type { Win } from '@/ui/windows/window'

const TITLES: Record<ThreatKind, string> = {
  traceback: 'TRACEBACK IN PROGRESS',
  reverseShell: 'REVERSE CONNECTION DETECTED',
  lockdown: 'AUTOMATED LOCKDOWN TRIGGERED',
}

const FLAVOR: Record<ThreatKind, (org: string) => string[]> = {
  traceback: (org) => [
    `${org} SOC has your session under active review.`,
    'Click the incoming pings to scrub your route before they resolve it.',
  ],
  reverseShell: (org) => [
    `An operator inside ${org} is trying to shell back into your machine.`,
    'Click to sever each connection attempt before it completes.',
  ],
  lockdown: (org) => [
    `${org} triggered an automated lockdown on this segment.`,
    'Click the closing gates before containment completes.',
  ],
}

/**
 * A threat panel: not a task the player chose, one the other side started.
 * Deliberately styled to look like an alarm, not a puzzle -- red chrome,
 * center placement, a visible countdown, and it demands a response rather
 * than waiting patiently.
 *
 * Resolving it (enough clicks before the timer runs out) is a real, named
 * win: you beat a specific security response. Failing it is a real, named
 * setback (a forced disconnect that scrambles the board) but never ends
 * the run -- consistent with "rewarding, not hard."
 */
export class ThreatPanel {
  readonly win: Win
  private hits = 0
  private resolved = false
  private timeoutHandle: ReturnType<typeof setTimeout>
  private nodes: HTMLElement[] = []

  constructor(
    manager: WindowManager,
    private event: ThreatEvent,
    org: string,
    private onResolve: (success: boolean) => void,
  ) {
    this.win = manager.spawn(
      { title: TITLES[event.kind], modal: false, closable: false, decor: 'danger', pinned: true },
      'center',
    )
    this.win.el.classList.add('threat')

    const body = document.createElement('div')
    const [line1, line2] = FLAVOR[event.kind](org)
    const p1 = document.createElement('p')
    p1.textContent = inputVerbs(line1 ?? '')
    const p2 = document.createElement('p')
    p2.className = 'panel__hint'
    p2.textContent = inputVerbs(line2 ?? '')
    body.append(p1, p2)

    const field = document.createElement('div')
    field.className = 'threat__field'
    for (let i = 0; i < event.hitsNeeded; i++) {
      const node = document.createElement('button')
      node.className = 'threat__node'
      node.textContent = '⛝'
      node.addEventListener('click', () => this.hit(node))
      this.nodes.push(node)
      field.appendChild(node)
    }
    body.appendChild(field)

    const countdown = document.createElement('div')
    countdown.className = 'win__countdown'
    const bar = document.createElement('div')
    bar.className = 'win__countdown-bar'
    countdown.appendChild(bar)
    body.appendChild(countdown)
    requestAnimationFrame(() => {
      bar.style.transition = `transform ${event.timeoutMs}ms linear`
      bar.style.transform = 'scaleX(0)'
    })

    this.win.setBody(body)
    this.updateTitle()

    this.timeoutHandle = setTimeout(() => this.finish(false), event.timeoutMs)
  }

  /** Any keystroke while this threat is active hits the next unresolved node -- mashing fights back. */
  onKeyBurst(): boolean {
    if (this.resolved) return false
    const next = this.nodes.find((n) => !n.classList.contains('is-cleared'))
    if (!next) return false
    this.hit(next)
    return true
  }

  private hit(node: HTMLElement): void {
    if (this.resolved || node.classList.contains('is-cleared')) return
    node.classList.add('is-cleared')
    node.textContent = '✕'
    this.hits += 1
    this.updateTitle()
    if (this.hits >= this.event.hitsNeeded) this.finish(true)
  }

  private updateTitle(): void {
    this.win.setTitle(`${TITLES[this.event.kind]} :: ${this.hits}/${this.event.hitsNeeded}`)
  }

  private finish(success: boolean): void {
    if (this.resolved) return
    this.resolved = true
    clearTimeout(this.timeoutHandle)
    this.win.el.classList.add(success ? 'is-cracked' : 'threat--failed')
    this.onResolve(success)
    setTimeout(() => this.win.close(), success ? 500 : 700)
  }

  get isResolved(): boolean {
    return this.resolved
  }
}
