import { hex, int } from '@/core/rng'
import type { WindowManager } from '@/ui/windows/manager'
import { TaskPanel, type PanelContext } from './panel'
import { inputVerbs } from '@/core/device'

/**
 * TRACE DEFENSE -- hostile pings crawl toward your core; click to pop
 * them. The urgency panel: it's the only one that asks for attention
 * rather than inviting it. Still never a loss -- a ping that lands just
 * adds heat and keeps going.
 */
export class TraceDefensePanel extends TaskPanel {
  private field!: HTMLElement
  private blocked = 0
  private needed = 6
  private spawnTimer = 0
  private pings: Array<{ el: HTMLElement; pos: number; speed: number }> = []

  constructor(manager: WindowManager, ctx: PanelContext) {
    super(manager, ctx, `traceDefense-${hex(ctx.rng, 4)}`, `TRACE DEFENSE ${hex(ctx.rng, 2).toUpperCase()}`)
    this.init()
  }

  get objectiveText(): string {
    return `CLICK incoming traces to block them (${this.blocked}/${this.needed} blocked)`
  }

  protected buildBody(): void {
    this.needed = 5 + Math.round(this.intensity * 3)

    const hint = document.createElement('div')
    hint.className = 'panel__hint'
    hint.textContent = inputVerbs('click the incoming traces')
    this.root.appendChild(hint)

    this.field = document.createElement('div')
    this.field.className = 'trace-field'
    const core = document.createElement('div')
    core.className = 'trace-core'
    core.textContent = '◉'
    this.field.appendChild(core)
    this.root.appendChild(this.field)

    for (let i = 0; i < 3; i++) this.spawnPing()
    this.updateTitle()
  }

  override onKeyBurst(): boolean {
    if (this.isDone) return false
    // Mashing fires flak at the closest ping. With nothing in flight the
    // keystroke rolls on to another panel rather than being wasted.
    const closest = this.pings.reduce<{ el: HTMLElement; pos: number; speed: number } | null>(
      (best, p) => (!best || p.pos > best.pos ? p : best),
      null,
    )
    if (!closest) return false
    this.block(closest)
    return true
  }

  /** Driven from the shell tick so pings actually advance. */
  tickPings(dtMs: number): void {
    if (this.isDone) return
    this.spawnTimer -= dtMs
    // Keep pings flowing briskly. Sparse spawns left this panel with
    // nothing to shoot at, which stalled a mashing player who'd rolled
    // onto it.
    if (this.spawnTimer <= 0 && this.pings.length < 5) {
      this.spawnPing()
      this.spawnTimer = int(this.rng, 260, 700)
    }
    for (const ping of [...this.pings]) {
      ping.pos = Math.min(100, ping.pos + (ping.speed * dtMs) / 1000)
      ping.el.style.left = `${ping.pos}%`
      if (ping.pos >= 100) {
        // Landed: costs a little heat via the shell, never a loss.
        ping.el.remove()
        this.pings = this.pings.filter((p) => p !== ping)
        this.win.el.classList.add('is-hit')
      }
    }
  }

  private spawnPing(): void {
    const el = document.createElement('button')
    el.className = 'trace-ping'
    el.textContent = '◄'
    el.style.left = '0%'
    el.style.top = `${int(this.rng, 12, 78)}%`
    const ping = { el, pos: 0, speed: int(this.rng, 12, 22) }
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      this.block(ping)
    })
    this.field.appendChild(el)
    this.pings.push(ping)
  }

  private block(ping: { el: HTMLElement; pos: number; speed: number }): void {
    if (this.isDone || !this.pings.includes(ping)) return
    ping.el.classList.add('is-popped')
    setTimeout(() => ping.el.remove(), 200)
    this.pings = this.pings.filter((p) => p !== ping)

    this.blocked += 1
    this.floatText('+BLOCKED')
    this.addProgress(1 / this.needed)
    this.updateTitle()
  }

  private updateTitle(): void {
    this.setTitleSuffix(`${this.blocked}/${this.needed} BLOCKED`)
  }
}
