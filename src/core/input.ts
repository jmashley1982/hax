/**
 * Normalizes raw DOM input (keydown, click, submitted command lines) into a
 * single InputEvent stream, and rate-limits it with a token bucket so
 * holding a key down doesn't linearly fast-forward the game.
 *
 * This module does not attach its own DOM listeners — ui/shell.ts and
 * ui/prompt.ts feed events in via `push()`. That keeps this file testable
 * without a DOM and keeps "what counts as input" in one place instead of
 * scattered across UI code.
 */

export type InputKind = 'key' | 'click' | 'submit'

export interface InputEvent {
  kind: InputKind
  /** For 'key': the key code/char. For 'submit': the full command line. */
  token: string
}

export interface EvaluatedInput {
  event: InputEvent
  /** 0..~1.6 multiplier: rewards varied input, punishes holding one key. */
  variety: number
  /** Whether the token bucket had capacity -- if not, this input is "free" (echoes/fx still fine) but contributes no progress. */
  effective: boolean
}

const BUCKET_CAPACITY = 12
const BUCKET_REFILL_PER_SEC = 6
const VARIETY_WINDOW = 24

export class InputPipeline {
  private tokens = BUCKET_CAPACITY
  private recentKeys: string[] = []

  /** Call every tick with elapsed ms to refill the bucket. */
  refill(dtMs: number): void {
    this.tokens = Math.min(BUCKET_CAPACITY, this.tokens + (BUCKET_REFILL_PER_SEC * dtMs) / 1000)
  }

  push(event: InputEvent): EvaluatedInput {
    // Only raw keystrokes are bucket-limited -- clicks are naturally paced
    // by human click speed, and submitted commands are deliberate one-shot
    // actions that should never be silently dropped by a mash bucket.
    const effective = event.kind !== 'key' || this.tokens >= 1
    if (event.kind === 'key' && effective) this.tokens -= 1

    let variety = 1
    if (event.kind === 'key') {
      this.recentKeys.push(event.token)
      if (this.recentKeys.length > VARIETY_WINDOW) this.recentKeys.shift()
      const unique = new Set(this.recentKeys).size
      // Holding one key -> unique/window near 1/24 -> low multiplier.
      // Playing many different keys -> multiplier climbs toward 1.6.
      variety = clamp(0.4 + (unique / VARIETY_WINDOW) * 1.6, 0.4, 1.6)
    }

    return { event, variety, effective }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
