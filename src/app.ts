import { clock } from '@/core/clock'
import { applySavedCareer, saveState, LAYER_ORDER, type GameState } from '@/core/state'
import { applyLayerPalette, applyLayerSkin } from '@/themes/themes'
import { Dashboard } from '@/ui/dashboard/dashboard'
import { Shell, type SessionOutcome } from '@/ui/shell'
import { layerDef } from '@/sim/layers'
import type { Contract } from '@/sim/contracts'

/**
 * App-level mode machine: dashboard <-> session (plan §16A).
 *
 * The game used to *be* the page -- Shell's constructor started the clock
 * and ran forever. Now a run is a bounded thing you start from the
 * dashboard and that ends with an outcome, so both halves have to tear
 * down cleanly and repeatedly.
 *
 * The tear-down is the whole reason this class exists. Shell subscribes to
 * the global tick and starts the shared clock; without an explicit
 * `destroy()` every finished contract would leave a live subscriber behind,
 * and by the third run one keypress would advance progress three times.
 */
export class App {
  private dashboard: Dashboard | null = null
  private session: Shell | null = null

  constructor(private root: HTMLElement, private state: GameState) {
    applySavedCareer(state)
    this.showDashboard()
  }

  private showDashboard(): void {
    this.teardownSession()
    // The board is the player's own machine, not a target -- reset the depth
    // skin so the dashboard doesn't inherit the last run's palette.
    this.state.layer = 'surface'
    applyLayerPalette(layerDef('surface').palette)
    applyLayerSkin('surface')
    clock.stop()

    this.dashboard = new Dashboard(this.root, this.state, {
      onStart: (contract) => this.startSession(contract),
    })
  }

  private startSession(contract: Contract): void {
    this.dashboard?.destroy()
    this.dashboard = null

    // Per-run state starts clean; career totals persist.
    this.state.layer = 'surface'
    this.state.heat = 0
    this.state.integrity = 100

    this.session = new Shell(this.root, this.state, contract, (outcome) => this.endSession(outcome))
  }

  private endSession(outcome: SessionOutcome): void {
    this.state.contractsRun += 1
    if (LAYER_ORDER.indexOf(outcome.deepestLayer) > LAYER_ORDER.indexOf(this.state.deepestLayer)) {
      this.state.deepestLayer = outcome.deepestLayer
    }
    saveState(this.state)
    this.showDashboard()
  }

  private teardownSession(): void {
    this.session?.destroy()
    this.session = null
  }
}
