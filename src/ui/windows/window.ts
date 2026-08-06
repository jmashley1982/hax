import { isMobileLayout } from '@/core/device'
import { beginInteraction, endInteraction } from '@/core/interaction'

export interface WindowButton {
  label: string
  onClick: () => void
}

export interface WindowOptions {
  title: string
  /** Modal windows dim the background and (via WindowManager) pause ambient progress. */
  modal?: boolean
  closable?: boolean
  decor?: 'normal' | 'danger'
  /**
   * Exempt from the manager's oldest-first eviction. Task panels set this:
   * without it, spawning a 7th window silently closes a panel the player is
   * halfway through solving.
   */
  pinned?: boolean
  /**
   * Warnings, auth prompts, ally codes and threats.
   *
   * A priority window bypasses the board budget (it is never dropped for
   * being over capacity), announces itself, and is auto-targeted so it is
   * actionable the instant it lands -- "i want important windows like
   * warnings or passwords to become prioritized and actionable
   * immediately."
   */
  priority?: boolean
  /**
   * Fixtures are exempt from the board budget: the TARGET dossier, threat
   * panels, hostile windows and the manhunt. Those are the game talking to
   * you, and starving them would be worse than the pile. Everything else
   * -- task panels included -- counts, because the complaint was about how
   * much is on screen in total, not about one category of it.
   */
  fixture?: boolean
  x: number
  y: number
}

/**
 * A single floating window: draggable title bar, optional close button,
 * a body slot, and an optional button row. Deliberately not resizable and
 * has no maximize -- keeps layout predictable, which matters when this is
 * being framed as a film shot (plan §6).
 */
export class Win {
  readonly el: HTMLElement
  private bodyEl: HTMLElement
  private closed = false
  /** True while this window's title bar is being dragged -- eviction must not take it. */
  private dragging = false
  private endDrag: (() => void) | null = null
  private onCloseCallbacks: Array<() => void> = []

  constructor(private opts: WindowOptions) {
    this.el = document.createElement('div')
    this.el.className =
      `win${opts.decor === 'danger' ? ' win--danger' : ''}${opts.priority ? ' win--priority' : ''}`
    this.el.style.left = `${opts.x}px`
    this.el.style.top = `${opts.y}px`

    const titleBar = document.createElement('div')
    titleBar.className = 'win__title'
    const titleText = document.createElement('span')
    titleText.className = 'win__title-text'
    titleText.textContent = opts.title
    titleBar.appendChild(titleText)

    if (opts.closable ?? true) {
      const closeBtn = document.createElement('button')
      closeBtn.className = 'win__close'
      closeBtn.textContent = '✕'
      closeBtn.addEventListener('click', () => this.close())
      titleBar.appendChild(closeBtn)
    }

    this.bindDrag(titleBar)
    this.el.appendChild(titleBar)

    this.bodyEl = document.createElement('div')
    this.bodyEl.className = 'win__body'
    this.el.appendChild(this.bodyEl)
  }

  setBody(node: HTMLElement | string): void {
    this.bodyEl.innerHTML = ''
    if (typeof node === 'string') {
      const p = document.createElement('p')
      p.textContent = node
      this.bodyEl.appendChild(p)
    } else {
      this.bodyEl.appendChild(node)
    }
  }

  addButtonRow(buttons: WindowButton[]): HTMLElement {
    const row = document.createElement('div')
    row.className = 'win__row'
    for (const b of buttons) {
      const btn = document.createElement('button')
      btn.className = 'win__btn'
      btn.textContent = b.label
      btn.addEventListener('click', () => b.onClick())
      row.appendChild(btn)
    }
    this.bodyEl.appendChild(row)
    return row
  }

  /** Returns the body element for callers that need direct DOM access (e.g. minigame hosts, Phase 6). */
  get body(): HTMLElement {
    return this.bodyEl
  }

  get isModal(): boolean {
    return this.opts.modal ?? false
  }

  get isPinned(): boolean {
    return this.opts.pinned ?? false
  }

  get isPriority(): boolean {
    return this.opts.priority ?? false
  }

  get isFixture(): boolean {
    return this.opts.fixture ?? false
  }

  setTitle(text: string): void {
    const el = this.el.querySelector('.win__title-text')
    if (el) el.textContent = text
  }

  onClose(fn: () => void): void {
    this.onCloseCallbacks.push(fn)
  }

  focus(z: number): void {
    this.el.style.zIndex = String(z)
  }

  /** True once closed -- lets async work (media probes, fetches) bail instead of touching a dead window. */
  get isClosed(): boolean {
    return this.closed
  }

  /** True while the player is holding this window's title bar. */
  get isDragging(): boolean {
    return this.dragging
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    // A window destroyed mid-drag would otherwise leave its move listener
    // running against a detached node, with the cursor still "holding" it.
    this.endDrag?.()
    this.el.classList.add('is-closing')
    setTimeout(() => this.el.remove(), 170)
    for (const fn of this.onCloseCallbacks) fn()
  }

  /**
   * Title-bar dragging.
   *
   * The original version bound pointermove/pointerup on `window` and
   * nothing else, which left three ways to end up with a window glued to
   * the cursor forever ("the mouse gets stuck on a window and wont let it
   * go"):
   *   - `pointercancel` fires instead of `pointerup` (the browser takes the
   *     pointer back), so the cleanup never runs;
   *   - the release happens outside the document;
   *   - the window is CLOSED mid-drag -- transient windows are evicted on a
   *     timer, so the element under your cursor can be destroyed while you
   *     are still holding it, and the move listener kept running against a
   *     detached node.
   *
   * Now the pointer is captured, every terminal path is handled, and the
   * drag detaches if the window dies underneath it.
   */
  private bindDrag(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      // In the mobile layout windows are a static scrolling column, so
      // there is nothing to drag -- and letting a title-bar drag through
      // would fight the scroller for the gesture.
      if (isMobileLayout()) return
      const startX = e.clientX
      const startY = e.clientY
      const originLeft = this.el.offsetLeft
      const originTop = this.el.offsetTop

      const onMove = (ev: PointerEvent) => {
        this.el.style.left = `${originLeft + (ev.clientX - startX)}px`
        this.el.style.top = `${originTop + (ev.clientY - startY)}px`
      }
      const endDrag = () => {
        if (!this.dragging) return
        this.dragging = false
        endInteraction()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', endDrag)
        window.removeEventListener('pointercancel', endDrag)
        window.removeEventListener('blur', endDrag)
        handle.removeEventListener('lostpointercapture', endDrag)
        try {
          handle.releasePointerCapture(e.pointerId)
        } catch {
          /* already released or the pointer is gone -- nothing to do */
        }
        // Drop the handle so close() cannot re-run a finished drag's
        // teardown against listeners that are already gone.
        if (this.endDrag === endDrag) this.endDrag = null
      }

      this.dragging = true
      this.endDrag = endDrag
      beginInteraction()
      // Capture keeps move/up coming to us even if the cursor crosses an
      // iframe or leaves the window. Guarded: it throws when the pointer is
      // already gone, and an unguarded throw here would abort the handler
      // before the listeners were attached, arming a drag that can't end.
      try {
        handle.setPointerCapture(e.pointerId)
      } catch {
        /* non-fatal: the drag still works, it just won't track off-window */
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', endDrag)
      window.addEventListener('pointercancel', endDrag)
      window.addEventListener('blur', endDrag)
      handle.addEventListener('lostpointercapture', endDrag)
    })
  }
}
