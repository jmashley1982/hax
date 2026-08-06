import { inputVerbs } from '@/core/device'

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
  private jobEl: HTMLElement

  constructor(mountPoint: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'objective'

    const label = document.createElement('span')
    label.className = 'objective__label'
    label.textContent = 'OBJECTIVE'

    this.textEl = document.createElement('span')
    this.textEl.className = 'objective__text'

    this.jobEl = document.createElement('span')
    this.jobEl.className = 'objective__job'

    this.el.append(label, this.textEl, this.jobEl)
    mountPoint.appendChild(this.el)
  }

  set(text: string): void {
    // Central rewrite point for every panel's objectiveText -- see
    // core/device.ts's inputVerbs.
    this.textEl.textContent = inputVerbs(text)
  }

  /**
   * The contract's standing goal, shown alongside the moment-to-moment
   * action.
   *
   * These are two different questions -- "what is this whole job for" and
   * "what do I click right now" -- and they need separate slots. Writing the
   * job through `set()` meant the very next `refreshTarget()` overwrote it
   * with a panel hint, so the thing the player is actually there to do was
   * visible for a single frame.
   */
  setJob(text: string): void {
    this.jobEl.textContent = text
  }

  setHidden(hidden: boolean): void {
    this.el.classList.toggle('is-hidden', hidden)
  }
}
