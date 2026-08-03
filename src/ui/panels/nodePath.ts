import { hex, shuffle } from '@/core/rng'
import type { WindowManager } from '@/ui/windows/manager'
import { TaskPanel, type PanelContext } from './panel'

/**
 * NODE PATH -- click nodes in sequence to route from entry to target.
 *
 * Legal next hops always pulse, so there's never a guess; illegal clicks
 * shudder and cost nothing. The reward is watching a route physically draw
 * itself across the graph one hop at a time.
 */
export class NodePathPanel extends TaskPanel {
  private hops: HTMLElement[] = []
  private reached = 0

  constructor(manager: WindowManager, ctx: PanelContext) {
    super(manager, ctx, `nodePath-${hex(ctx.rng, 4)}`, `ROUTE ${hex(ctx.rng, 3).toUpperCase()}`)
    this.init()
  }

  get objectiveText(): string {
    return `CLICK the pulsing node to route onward (${this.reached}/${this.hops.length} hops)`
  }

  protected buildBody(): void {
    const hopCount = 4 + Math.round(this.intensity * 3)

    const hint = document.createElement('div')
    hint.className = 'panel__hint'
    hint.textContent = 'follow the pulsing node to the target'
    this.root.appendChild(hint)

    const chain = document.createElement('div')
    chain.className = 'node-chain'

    for (let i = 0; i < hopCount; i++) {
      const node = document.createElement('button')
      node.className = 'node'
      node.textContent = shuffle(this.rng, ['◆', '◇', '▣', '▢', '◈'])[0] ?? '◆'
      node.title = `hop ${i + 1}`
      node.dataset.hop = String(i)
      node.addEventListener('click', () => this.hop(i))
      this.hops.push(node)
      chain.appendChild(node)

      if (i < hopCount - 1) {
        const edge = document.createElement('span')
        edge.className = 'node-edge'
        chain.appendChild(edge)
      }
    }
    this.root.appendChild(chain)
    this.markNext()
    this.updateTitle()
  }

  override onKeyBurst(): boolean {
    // Guard that a hop is actually available before claiming the
    // keystroke -- reporting a no-op as consumed makes this panel a sink
    // that silently eats input.
    if (this.isDone || this.reached >= this.hops.length) return false
    this.hop(this.reached)
    return true
  }

  private hop(idx: number): void {
    if (this.isDone) return
    const node = this.hops[idx]
    if (!node) return

    // Only the next hop in sequence advances -- anything else just shudders.
    if (idx !== this.reached) {
      node.classList.add('is-reject')
      setTimeout(() => node.classList.remove('is-reject'), 240)
      return
    }

    node.classList.add('is-routed')
    // Light the edge leading into this node so the path visibly draws.
    const edge = node.previousElementSibling
    if (edge?.classList.contains('node-edge')) edge.classList.add('is-routed')

    this.reached += 1
    this.floatText(`HOP ${this.reached}`)
    this.addProgress(1 / this.hops.length)
    this.markNext()
    this.updateTitle()
  }

  private markNext(): void {
    for (const n of this.hops) n.classList.remove('is-next')
    this.hops[this.reached]?.classList.add('is-next')
  }

  private updateTitle(): void {
    this.setTitleSuffix(`${this.reached}/${this.hops.length} HOPS`)
  }
}
