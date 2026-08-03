/**
 * Normalizes raw DOM input into a single InputEvent stream.
 *
 * This module does not attach its own DOM listeners — ui/shell.ts and
 * ui/prompt.ts feed events in via `push()`. That keeps this file testable
 * without a DOM and keeps "what counts as input" in one place instead of
 * scattered across UI code.
 *
 * NOTE: this used to rate-limit keystrokes through a token bucket
 * (capacity 12, refill 6/sec) so that holding a key couldn't fast-forward
 * an invisible progress counter. That made sense when input fed a hidden
 * accumulator. It is actively wrong now that a keystroke drives a *visible
 * panel*: mashing at ~20 keys/sec had roughly 14 of them silently
 * discarded, which is precisely the "my inputs feel like they have zero
 * meaning" failure (plan §13c). Every keystroke now counts. Panels govern
 * their own pacing via progress-per-hit and decay instead, where the
 * player can actually see it happening.
 */

export type InputKind = 'key' | 'click' | 'submit'

export interface InputEvent {
  kind: InputKind
  /** For 'key': the key code/char. For 'submit': the full command line. */
  token: string
}

export interface EvaluatedInput {
  event: InputEvent
  /** 0.4..1.6 multiplier: rewards varied input over holding one key down. */
  variety: number
}

const VARIETY_WINDOW = 24

export class InputPipeline {
  private recentKeys: string[] = []

  push(event: InputEvent): EvaluatedInput {
    let variety = 1
    if (event.kind === 'key') {
      this.recentKeys.push(event.token)
      if (this.recentKeys.length > VARIETY_WINDOW) this.recentKeys.shift()
      const unique = new Set(this.recentKeys).size
      // Holding one key -> unique/window near 1/24 -> low multiplier.
      // Playing many different keys -> multiplier climbs toward 1.6.
      variety = clamp(0.4 + (unique / VARIETY_WINDOW) * 1.6, 0.4, 1.6)
    }
    return { event, variety }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
