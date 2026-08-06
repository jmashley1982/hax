import type { WindowManager } from '@/ui/windows/manager'
import type { Win } from '@/ui/windows/window'
import type { LayerId } from '@/core/state'
import type { Contract } from '@/sim/contracts'
import { buildFakeSiteDoc } from '@/media/fakeSite'
import { buildEntityMapDoc, usesEntityMap } from '@/media/entityMap'

/**
 * The TARGET window: what the outside world can see of the org you are
 * breaking into, rendered as one draggable window among the others.
 *
 * It used to render a grey wireframe stamped "LIVE RENDER UNAVAILABLE --
 * SYNTHESIZED FROM SITE METADATA". That badge was a leftover from the
 * abandoned fetch-a-real-site path: the fetch is gone, so it announced a
 * failure that could no longer happen, over a skeleton of empty boxes.
 * Now it renders one of two things, chosen by how hard the target is:
 *
 *   tier 1-3  a convincing fake screenshot of their corporate homepage
 *   tier 4-5  a live entity graph -- these are ministries and defence
 *             integrators, and they do not have a homepage worth taking
 *
 * Security posture is unchanged and non-negotiable: the iframe is
 * sandboxed with `allow-scripts` deliberately OMITTED, so nothing inside
 * it ever executes. That is also why the entity graph animates with SMIL
 * rather than JS.
 */

const CORRUPTION_CLASS: Record<LayerId, string> = {
  surface: 'corrupt-0',
  perimeter: 'corrupt-1',
  intranet: 'corrupt-2',
  core: 'corrupt-3',
  kernel: 'corrupt-4',
  physical: 'corrupt-5',
}

export class TargetSitePanel {
  readonly win: Win
  private wrapper: HTMLElement
  private iframe: HTMLIFrameElement
  private currentClass = 'corrupt-0'

  constructor(manager: WindowManager) {
    this.win = manager.spawn(
      { title: 'TARGET :: CONNECTING...', modal: false, closable: false, decor: 'normal', pinned: true, fixture: true },
      'cascade',
    )
    this.win.el.classList.add('target-site')

    const body = document.createElement('div')
    body.className = `target-site__body ${this.currentClass}`
    this.wrapper = body

    this.iframe = document.createElement('iframe')
    this.iframe.className = 'target-site__frame'
    // No allow-scripts, ever -- see file header.
    this.iframe.setAttribute('sandbox', 'allow-same-origin')
    this.iframe.srcdoc =
      '<!doctype html><html><body style="margin:0;background:#05070a"></body></html>'
    body.appendChild(this.iframe)
    this.win.setBody(body)
  }

  /** Paint the window for a contract. Called once the run begins, and again after an ejection resets the board. */
  update(contract: Contract): void {
    const graph = usesEntityMap(contract)
    this.win.setTitle(
      graph
        ? `TARGET :: ${contract.facts.org.toUpperCase()} -- ENTITY GRAPH`
        : `TARGET :: ${contract.facts.domain}`,
    )
    this.wrapper.classList.toggle('target-site--graph', graph)
    this.iframe.srcdoc = graph ? buildEntityMapDoc(contract) : buildFakeSiteDoc(contract)
  }

  /** Corruption scales with depth -- clean at SURFACE, full tearing/defaced by PHYSICAL. This is the "we're inside their site" payoff (plan §15B). */
  setDepth(layer: LayerId): void {
    const next = CORRUPTION_CLASS[layer]
    this.wrapper.classList.remove(this.currentClass)
    this.wrapper.classList.add(next)
    this.currentClass = next
  }

  showDefaced(orgName: string): void {
    this.wrapper.classList.add('is-defaced')
    this.win.setTitle(`TARGET :: ${orgName} -- DEFACED`)
  }

  /**
   * A briefer, self-clearing version of showDefaced() for a lost
   * counter-intrusion wave (shell.ts's handleEjection) -- the connection
   * drops and the run falls back to SURFACE on the SAME target, so unlike
   * the finale's permanent defacement this must reset itself once the
   * board recovers (shell.ts calls update()/setDepth() again right after).
   */
  flashDisconnected(): void {
    this.wrapper.classList.add('is-disconnected')
    setTimeout(() => this.wrapper.classList.remove('is-disconnected'), 2200)
  }

  close(): void {
    this.win.close()
  }
}
