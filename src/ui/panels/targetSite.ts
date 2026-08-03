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
  // Inline <style> blocks go after the external links, matching the order
  // they'd have on the real page (critical CSS normally wins over the
  // stylesheet it precedes only via specificity, not order, so this is the
  // safe placement).
  const inline = recon.inlineStyles.map((css) => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`).join('\n')
  const base = recon.pageUrl ? `<base href="${escapeHtml(recon.pageUrl)}">` : ''
  return `<!doctype html><html><head><meta charset="utf-8">${base}${links}${inline}</head><body>${recon.snapshotHtml ?? ''}</body></html>`
}

export class TargetSitePanel {
  readonly win: Win
  private wrapper: HTMLElement
  private iframe: HTMLIFrameElement
  private currentClass = 'corrupt-0'
  /** Whether verifyLiveRender has already escalated to the force-visible pass for the current document. */
  private forcedVisible = false

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
      inlineStyles: [],
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
    if (useLive) this.verifyLiveRender(recon)
  }

  /**
   * Trust nothing about the live render -- measure it.
   *
   * Having HTML is not the same as rendering something a human can see. The
   * common real-world case: a site's CSS hides its content by default
   * (`opacity:0` / `visibility:hidden` / `display:none` on a wrapper) and a
   * script adds a class to reveal it after hydration. Scripts are blocked
   * here by design, so that reveal never happens and the window goes
   * completely blank -- markup present, nothing visible. That is exactly the
   * "showed something for a moment, then went blank" failure.
   *
   * Rather than enumerate every way a third-party page can fail to paint,
   * this checks the only thing that actually matters (is there visible text
   * with real layout?) and escalates:
   *   1. as-is -- most sites are fine, don't touch them
   *   2. force-visible pass -- defeat the hidden-until-JS patterns
   *   3. wireframe -- guaranteed non-blank floor
   */
  private verifyLiveRender(recon: ReconResult): void {
    const started = Date.now()
    const check = (): void => {
      const doc = this.iframe.contentDocument
      // srcdoc + allow-same-origin keeps this readable from the parent; if
      // that ever stops holding, fail safe to the wireframe rather than
      // leaving a possibly-blank frame up.
      if (!doc || !doc.body) {
        if (Date.now() - started < 2500) {
          setTimeout(check, 150)
          return
        }
        this.iframe.srcdoc = buildWireframeDoc(recon)
        return
      }

      if (this.hasVisibleContent(doc)) return

      // Give late-loading external stylesheets a chance before judging it
      // blank -- an unstyled-but-present page is a pass, not a failure.
      if (Date.now() - started < 1200) {
        setTimeout(check, 150)
        return
      }

      if (!this.forcedVisible) {
        this.forcedVisible = true
        this.forceVisible(doc)
        setTimeout(check, 200)
        return
      }

      this.iframe.srcdoc = buildWireframeDoc(recon)
    }
    this.forcedVisible = false
    setTimeout(check, 120)
  }

  private hasVisibleContent(doc: Document): boolean {
    const text = (doc.body.innerText ?? '').replace(/\s+/g, ' ').trim()
    return text.length >= 40 && doc.body.scrollHeight > 20
  }

  /**
   * Strip the hidden-until-JS styling that would otherwise leave the frame
   * blank. Deliberately only runs when the page already measured as blank,
   * so sites that render correctly are never touched by it (a blanket
   * override would wreck their layout and pop open every hidden menu and
   * modal). Inline `!important` outranks any author stylesheet rule,
   * including the site's own `!important`.
   */
  private forceVisible(doc: Document): void {
    const view = doc.defaultView
    if (!view) return
    const nodes = Array.from(doc.body.querySelectorAll<HTMLElement>('*')).slice(0, 4000)
    for (const el of [doc.body, ...nodes]) {
      let cs: CSSStyleDeclaration
      try {
        cs = view.getComputedStyle(el)
      } catch {
        continue
      }
      if (cs.display === 'none') el.style.setProperty('display', 'revert', 'important')
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') {
        el.style.setProperty('visibility', 'visible', 'important')
      }
      if (Number.parseFloat(cs.opacity) < 0.1) el.style.setProperty('opacity', '1', 'important')
      // Reveal animations usually park content far off-screen until a class lands.
      if (cs.transform && cs.transform !== 'none') el.style.setProperty('transform', 'none', 'important')
      if (cs.clipPath && cs.clipPath !== 'none') el.style.setProperty('clip-path', 'none', 'important')
    }
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
