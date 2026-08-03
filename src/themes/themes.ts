import { store } from '@/core/store'
import type { ThemeId } from '@/core/events'
import { loadState, saveState, type GameState, type LayerId, LAYER_ORDER } from '@/core/state'
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

// -- Brand-derived palettes (real-site targets, plan §15) ------------------

/**
 * Each layer keeps its own canonical hue and how strongly it blends toward
 * the real site's brand color, so a real target still reads as "green then
 * cyan then amber then magenta then white then red" (the escalation shape
 * that made fictional runs read as six distinct places) while every hue is
 * pulled toward the brand throughout. PHYSICAL blends the least -- the
 * "full lockdown" alarm red stays legible as danger regardless of brand.
 */
const LAYER_HUE_ANCHOR: Record<LayerId, number> = {
  surface: 140,
  perimeter: 189,
  intranet: 40,
  core: 317,
  kernel: 205,
  physical: 6,
}
const LAYER_BRAND_BLEND: Record<LayerId, number> = {
  surface: 0.6,
  perimeter: 0.6,
  intranet: 0.5,
  core: 0.5,
  kernel: 0.3,
  physical: 0.22,
}
const LAYER_SATURATION: Record<LayerId, number> = {
  surface: 60,
  perimeter: 65,
  intranet: 65,
  core: 70,
  kernel: 14,
  physical: 78,
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Shortest-path hue interpolation (140 -> 20 goes through 0/360, not through 180). */
function circularLerp(a: number, b: number, t: number): number {
  const diff = ((((b - a) % 360) + 540) % 360) - 180
  return (a + diff * t + 360) % 360
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)} ${Math.round(clamp(s, 0, 100))}% ${Math.round(clamp(l, 0, 100))}%)`
}

/** Accepts #rrggbb, rgb()/rgba(), or hsl()/hsla() -- covers everything recon.ts can produce or scrape from a real theme-color meta tag. */
function parseColorToHue(input: string): number | null {
  const hex = input.match(/^#([0-9a-fA-F]{6})$/)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return rgbToHue((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  const rgb = input.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgb) return rgbToHue(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]))
  const h = input.match(/hsla?\(\s*(-?\d+(?:\.\d+)?)/)
  if (h) return ((Number(h[1]) % 360) + 360) % 360
  return null
}

function rgbToHue(r: number, g: number, b: number): number {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  if (max === min) return 0
  const d = max - min
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return ((h * 60) + 360) % 360
}

/** Derive all six layer palettes from one real (or pseudo-random) brand color -- fed to applyLayerPalette() exactly like a fictional layer's built-in palette. */
export function brandLayerPalettes(brandColor: string): Record<LayerId, LayerPalette> {
  const brandHue = parseColorToHue(brandColor) ?? 200
  const out = {} as Record<LayerId, LayerPalette>
  for (const layer of LAYER_ORDER) {
    const h = circularLerp(LAYER_HUE_ANCHOR[layer], brandHue, LAYER_BRAND_BLEND[layer])
    const s = LAYER_SATURATION[layer]
    out[layer] = {
      fg: hsl(h, s, 56),
      fgDim: hsl(h, Math.max(15, s - 20), 30),
      fgBright: hsl(h, Math.max(8, s - 35), 88),
      accent2: hsl((h + 28) % 360, s, 56),
      glow: hsl(h, s, 56),
      bgDeep: hsl(h, Math.min(45, s), 3),
      panel: hsl(h, Math.min(40, s), 8),
      panelEdge: hsl(h, Math.min(45, s), 21),
    }
  }
  return out
}

/** Pull a previously-saved theme choice, if any, ahead of full save/load (Phase 10). */
export function restoreThemeIfSaved(state: GameState): void {
  const saved = loadState()
  if (saved?.theme) {
    state.theme = saved.theme
    applyTheme(state.theme)
  }
}
