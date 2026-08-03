/**
 * The always-visible "what do I do right now" bar.
 *
 * Added because the single most damning playtest note was "i don't even
 * know what to do" (plan §13c). This is never empty while a panel is
 * alive -- it names the current target panel and its concrete next action.
 */
export class ObjectiveBar {
  private el: HTMLElement
  private textEl: HTMLElement

  constructor(mountPoint: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'objective'

    const label = document.createElement('span')
    label.className = 'objective__label'
    label.textContent = 'OBJECTIVE'

    this.textEl = document.createElement('span')
    this.textEl.className = 'objective__text'

    this.el.append(label, this.textEl)
    mountPoint.appendChild(this.el)
  }

  set(text: string): void {
    this.textEl.textContent = text
  }

  setHidden(hidden: boolean): void {
    this.el.classList.toggle('is-hidden', hidden)
  }
}
