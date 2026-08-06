import type { LayerId } from '@/core/state'
import { LAYER_ORDER } from '@/core/state'
import type { PlayMode } from '@/core/events'

/**
 * How full the board is allowed to get, and what has to happen before it
 * fills again.
 *
 * Windows used to be released on a WALL CLOCK -- ProcessSpawnDirector
 * fired every 2-11 seconds regardless of how many were already open, and
 * placement jittered a fixed slot with no memory of what was on screen. So
 * the board filled faster than a person could clear it, without bound:
 * "the amount of windows opening up is too much. everything is just on top
 * of everything else." Round 10 halved the rates and added an avoid-rect,
 * which reduced the slope but kept the model, so it came back.
 *
 * The model here is a gate, not a rate:
 *
 *   capacity          how many may be alive at once
 *   clearsToRelease   once full, how far it must drop before spawning resumes
 *
 * The second number is why this is hysteresis rather than one-in-one-out.
 * A pure cap would sit permanently saturated -- every close immediately
 * backfilled -- which looks exactly as crowded as no cap at all. Latching
 * shut until several windows have gone guarantees a real trough after
 * every peak.
 *
 * Both numbers rise with depth AND with difficulty, which is what was
 * asked for on both counts: deeper is a busier board *and* more work
 * between breathers.
 */

/**
 * Slots, not windows -- a 1x2 vault-pull panel costs two.
 *
 * These were 3-6 and it starved the board of everything that is not a
 * task panel. Measured over a full 170-second run: 43 panels spawned and
 * SIX ambient windows total, of which one document and one camera. The
 * player's report was exact -- "i never saw any images files and the
 * videos only ever showed up at the very end" -- because the only
 * cameras that reliably fire are the finale's three staggered ones.
 */
const CAPACITY_BY_LAYER: Record<LayerId, number> = {
  surface: 5,
  perimeter: 6,
  intranet: 6,
  core: 7,
  kernel: 7,
  physical: 8,
}

/**
 * Slots kept for ambient popups, so task panels cannot eat the board.
 *
 * This reserve existed before but was defeated by its own floor: the
 * Director asked for `max(3, capacity - 2)`, and with capacity at 4 the
 * floor won and panels took 3 of 4 slots. Add a 1x2 vault panel and
 * panels alone exceeded capacity, so canSpawn refused every ambient draw
 * for the rest of the run.
 */
export const AMBIENT_RESERVE = 2

/**
 * How many ambient popups may be alive at once, by depth.
 *
 * Deliberately its own number rather than "whatever is left over". The
 * media -- camera clips and recovered documents -- is authored content
 * somebody made on purpose, and leftovers meant a whole 170-second run
 * produced one of each. Popups live 7-15 seconds, so three to five
 * concurrent is what it takes to actually see them.
 */
const AMBIENT_CAPACITY: Record<LayerId, number> = {
  surface: 3,
  perimeter: 4,
  intranet: 4,
  core: 4,
  kernel: 5,
  physical: 5,
}

const CAPACITY_BY_MODE: Record<PlayMode, number> = {
  casual: 0,
  leet: 1,
  irl: 2,
}

/**
 * Slots kept free for fixtures.
 *
 * Four, not two: the TARGET dossier is 480px wide and eats TWO columns on
 * its own, and a counter-intrusion wave adds up to five more windows that
 * bypass the budget entirely. Reserving two left the board needing 13
 * slots in a 12-slot grid -- a guaranteed overlap that no amount of
 * collision checking can avoid, because the windows genuinely did not fit.
 */
const FIXTURE_RESERVE = 4

const RELEASE_BY_MODE: Record<PlayMode, number> = {
  casual: 0,
  leet: 0,
  irl: 1,
}

export class BoardBudget {
  /** True once capacity was hit; stays true until enough windows have gone. */
  private latched = false
  /** How many have closed since the gate latched shut. */
  private clearedSinceLatch = 0
  /** Ambient popups turned away while shut -- surfaced so the lull reads as deliberate. */
  private suppressed = 0

  constructor(
    private getLayer: () => LayerId,
    private getMode: () => PlayMode,
    /**
     * How many non-overlapping slots the board actually has. The budget
     * clamps to it, minus a reserve for fixtures (the TARGET dossier,
     * threat windows), so the placement search can always find somewhere
     * free. Without this the cap was a number unrelated to the geometry
     * and windows simply had nowhere to go.
     */
    private getSlots: () => number = () => Infinity,
  ) {}

  get capacity(): number {
    const wanted = CAPACITY_BY_LAYER[this.getLayer()] + CAPACITY_BY_MODE[this.getMode()]
    const room = this.getSlots() - FIXTURE_RESERVE
    return Math.max(3, Math.min(wanted, room))
  }

  /**
   * How many slots task panels may use. The remainder is the ambient
   * reserve, and it is a real remainder: the cap can never rise high
   * enough to leave ambient with nothing.
   */
  get panelAllowance(): number {
    const cap = this.capacity
    return Math.max(2, Math.min(cap - AMBIENT_RESERVE, cap - 1))
  }

  get clearsToRelease(): number {
    const depth = LAYER_ORDER.indexOf(this.getLayer())
    return 1 + Math.floor(depth / 2) + RELEASE_BY_MODE[this.getMode()]
  }

  get suppressedCount(): number {
    return this.suppressed
  }

  get isLatched(): boolean {
    return this.latched
  }

  get ambientCapacity(): number {
    return AMBIENT_CAPACITY[this.getLayer()]
  }

  /**
   * May one more ambient window open right now?
   *
   * @param live how many AMBIENT windows are currently on the board
   */
  canSpawn(live: number): boolean {
    if (live >= this.ambientCapacity) {
      // Hitting the ceiling latches the gate shut. Note this runs on the
      // *request*, not on the close, so a board that is already over
      // capacity (a burst of priority windows, say) latches on the next
      // attempt rather than needing a separate trigger.
      if (!this.latched) {
        this.latched = true
        this.clearedSinceLatch = 0
      }
      this.suppressed += 1
      return false
    }
    if (this.latched) {
      if (this.clearedSinceLatch < this.clearsToRelease) {
        this.suppressed += 1
        return false
      }
      this.latched = false
      this.clearedSinceLatch = 0
    }
    return true
  }

  /** A budgeted window closed. */
  noteClosed(): void {
    if (this.latched) this.clearedSinceLatch += 1
  }

  /** The taskbar has shown the backlog; stop counting it. */
  clearSuppressed(): void {
    this.suppressed = 0
  }

  /** Board wiped (breakthrough, lockout, manhunt) -- start clean. */
  reset(): void {
    this.latched = false
    this.clearedSinceLatch = 0
    this.suppressed = 0
  }
}
