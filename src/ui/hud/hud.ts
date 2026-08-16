import { store } from '@/core/store'
import { LAYER_ORDER, type GameState } from '@/core/state'
import type { Token, TokenPouch } from '@/sim/tokens'

/**
 * Top-right HUD: score, layer, breach progress, heat. The breach bar is
 * the direct answer to "what am I supposed to be judging" from the first
 * playtest (plan §13a) -- it's the one number that visibly climbs from
 * what you do and pays off in a breakthrough.
 */
export class Hud {
  private off: (() => void) | null = null
  private integrityFill!: HTMLElement
  private integrityValue!: HTMLElement
  private el: HTMLElement
  private layerValue: HTMLElement
  private breachFill: HTMLElement
  private heatFill: HTMLElement
  private heatValue: HTMLElement
  private traceFill!: HTMLElement
  private traceValue!: HTMLElement
  private scoreValue: HTMLElement
  private ladderEl!: HTMLElement
  private tokensEl!: HTMLElement
  private comboEl!: HTMLElement
  /** Last combo count actually painted, so render() can tell a NEW clear from the same one redrawn every tick. */
  private lastCombo = 0

  constructor(
    mountPoint: HTMLElement,
    private state: GameState,
    private getTension: () => number,
    /** Earned skeleton keys / trojan bypasses. Clicking a chip spends it. */
    private pouch?: TokenPouch,
    private onSpendToken?: (token: Token) => void,
    private getSystemKind?: () => string,
    /** Consecutive clean panel clears (shell.ts's comboCount) -- optional, same rule as the other soft-coupled getters here. */
    private getCombo?: () => number,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'hud'

    const scoreRow = document.createElement('div')
    scoreRow.className = 'hud__row hud__score'
    this.scoreValue = document.createElement('span')
    scoreRow.appendChild(this.scoreValue)

    // The layer ladder: all six depths, so progression is visible at a
    // glance instead of being a single word that changes.
    const ladder = document.createElement('div')
    ladder.className = 'hud__ladder'
    for (const id of LAYER_ORDER) {
      const step = document.createElement('span')
      step.className = 'hud__ladder-step'
      step.dataset.layer = id
      step.textContent = id.toUpperCase()
      ladder.appendChild(step)
    }
    this.ladderEl = ladder

    const layerRow = document.createElement('div')
    layerRow.className = 'hud__row'
    const layerLabel = document.createElement('span')
    layerLabel.className = 'hud__label'
    layerLabel.textContent = 'LAYER'
    this.layerValue = document.createElement('span')
    this.layerValue.className = 'hud__value'
    layerRow.append(layerLabel, this.layerValue)

    const breachRow = document.createElement('div')
    breachRow.className = 'hud__row'
    const breachLabel = document.createElement('span')
    breachLabel.className = 'hud__label'
    breachLabel.textContent = 'BREACH'
    const breachBar = document.createElement('div')
    breachBar.className = 'hud__heatbar hud__heatbar--breach'
    this.breachFill = document.createElement('div')
    this.breachFill.className = 'hud__heatbar-fill hud__heatbar-fill--breach'
    breachBar.appendChild(this.breachFill)
    breachRow.append(breachLabel, breachBar)

    const heatRow = document.createElement('div')
    heatRow.className = 'hud__row'
    const heatLabel = document.createElement('span')
    heatLabel.className = 'hud__label'
    heatLabel.textContent = 'HEAT'
    const heatBar = document.createElement('div')
    heatBar.className = 'hud__heatbar'
    this.heatFill = document.createElement('div')
    this.heatFill.className = 'hud__heatbar-fill'
    heatBar.appendChild(this.heatFill)
    this.heatValue = document.createElement('span')
    this.heatValue.className = 'hud__value'
    heatRow.append(heatLabel, heatBar, this.heatValue)

    // INTEGRITY is the player's own machine, so it reads opposite to HEAT:
    // full is good, empty ends the run. Given its own row and colour so the
    // two meters are never confused at a glance.
    const intRow = document.createElement('div')
    intRow.className = 'hud__row'
    const intLabel = document.createElement('span')
    intLabel.className = 'hud__label'
    intLabel.textContent = 'INTEG'
    const intBar = document.createElement('div')
    intBar.className = 'hud__heatbar'
    this.integrityFill = document.createElement('div')
    this.integrityFill.className = 'hud__heatbar-fill hud__heatbar-fill--integrity'
    intBar.appendChild(this.integrityFill)
    this.integrityValue = document.createElement('span')
    this.integrityValue.className = 'hud__value'
    intRow.append(intLabel, intBar, this.integrityValue)

    // TRACE: the run-level pursuit meter (sim/trace.ts). It never falls on
    // its own the way heat and integrity do, so it gets its own row rather
    // than sharing one -- a bar that only ever climbs reads very
    // differently from one that breathes.
    const traceRow = document.createElement('div')
    traceRow.className = 'hud__row'
    const traceLabel = document.createElement('span')
    traceLabel.className = 'hud__label'
    traceLabel.textContent = 'TRACE'
    const traceBar = document.createElement('div')
    traceBar.className = 'hud__heatbar'
    this.traceFill = document.createElement('div')
    this.traceFill.className = 'hud__heatbar-fill hud__heatbar-fill--trace'
    traceBar.appendChild(this.traceFill)
    this.traceValue = document.createElement('span')
    this.traceValue.className = 'hud__value'
    traceRow.append(traceLabel, traceBar, this.traceValue)

    // The streak chip. Lives beside the score, since it is score's
    // multiplier made visible -- not with the pressure meters below, which
    // are about danger rather than reward.
    this.comboEl = document.createElement('span')
    this.comboEl.className = 'hud__combo'
    scoreRow.appendChild(this.comboEl)

    // Earned tokens sit directly under the meters: they are spent in
    // response to what those meters are doing, so they belong next to them.
    this.tokensEl = document.createElement('div')
    this.tokensEl.className = 'tokens'

    this.el.append(scoreRow, this.ladderEl, layerRow, breachRow, heatRow, intRow, traceRow)
    // The rack is a SIBLING of the HUD, not a child.
    //
    // Inside the HUD it anchored to the HUD's own box, which sits wherever
    // the top bar's flex layout leaves it -- measured at x=451 in a 1500px
    // window, i.e. hanging down the middle of the screen over the TARGET
    // dossier. As a sibling it anchors to the top bar itself, so "to the
    // side" means the actual side.
    mountPoint.appendChild(this.tokensEl)
    mountPoint.appendChild(this.el)

    if (this.pouch) {
      this.pouch.onChange(() => this.renderTokens())
      this.renderTokens()
    }

    this.render()
    this.off = store.on('tick', () => this.render())
  }

