import type { Rng } from '@/core/rng'
import type { GameState, LayerId } from '@/core/state'
import { LAYER_ORDER } from '@/core/state'

/**
 * The depth-progression system, pulled forward after the first playtest
 * made clear it was the missing core loop (see plan §13a): input needs to
 * visibly build toward something, or "doing anything gives the same
 * result" is literally true, not just a feeling.
 *
 * Each layer has a progress threshold. `tension` (0..~1.3) is proximity to
 * breakthrough and is the single number that drives the intensity curve
 * (ambient pacing, burst size, how often decision popups fire) -- so
 * "hectic and complex, then simplifying, then busy again" is a direct
 * consequence of this number resetting to 0 on breakthrough and climbing
 * again, not a scripted animation.
 *
 * Thresholds grow with depth and each layer draws from different content
 * banks (see LAYER_DEFS) so a full descent reads as six distinct
 * stretches, not one short loop repeated six times (per the user's
 * "not just the same loop every minute or two" note).
 */
/**
 * Per-layer palette. Written onto :root as CSS custom properties on
 * breakthrough (see themes/applyLayerPalette) -- everything in the app
 * already reads its colors from these variables, so changing depth
 * repaints the whole UI without restyling anything.
 */
export interface LayerPalette {
  fg: string
  fgDim: string
  fgBright: string
  accent2: string
  glow: string
  bgDeep: string
  panel: string
  panelEdge: string
}

/**
 * What a depth *is*, in-fiction. Named in the top bar and on the
 * breakthrough card, and it drives which ambient popups belong there.
 */
export type SystemKind =
  | 'public net'
  | 'edge appliance'
  | 'corporate lan'
  | 'data centre'
  | 'bare metal'
  | 'the building'

/** Every kind of ambient popup. */
export type AmbientKind =
  | 'process'
  | 'doc'
  | 'cam'
  | 'operator'
  | 'ally'
  | 'news'
  | 'geo'
  | 'stream'

/**
 * Canonical iteration order for the weighted picker.
 *
 * NEVER reorder this, and never iterate an ambientMix with
 * Object.entries(): object key order would make the draw depend on the
 * order the layer literals happen to declare their weights, which would
 * silently break `?seed=` reproducibility -- and deterministic replay is
 * the whole premise of the film-prop half of this project.
 */
export const AMBIENT_KINDS: readonly AmbientKind[] = [
  'process',
  'doc',
  'cam',
  'operator',
  'ally',
  'news',
  'geo',
  'stream',
]

export interface LayerDef {
  id: LayerId
  title: string
  threshold: number
  /** Ambient burst sources specific to this layer's texture. */
  burstSources: ReadonlyArray<readonly [string, string]>
  /** Bank/key drawn from for the breakthrough-moment burst. */
  breachBank: readonly [string, string]
  /** Human-readable target name used in generated demand-popup copy. */
  demandFlavor: string
  palette: LayerPalette
  /** Panel type ids first available at this depth -- pools are cumulative. */
  unlocks: readonly string[]
  /** Minimum concurrent panels at this depth, so deep layers start busy. */
  panelFloor: number
  /** Scales panel size/complexity with depth (0..1). */
  sizeBias: number
  /**
   * A rule change that makes this depth *play* differently, not just look
   * different. Recolouring alone made every layer feel the same
   * ("jumping to the next level is like WOW, cool, but then its just the
   * same"), so each layer past the first alters the rules.
   */
  modifier: LayerModifier
  /** One-line description of the modifier, announced on arrival. */
  modifierText: string
  /** What kind of system this depth is. */
  systemKind: SystemKind
  /**
   * Relative weight per ambient popup kind; a missing key means zero.
   *
   * This is what stops every depth reading as "the same but more". The
   * spawner used to choose the kind from one hardcoded rng roll with
   * fixed thresholds -- process 34%, camera 28%, document 16% -- for all
   * six layers, so the only thing that changed with depth was how OFTEN
   * popups arrived, never WHAT arrived.
   */
  /**
   * Note every layer gives `cam` and `doc` a non-zero weight. The mixes
   * are meant to differ in emphasis, not to make a kind unreachable:
   * weighting cameras onto the deep layers only meant a player who never
   * reached KERNEL saw no camera footage at all, and the media is
   * authored content people made on purpose.
   */
  ambientMix: Readonly<Partial<Record<AmbientKind, number>>>
}

export type LayerModifier =
  | 'none'
  /** Panels arrive locked; one click cracks the seal before you can work them. */
  | 'sealed'
  /** Ignored panels slowly lose progress, so you must rotate between them. */
  | 'decay'
  /** Two panels are linked -- solving one advances its twin. */
  | 'linked'
  /** Hostile traces roam; a trace panel is always present. */
  | 'hunted'
  /** All of the above, at full intensity. */
  | 'total'

