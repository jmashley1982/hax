/**
 * The single typed event catalog for the whole app.
 *
 * Every cross-system communication goes through the Store's event bus
 * (see store.ts) using one of these event names + payload shapes. Systems
 * (audio, fx, HUD, scheduler...) subscribe without importing each other
 * directly, which keeps phases addable independently.
 *
 * Phase 1 ships a minimal slice (terminal output, mode/theme changes, tick).
 * Later phases extend this map — it is intentionally the seam where new
 * phases plug in.
 */

export type LineTone = 'normal' | 'success' | 'warning' | 'danger' | 'system' | 'dim'

export interface TerminalLine {
  text: string
  tone: LineTone
  /** ms per character for the typewriter effect; 0 = instant */
  speed?: number
}

/**
 * How the game plays, chosen on the dashboard.
 *
 * Two renames deep. First they were *input* modes (CHAOS / INTENT /
 * HYBRID), which described the keyboard rather than the game. Then they
 * were pure difficulty settings (CASUAL / L337 / IRL), which described
 * pressure but left all three playing the same shapeless loop -- "it all
 * feels very random and inconsequential in all modes".
 *
 * Now they are different *games*:
 *   infinite  never ends, no objectives, no gates. The fidget toy.
 *   casual    six levels, each with an objective and blocking gates.
 *   deep      not built yet; shown on the dashboard as COMING SOON.
 *
 * See core/progress.ts for the coefficients and the two flags that decide
 * which of the above a profile actually is.
 */
export type PlayMode = 'infinite' | 'casual' | 'deep'

export type ThemeId = 'phosphor' | 'amber' | 'neon' | 'agency'

export interface EventMap {
  /** Fired every animation frame. dt in ms, already scaled by pace multiplier. */
  tick: { dt: number; dtRaw: number }

  /** Append a line to the terminal backlog. */
  'terminal:line': TerminalLine

  /** Clear the terminal backlog (e.g. on layer transition). */
  'terminal:clear': Record<string, never>

  /** User submitted raw input (any keystroke in CHAOS, or Enter-submit in INTENT). */
  'input:raw': { key: string; kind: 'key' | 'click' | 'submit' | 'paste' }

  /** User submitted a parsed terminal command line. */
  'input:command': { raw: string }

  'mode:change': { mode: PlayMode }
  'theme:change': { theme: ThemeId }

  /** Generic progress advancement, consumed by the scheduler in Phase 3. */
  'progress:add': { amount: number; source: string }

  /** Boot sequence has completed and the shell is interactive. */
  'boot:ready': Record<string, never>
}

export type EventName = keyof EventMap