  private render(): void {
    const integrity = Math.max(0, Math.round(this.state.integrity))
    this.integrityFill.style.width = `${integrity}%`
    this.integrityValue.textContent = `${integrity}%`
    this.integrityFill.classList.toggle('is-warn', integrity <= 55 && integrity > 25)
    this.integrityFill.classList.toggle('is-critical', integrity <= 25)

    this.scoreValue.textContent = String(Math.floor(this.state.score)).padStart(5, '0')
    // Naming what KIND of system this depth is, not just its index. The
    // layer name alone ("INTRANET") is a label; "INTRANET / CORPORATE LAN"
    // says why the board looks different down here.
    const kind = this.getSystemKind?.()
    this.layerValue.textContent = kind
      ? `${this.state.layer.toUpperCase()} / ${kind.toUpperCase()}`
      : this.state.layer.toUpperCase()

    const breachPct = Math.min(100, Math.round(this.getTension() * 100))
    this.breachFill.style.width = `${breachPct}%`

    const currentIdx = LAYER_ORDER.indexOf(this.state.layer)
    for (const step of Array.from(this.ladderEl.children) as HTMLElement[]) {
      const idx = LAYER_ORDER.indexOf(step.dataset.layer as (typeof LAYER_ORDER)[number])
      step.classList.toggle('is-passed', idx < currentIdx)
      step.classList.toggle('is-current', idx === currentIdx)
    }

    if (this.getCombo) {
      const combo = this.getCombo()
      if (combo === 0) {
        this.comboEl.classList.remove('is-live')
        if (this.lastCombo > 0) {
          // A streak just broke -- one flash, then the chip goes quiet
          // rather than lingering as a "0" that means nothing.
          this.comboEl.classList.remove('is-break')
          void this.comboEl.offsetWidth
          this.comboEl.classList.add('is-break')
        }
      } else {
        const mult = 1 + Math.min(combo, 8) * 0.25
        this.comboEl.textContent = `x${mult.toFixed(2)}`
        this.comboEl.classList.add('is-live')
        this.comboEl.classList.remove('is-break')
        if (combo > this.lastCombo) {
          // Restart the pop on every new clear, including back-to-back ones.
          this.comboEl.classList.remove('is-pop')
          void this.comboEl.offsetWidth
          this.comboEl.classList.add('is-pop')
        }
      }
      this.lastCombo = combo
    }

    const heat = Math.round(this.state.heat)
    this.heatValue.textContent = `${heat}%`
    this.heatFill.style.width = `${heat}%`
    this.heatFill.classList.toggle('is-warn', heat >= 55 && heat < 88)
    this.heatFill.classList.toggle('is-critical', heat >= 88)

    const trace = Math.round(this.state.trace)
    this.traceValue.textContent = `${trace}%`
    this.traceFill.style.width = `${trace}%`
    this.traceFill.classList.toggle('is-warn', trace >= 50 && trace < 90)
    this.traceFill.classList.toggle('is-critical', trace >= 90)
  }

  /**
   * Rebuilt only when the pouch changes, never per frame -- these chips
   * carry an arrival animation, and re-creating them 60 times a second
   * would restart it every frame and leave them permanently flashing.
   */
  private renderTokens(): void {
    if (!this.pouch) return
    this.tokensEl.innerHTML = ''
    for (const token of this.pouch.all) {
      const chip = document.createElement('button')
      chip.className = 'token'
      chip.dataset.kind = token.kind
      chip.title = token.effect
      const label = document.createElement('span')
      label.textContent = token.label
      const code = document.createElement('span')
      code.className = 'token__code'
      code.textContent = token.code
      // Spell out that it is spendable. A reward you cannot work out how
      // to use is worse than no reward.
      const how = document.createElement('span')
      how.className = 'token__how'
      how.textContent = 'CLICK OR TYPE IT'
      chip.append(label, code, how)
      chip.addEventListener('click', () => {
        const taken = this.pouch?.take(token.id)
        if (taken) this.onSpendToken?.(taken)
      })
      this.tokensEl.appendChild(chip)
    }
  }

  destroy(): void {
    this.off?.()
    this.off = null
    this.el.remove()
  }
}
