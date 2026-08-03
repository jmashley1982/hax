import { store } from '@/core/store'
import { LAYER_ORDER, type GameState } from '@/core/state'

/**
 * Top-right HUD: score, layer, breach progress, heat. The breach bar is
 * the direct answer to "what am I supposed to be judging" from the first
 * playtest (plan §13a) -- it's the one number that visibly climbs from
 * what you do and pays off in a breakthrough.
 */
export class Hud {
  private el: HTMLElement
  private layerValue: HTMLElement
  private breachFill: HTMLElement
  private heatFill: HTMLElement
  private heatValue: HTMLElement
  private scoreValue: HTMLElement
  private ladderEl!: HTMLElement

  constructor(
    mountPoint: HTMLElement,
    private state: GameState,
    private getTension: () => number,
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

    this.el.append(scoreRow, this.ladderEl, layerRow, breachRow, heatRow)
    mountPoint.appendChild(this.el)

    this.render()
    store.on('tick', () => this.render())
  }

  private render(): void {
    this.scoreValue.textContent = String(Math.floor(this.state.score)).padStart(5, '0')
    this.layerValue.textContent = this.state.layer.toUpperCase()

    const breachPct = Math.min(100, Math.round(this.getTension() * 100))
    this.breachFill.style.width = `${breachPct}%`

    const currentIdx = LAYER_ORDER.indexOf(this.state.layer)
    for (const step of Array.from(this.ladderEl.children) as HTMLElement[]) {
      const idx = LAYER_ORDER.indexOf(step.dataset.layer as (typeof LAYER_ORDER)[number])
      step.classList.toggle('is-passed', idx < currentIdx)
      step.classList.toggle('is-current', idx === currentIdx)
    }

    const heat = Math.round(this.state.heat)
    this.heatValue.textContent = `${heat}%`
    this.heatFill.style.width = `${heat}%`
    this.heatFill.classList.toggle('is-warn', heat >= 55 && heat < 88)
    this.heatFill.classList.toggle('is-critical', heat >= 88)
  }
}
