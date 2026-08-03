import { store } from '@/core/store'
import type { GameState } from '@/core/state'

/**
 * Top-right HUD: layer, heat meter, score. Objectives panel lands in
 * Phase 5 once missions exist to populate it -- this file's shape doesn't
 * change when that happens, it just gains a row.
 */
export class Hud {
  private el: HTMLElement
  private layerValue: HTMLElement
  private heatFill: HTMLElement
  private heatValue: HTMLElement
  private scoreValue: HTMLElement

  constructor(mountPoint: HTMLElement, private state: GameState) {
    this.el = document.createElement('div')
    this.el.className = 'hud'

    const scoreRow = document.createElement('div')
    scoreRow.className = 'hud__row hud__score'
    this.scoreValue = document.createElement('span')
    scoreRow.appendChild(this.scoreValue)

    const layerRow = document.createElement('div')
    layerRow.className = 'hud__row'
    const layerLabel = document.createElement('span')
    layerLabel.className = 'hud__label'
    layerLabel.textContent = 'LAYER'
    this.layerValue = document.createElement('span')
    this.layerValue.className = 'hud__value'
    layerRow.append(layerLabel, this.layerValue)

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

    this.el.append(scoreRow, layerRow, heatRow)
    mountPoint.appendChild(this.el)

    this.render()
    store.on('tick', () => this.render())
  }

  private render(): void {
    this.scoreValue.textContent = String(Math.floor(this.state.score)).padStart(5, '0')
    this.layerValue.textContent = this.state.layer.toUpperCase()
    const heat = Math.round(this.state.heat)
    this.heatValue.textContent = `${heat}%`
    this.heatFill.style.width = `${heat}%`
    this.heatFill.classList.toggle('is-warn', heat >= 55 && heat < 88)
    this.heatFill.classList.toggle('is-critical', heat >= 88)
  }
}
