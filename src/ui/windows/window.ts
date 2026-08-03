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
  private onCloseCallbacks: Array<() => void> = []

  constructor(private opts: WindowOptions) {
    this.el = document.createElement('div')
    this.el.className = `win${opts.decor === 'danger' ? ' win--danger' : ''}`
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

  onClose(fn: () => void): void {
    this.onCloseCallbacks.push(fn)
  }

  focus(z: number): void {
    this.el.style.zIndex = String(z)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.el.classList.add('is-closing')
    setTimeout(() => this.el.remove(), 170)
    for (const fn of this.onCloseCallbacks) fn()
  }

  private bindDrag(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      const startX = e.clientX
      const startY = e.clientY
      const originLeft = this.el.offsetLeft
      const originTop = this.el.offsetTop

      const onMove = (ev: PointerEvent) => {
        this.el.style.left = `${originLeft + (ev.clientX - startX)}px`
        this.el.style.top = `${originTop + (ev.clientY - startY)}px`
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    })
  }
}