const LAYER_DEFS: Record<LayerId, LayerDef> = {
  surface: {
    id: 'surface',
    title: 'SURFACE',
    threshold: 150,
    burstSources: [
      ['netops', 'scanLine'],
      ['kernel', 'dmesg'],
    ],
    breachBank: ['flavor', 'ambientSuccess'],
    demandFlavor: 'perimeter gateway',
    palette: {
      fg: '#39ff6a', fgDim: '#1e8f3d', fgBright: '#baffcf', accent2: '#0ff0a0',
      glow: '#39ff6a', bgDeep: '#020302', panel: '#0a120a', panelEdge: '#1c3a1c',
    },
    unlocks: ['ports', 'brute'],
    panelFloor: 3,
    sizeBias: 0,
    modifier: 'none',
    modifierText: 'open network -- no countermeasures',
    systemKind: 'public net',
    ambientMix: { news: 4, geo: 3, cam: 3, doc: 2, process: 2, ally: 2, operator: 1 },
  },
  perimeter: {
    id: 'perimeter',
    title: 'PERIMETER',
    threshold: 190,
    burstSources: [
      ['exploit', 'stage'],
      ['warnings', 'idsAlert'],
    ],
    breachBank: ['exploit', 'shell'],
    demandFlavor: 'firewall cluster',
    palette: {
      fg: '#31e5ff', fgDim: '#1a7f96', fgBright: '#c4f6ff', accent2: '#00b8ff',
      glow: '#31e5ff', bgDeep: '#01070a', panel: '#07141a', panelEdge: '#143f4d',
    },
    unlocks: ['cipher', 'nodePath'],
    panelFloor: 3,
    sizeBias: 0.2,
    modifier: 'sealed',
    modifierText: 'nodes arrive SEALED -- click once to break the seal',
    systemKind: 'edge appliance',
    ambientMix: { process: 5, cam: 4, doc: 3, operator: 3, ally: 2, news: 1, geo: 1 },
  },
  intranet: {
    id: 'intranet',
    title: 'INTRANET',
    threshold: 230,
    burstSources: [
      ['filesystem', 'dirEntry'],
      ['filesystem', 'grepHit'],
    ],
    breachBank: ['crypto', 'decrypt'],
    demandFlavor: 'internal directory service',
    palette: {
      fg: '#ffb339', fgDim: '#94631a', fgBright: '#ffe2b0', accent2: '#ff8c1a',
      glow: '#ffb339', bgDeep: '#0a0602', panel: '#160f05', panelEdge: '#4a3312',
    },
    unlocks: ['fileExfil', 'dragExfil', 'fs3d'],
    panelFloor: 4,
    sizeBias: 0.4,
    modifier: 'decay',
    modifierText: 'idle nodes DECAY -- keep rotating between them',
    systemKind: 'corporate lan',
    ambientMix: { doc: 7, cam: 4, process: 3, geo: 3, news: 2, ally: 2, operator: 2 },
  },
  core: {
    id: 'core',
    title: 'CORE',
    threshold: 270,
    burstSources: [
      ['crypto', 'decrypt'],
      ['crypto', 'keygen'],
    ],
    breachBank: ['exploit', 'privesc'],
    demandFlavor: 'core database cluster',
    palette: {
      fg: '#ff45d9', fgDim: '#932a7d', fgBright: '#ffc9f3', accent2: '#c06bff',
      glow: '#ff45d9', bgDeep: '#08020a', panel: '#150618', panelEdge: '#4a1745',
    },
    unlocks: ['keyRecovery'],
    panelFloor: 4,
    sizeBias: 0.6,
    modifier: 'linked',
    modifierText: 'nodes are LINKED -- cracking one advances its twin',
    systemKind: 'data centre',
    ambientMix: { doc: 6, cam: 5, process: 5, operator: 3, geo: 2, news: 2 },
  },
  kernel: {
    id: 'kernel',
    title: 'KERNEL',
    threshold: 310,
    burstSources: [
      ['exploit', 'privesc'],
      ['kernel', 'dmesg'],
    ],
    breachBank: ['physical', 'scada'],
    demandFlavor: 'hypervisor control plane',
    palette: {
      fg: '#eaf4ff', fgDim: '#7c8794', fgBright: '#ffffff', accent2: '#9fd4ff',
      glow: '#cfe4ff', bgDeep: '#050709', panel: '#0d1116', panelEdge: '#2c3742',
    },
    unlocks: ['traceDefense'],
    panelFloor: 5,
    sizeBias: 0.8,
    modifier: 'hunted',
    modifierText: 'you are HUNTED -- traces incoming, block them',
    systemKind: 'bare metal',
    ambientMix: { process: 6, cam: 5, operator: 4, doc: 3, news: 2, stream: 2 },
  },
  physical: {
    id: 'physical',
    title: 'PHYSICAL',
    // Final layer -- crossing this threshold triggers the finale sequence
    // (shell.handleFinale) instead of a normal breakthrough to a next
    // layer, since there isn't one.
    threshold: 260,
    burstSources: [
      ['physical', 'scada'],
      ['physical', 'camera'],
    ],
    breachBank: ['physical', 'blackout'],
    demandFlavor: 'building control systems',
    palette: {
      fg: '#ff4a3d', fgDim: '#93251d', fgBright: '#ffc7c1', accent2: '#ff8a2b',
      glow: '#ff4a3d', bgDeep: '#0a0202', panel: '#180706', panelEdge: '#511a15',
    },
    unlocks: ['signalAlign'],
    panelFloor: 5,
    sizeBias: 1,
    modifier: 'total',
    modifierText: 'FULL LOCKDOWN -- everything at once',
    systemKind: 'the building',
    ambientMix: { cam: 8, stream: 4, doc: 3, geo: 2, process: 2, operator: 1 },
  },
}

