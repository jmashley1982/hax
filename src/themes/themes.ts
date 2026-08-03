import { store } from '@/core/store'
import type { ThemeId } from '@/core/events'
import { loadState, saveState, type GameState } from '@/core/state'
import type { LayerPalette } from '@/sim/layers'

/**
 * Every theme's visuals live entirely in CSS custom properties (see
 * styles/base.css). Switching themes is one attribute write — no
 * re-render, no JS-side style computation. Phase 1 ships `phosphor` only;
 * Phase 8 adds `amber` / `neon` / `agency` blocks to base.css and lists
 * them here — this file does not change shape when that happens.
 */
export const AVAILABLE_THEMES: readonly ThemeId[] = ['phosphor']

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme
  store.emit('theme:change', { theme })
}

export function initTheme(state: GameState): void {
  applyTheme(state.theme)
}

export function cycleTheme(state: GameState): void {
  const idx = AVAILABLE_THEMES.indexOf(state.theme)
  const next = AVAILABLE_THEMES[(idx + 1) % AVAILABLE_THEMES.length] ?? 'phosphor'
  state.theme = next
  applyTheme(next)
  saveState(state)
}

/**
 * Repaint the whole UI for a depth layer.
 *
 * Everything in the app reads its colors from these custom properties, so
 * swapping them here changes panels, HUD, terminal, objective bar and CRT
 * glow all at once. This is what makes each layer a visibly different
 * place instead of six identically-green stretches.
 */
export function applyLayerPalette(palette: LayerPalette): void {
  const root = document.documentElement
  root.style.setProperty('--fg', palette.fg)
  root.style.setProperty('--fg-dim', palette.fgDim)
  root.style.setProperty('--fg-bright', palette.fgBright)
  root.style.setProperty('--accent', palette.fg)
  root.style.setProperty('--accent-2', palette.accent2)
  root.style.setProperty('--ok', palette.fg)
  root.style.setProperty('--glow', palette.glow)
  root.style.setProperty('--bg-deep', palette.bgDeep)
  root.style.setProperty('--bg', palette.bgDeep)
  root.style.setProperty('--panel', palette.panel)
  root.style.setProperty('--panel-edge', palette.panelEdge)
}

/** Pull a previously-saved theme choice, if any, ahead of full save/load (Phase 10). */
export function restoreThemeIfSaved(state: GameState): void {
  const saved = loadState()
  if (saved?.theme) {
    state.theme = saved.theme
    applyTheme(state.theme)
  }
}
