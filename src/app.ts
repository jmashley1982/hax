import { clock } from '@/core/clock'
import { applySavedCareer, saveState, LAYER_ORDER, type GameState } from '@/core/state'
import { applyLayerSkin, clearLayerPalette } from '@/themes/themes'
import { Dashboard } from '@/ui/dashboard/dashboard'
import { Shell, type SessionOutcome } from '@/ui/shell'
import { Debrief } from '@/ui/dashboard/debrief'
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
  private debrief: Debrief | null = null
  private activeContract: Contract | null = null

  constructor(private root: HTMLElement, private state: GameState) {
    applySavedCareer(state)
    this.showDashboard()
  }

  private showDashboard(): void {
    this.teardownSession()
    this.debrief?.destroy()
    this.debrief = null
    // The board is the player's own machine, not a target -- reset the depth
    // skin so the dashboard doesn't inherit the last run's palette.
    this.state.layer = 'surface'
    // The dashboard belongs to the THEME, not to a depth palette -- leaving
    // the inline layer overrides in place is what made the theme toggle
    // look dead.
    clearLayerPalette()
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

    this.activeContract = contract
    this.session = new Shell(this.root, this.state, contract, (outcome) => this.endSession(outcome))
  }

  /**
   * A run always ends on the results screen, never straight back to the
   * board. Both failure paths (burned, aborted) land here too -- an ending
   * with no screen is indistinguishable from a crash, which is exactly how
   * it was being read.
   */
  private endSession(outcome: SessionOutcome): void {
    this.state.contractsRun += 1
    if (LAYER_ORDER.indexOf(outcome.deepestLayer) > LAYER_ORDER.indexOf(this.state.deepestLayer)) {
      this.state.deepestLayer = outcome.deepestLayer
    }

    const contract = this.activeContract
    this.teardownSession()
    clock.stop()

    if (!contract) {
      saveState(this.state)
      this.showDashboard()
      return
    }

    this.debrief = new Debrief(this.root, {
      contract,
      outcome,
      integrityLeft: outcome.integrityLeft,
      elapsedMs: outcome.elapsedMs,
      onContinue: () => {
        this.debrief = null
        saveState(this.state)
        this.showDashboard()
      },
    })
    // The tier multiplier is banked as career score here, so choosing a
    // hard contract visibly pays more than an easy one.
    this.state.score += this.debrief.payout
    saveState(this.state)
  }

  private teardownSession(): void {
    this.session?.destroy()
    this.session = null
  }
}
