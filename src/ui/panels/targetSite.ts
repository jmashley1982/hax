import type { WindowManager } from '@/ui/windows/manager'
import type { Win } from '@/ui/windows/window'
import type { ReconResult } from '@/sim/recon'
import type { LayerId } from '@/core/state'

/**
 * The TARGET window: the real site itself, rendered as one draggable
 * window among the others (plan §15B's "dedicated TARGET window" choice
 * over full-screen takeover -- keeps every task panel legible at all
 * times).
 *
 * Security posture: `sandbox="allow-same-origin"` with `allow-scripts`
 * deliberately OMITTED -- nothing in the target's real markup ever
 * executes. `allow-same-origin` alone is what lets the real stylesheet
 * and images actually load and render; without it every subresource
 * would be treated as opaque-origin and silently fail. sim/recon.ts's
 * sanitizeSnapshot() already stripped <script>/<iframe>/<object>, all
 * `on*` handlers, and neutered every <a>/<form> before this ever sees the
 * markup -- the sandbox attribute is belt to that sanitization's braces,
 * not the only line of defense.
 */

/** Below this many characters of real body text, the real snapshot would render as a near-blank window (JS-only SPA shells) -- render a synthesized wireframe instead so the TARGET window is never blank. */
const WIREFRAME_THRESHOLD = 300

const CORRUPTION_CLASS: Record<LayerId, string> = {
  surface: 'corrupt-0',
  perimeter: 'corrupt-1',
  intranet: 'corrupt-2',
  core: 'corrupt-3',
  kernel: 'corrupt-4',
  physical: 'corrupt-5',
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildWireframeDoc(recon: ReconResult): string {
  const paths = (recon.facts.paths ?? []).slice(0, 8)
  const fields = (recon.facts.fields ?? []).slice(0, 6)
  const title = recon.title || recon.facts.org
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; font: 12px/1.4 monospace; background: #0b0b0c; color: ${recon.brandColor}; padding: 18px; }
    .wf-badge { font-size: 10px; opacity: .6; letter-spacing: .1em; margin-bottom: 14px; border: 1px solid currentColor; display: inline-block; padding: 3px 6px; }
    .wf-head { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    .wf-favicon { width: 20px; height: 20px; }
    .wf-title { font-size: 18px; font-weight: bold; }
    .wf-nav { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
    .wf-pill { border: 1px solid currentColor; padding: 4px 10px; opacity: .8; }
    .wf-block { height: 64px; border: 1px dashed currentColor; opacity: .35; margin-bottom: 10px; }
    .wf-field { border: 1px solid currentColor; opacity: .6; padding: 6px 8px; margin-bottom: 6px; width: 60%; }
  </style></head><body>
    <div class="wf-badge">LIVE RENDER UNAVAILABLE -- SYNTHESIZED FROM SITE METADATA</div>
    <div class="wf-head">
      <img class="wf-favicon" src="${escapeHtml(recon.faviconUrl)}" onerror="this.style.display='none'">
      <div class="wf-title">${escapeHtml(title)}</div>
    </div>
    ${paths.length ? `<div class="wf-nav">${paths.map((p) => `<div class="wf-pill">${escapeHtml(p)}</div>`).join('')}</div>` : ''}
    <div class="wf-block"></div>
    <div class="wf-block"></div>
    ${fields.map((f) => `<div class="wf-field">${escapeHtml(f)}</div>`).join('')}
  </body></html>`
}

function buildLiveDoc(recon: ReconResult): string {
  const links = recon.stylesheetUrls.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join('\n')
  const base = recon.pageUrl ? `<base href="${escapeHtml(recon.pageUrl)}">` : ''
  return `<!doctype html><html><head><meta charset="utf-8">${base}${links}</head><body>${recon.snapshotHtml ?? ''}</body></html>`
}

export class TargetSitePanel {
  readonly win: Win
  private wrapper: HTMLElement
  private iframe: HTMLIFrameElement
  private currentClass = 'corrupt-0'

  constructor(manager: WindowManager) {
    this.win = manager.spawn(
      { title: 'TARGET :: CONNECTING...', modal: false, closable: false, decor: 'normal', pinned: true },
      'cascade',
    )
    this.win.el.classList.add('target-site')

    const body = document.createElement('div')
    body.className = `target-site__body ${this.currentClass}`
    this.wrapper = body

    this.iframe = document.createElement('iframe')
    this.iframe.className = 'target-site__frame'
    // No allow-scripts, ever -- see file header. This is what makes it
    // safe to inject a real (sanitized) page snapshot at all.
    this.iframe.setAttribute('sandbox', 'allow-same-origin')
    this.iframe.srcdoc = buildWireframeDoc({
      facts: { org: 'CONNECTING', domain: '', subnet: '' },
      live: false,
      brandColor: '#39ff6a',
      faviconUrl: '',
      snapshotTextLength: 0,
      stylesheetUrls: [],
      title: 'ESTABLISHING CONNECTION...',
    })
    body.appendChild(this.iframe)
    this.win.setBody(body)
  }

  /** Called with tier-0 immediately, then again if tier-1 live data lands -- re-renders either way. */
  update(recon: ReconResult): void {
    this.win.setTitle(`TARGET :: ${recon.facts.domain}`)
    const useLive = recon.live && recon.snapshotHtml && recon.snapshotTextLength >= WIREFRAME_THRESHOLD
    this.iframe.srcdoc = useLive ? buildLiveDoc(recon) : buildWireframeDoc(recon)
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

  close(): void {
    this.win.close()
  }
}
