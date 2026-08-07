import type { PlayMode } from './events'
import type { GameState, LayerId } from './state'


/**
 * The arcade wall.
 *
 * "i also like the idea of a TOP SCORE wall where you can enter 3 initials
 * like on old school arcade games."
 *
 * Stated plainly, because it is a real constraint and not a shortcut: this
 * is a LOCAL table. The app makes zero external requests, ships as one
 * self-contained index.html and must work opened from file://, so there is
 * nowhere for a shared leaderboard to live and there never will be. Which
 * is exactly what a real cabinet was -- the wall belonged to the machine.
 *
 * Kept per mode. INFINITE HACK and CASUAL HACK are different games with
 * different score curves, and one table would mean the endless mode owned
 * every row forever.
 */

export interface ScoreEntry {
  /**
   * Stable per RUN, not per keystroke.
   *
   * The initials entry re-submits on every character typed so a player who
   * closes the tab still gets their row -- without an id that appended a
   * fresh row per letter, and typing "ZX9" left OPE, ZPE, ZXE and ZX9 all
   * sitting on the wall.
   */
  id: string
  initials: string
  score: number
  org: string
  /** Deepest layer reached, for the row's flavour. */
  layer: string
  grade: string
  /** Epoch ms. Display only -- never fed to the RNG. */
  at: number
}

const KEY = 'nullstack:scores:v1'
const PER_MODE = 10

type Table = Partial<Record<PlayMode, ScoreEntry[]>>

function read(): Table {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Table
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    // Corrupt or unavailable storage must never stop a run from ending.
    return {}
  }
}

function write(table: Table): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(table))
  } catch {
    /* private browsing, quota, file:// -- non-fatal */
  }
}

export function topScores(mode: PlayMode): ScoreEntry[] {
  const rows = read()[mode] ?? []
  return [...rows].sort((a, b) => b.score - a.score).slice(0, PER_MODE)
}

/**
 * Would this score make the wall?
 *
 * True while the table is short, so the first run you ever finish always
 * gets to sign it -- an empty leaderboard that refuses your score is a
 * leaderboard nobody ever gets onto.
 */
export function qualifies(mode: PlayMode, score: number): boolean {
  if (score <= 0) return false
  const rows = topScores(mode)
  if (rows.length < PER_MODE) return true
  return score > (rows[rows.length - 1]?.score ?? 0)
}

export function submitScore(mode: PlayMode, entry: ScoreEntry): ScoreEntry[] {
  const table = read()
  const rows = [
    ...(table[mode] ?? []).filter((r) => r.id !== entry.id),
    { ...entry, initials: normalise(entry.initials) },
  ]
  rows.sort((a, b) => b.score - a.score)
  table[mode] = rows.slice(0, PER_MODE)
  write(table)
  return table[mode] ?? []
}

/** Exactly three characters, A-Z and 0-9, like the cabinet. */
export function normalise(initials: string): string {
  const cleaned = initials.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)
  return cleaned.padEnd(3, 'A')
}

/** The handle from the dashboard, as a starting guess for the initials. */
export function initialsFrom(state: GameState): string {
  return normalise(state.handle || 'AAA')
}

export function layerLabel(layer: LayerId | string): string {
  return String(layer).toUpperCase()
}