/** Panel types available at a given depth -- cumulative across all shallower layers. */
export function unlockedPanelTypes(layer: LayerId): string[] {
  const out: string[] = []
  for (const id of LAYER_ORDER) {
    out.push(...LAYER_DEFS[id].unlocks)
    if (id === layer) break
  }
  return out
}

/**
 * Draw an ambient popup kind from a layer's mix.
 *
 * Walks the frozen AMBIENT_KINDS array rather than the mix object's own
 * keys, so the sequence of rng draws is identical regardless of the order
 * a layer literal happens to list its weights. See AMBIENT_KINDS.
 */
export function pickAmbientKind(def: LayerDef, rng: Rng): AmbientKind {
  let total = 0
  for (const k of AMBIENT_KINDS) total += def.ambientMix[k] ?? 0
  if (total <= 0) return 'process'
  let roll = rng() * total
  for (const k of AMBIENT_KINDS) {
    roll -= def.ambientMix[k] ?? 0
    if (roll <= 0) return k
  }
  return 'process'
}

export function layerDef(id: LayerId): LayerDef {
  return LAYER_DEFS[id]
}

export class LayerSystem {
  progressInLayer = 0
  private firedFractions = new Set<number>()
  private static readonly DEMAND_FRACTIONS = [0.3, 0.6, 0.9]

  constructor(private state: GameState) {}

  get current(): LayerDef {
    return LAYER_DEFS[this.state.layer]
  }

  /** Proximity to breakthrough, 0..~1.3 (clamped past 1 so a lagging tick doesn't overshoot wildly). */
  get tension(): number {
    return Math.min(1.3, this.progressInLayer / this.current.threshold)
  }

  /** True at the deepest layer -- crossing threshold here means the finale, not a next-layer breakthrough. */
  get isFinalLayer(): boolean {
    return this.state.layer === 'physical'
  }

  /**
   * Returns true if this addition crossed the breakthrough threshold.
   *
   * This used to hard-return false at the final layer, which meant
   * progress silently stopped accumulating the moment you reached
   * PHYSICAL -- the literal mechanism behind "reaching red just means
   * there's no further success." Now physical accumulates like any other
   * layer; the shell checks isFinalLayer to route a crossed threshold to
   * the finale sequence instead of a normal descent.
   */
  addProgress(amount: number): boolean {
    this.progressInLayer += amount
    return this.progressInLayer >= this.current.threshold
  }

  /**
   * Call once after addProgress() to check whether a new demand-popup
   * fraction boundary was just crossed (0.3 / 0.6 / 0.9 of the way to
   * breakthrough) -- this is what ties popup frequency directly to player
   * engagement instead of a wall clock.
   */
  checkDemandTrigger(): boolean {
    const t = this.tension
    for (const frac of LayerSystem.DEMAND_FRACTIONS) {
      if (t >= frac && !this.firedFractions.has(frac)) {
        this.firedFractions.add(frac)
        return true
      }
    }
    return false
  }

  /** Back to surface for a new contract after the finale -- same instance, so Director's reference stays valid. */
  restart(): void {
    this.state.layer = 'surface'
    this.progressInLayer = 0
    this.firedFractions.clear()
  }

  /** Advance to the next layer, resetting progress and the demand-fraction tracker. */
  breakthrough(): LayerDef {
    const idx = LAYER_ORDER.indexOf(this.state.layer)
    const next = LAYER_ORDER[Math.min(idx + 1, LAYER_ORDER.length - 1)] ?? this.state.layer
    this.state.layer = next
    this.progressInLayer = 0
    this.firedFractions.clear()
    return LAYER_DEFS[next]
  }
}
