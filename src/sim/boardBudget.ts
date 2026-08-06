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

const CAPACITY_BY_LAYER: Record<LayerId, number> = {
  surface: 4,
  perimeter: 5,
  intranet: 6,
  core: 6,
  kernel: 7,
  physical: 7,
}

const CAPACITY_BY_MODE: Record<PlayMode, number> = {
  casual: 0,
  leet: 1,
  irl: 2,
}

/** Slots kept free for the TARGET dossier and any threat/hostile windows. */
const FIXTURE_RESERVE = 2

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

  /**
   * May one more ambient window open right now?
   *
   * @param live how many budgeted windows are currently on the board
   */
  canSpawn(live: number): boolean {
    if (live >= this.capacity) {
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
