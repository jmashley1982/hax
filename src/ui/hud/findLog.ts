import type { LevelRun } from '@/sim/levels'
import type { WindowManager } from '@/ui/windows/manager'
import type { Win } from '@/ui/windows/window'
import { PANEL_LABELS } from '@/ui/panels/registry'

/**
 * FIND LOG -- what this level needs, against what you have.
 *
 * The objective bar is one line and it competes with the targeted panel's
 * hint, a live wave, a manhunt and the field op. That is fine for "what do
 * I click right now" and useless for "what am I collecting and how far
 * along am I", which is a thing the player needs to be able to check at any
 * moment without waiting for the bar to be free.
 *
 * Spawned as a FIXTURE so the board budget cannot evict it: a scoreboard
 * that disappears when the desktop gets busy is worse than no scoreboard,
 * because you only look for it when things are busy.
 */
export class FindLog {
  private win: Win
  private rowsEl: HTMLElement
  private headEl: HTMLElement

  constructor(manager: WindowManager, private run: LevelRun) {
    this.win = manager.spawn(
      {
        title: 'FIND LOG',
        modal: false,
        closable: false,
        pinned: true,
        fixture: true,
      },
      'random',
    )
    this.win.el.classList.add('findlog')

    const body = document.createElement('div')
    body.className = 'findlog__body'

    this.headEl = document.createElement('div')
    this.headEl.className = 'findlog__head'

    this.rowsEl = document.createElement('div')
    this.rowsEl.className = 'findlog__rows'

    body.append(this.headEl, this.rowsEl)
    this.win.setBody(body)
    this.paint()
  }

  paint(): void {
    const { spec } = this.run
    this.headEl.textContent = spec.unit
    this.rowsEl.replaceChildren()

    // One pip per required item. A bar would read as "progress"; discrete
    // pips read as "things", which is what an objective made of countable
    // findings actually is.
    const pips = document.createElement('div')
    pips.className = 'findlog__pips'
    for (let i = 0; i < this.run.target; i++) {
      const pip = document.createElement('span')
      pip.className = `findlog__pip${i < this.run.found ? ' is-found' : ''}`
      pips.appendChild(pip)
    }

    const count = document.createElement('div')
    count.className = 'findlog__count'
    count.textContent = `${this.run.found} / ${this.run.target}`

    this.rowsEl.append(pips, count)

    // Only a two-tool level has anything in hand, and showing an empty
    // "0 in hand" row on a level with no pair would read as a mechanic the
    // player is failing to use. The nouns come from the spec so this reads
    // correctly on all three of them.
    const pair = this.run.spec.pair
    if (pair) {
      const held = document.createElement('div')
      held.className = 'findlog__held'
      const noun = pair.noun.toUpperCase()
      held.textContent =
        this.run.held > 0
          ? `${this.run.held} ${noun}${this.run.held === 1 ? '' : 'S'} IN HAND -- spend on ${label(pair.spends)}`
          : `NO ${noun} -- clear a ${label(pair.banks)}`
      held.classList.toggle('is-ready', this.run.held > 0)
      this.rowsEl.appendChild(held)
    }
  }

  flash(): void {
    this.win.el.classList.remove('is-hit')
    void this.win.el.offsetWidth
    this.win.el.classList.add('is-hit')
  }

  destroy(): void {
    this.win.close()
  }
}

function label(typeId: string): string {
  return PANEL_LABELS[typeId] ?? typeId.toUpperCase()
}
