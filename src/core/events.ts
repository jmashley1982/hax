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

export type InteractionMode = 'chaos' | 'intent' | 'hybrid'

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

  'mode:change': { mode: InteractionMode }
  'theme:change': { theme: ThemeId }

  /** Generic progress advancement, consumed by the scheduler in Phase 3. */
  'progress:add': { amount: number; source: string }

  /** Boot sequence has completed and the shell is interactive. */
  'boot:ready': Record<string, never>
}

export type EventName = keyof EventMap
