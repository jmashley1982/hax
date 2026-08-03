import { pick, type Rng } from '@/core/rng'
import type { GameState } from '@/core/state'
import type { WindowManager } from '@/ui/windows/manager'
import type { TaskPanel } from '@/ui/panels/panel'
import { LAYER_POOLS, PANEL_TYPES, pickPanelType } from '@/ui/panels/registry'
import type { LayerSystem } from './layers'

/**
 * The spawn director -- what actually drives the screen now.
 *
 * The old design had an ambient-text scheduler emitting lines on a timer
 * regardless of input, which is precisely why the app read as a video
 * (plan §13c). This replaces it: the screen's business is a population of
 * live interactive panels. Clearing panels is the only thing that advances
 * the layer, so what's on screen is always a direct consequence of what
 * the player has and hasn't done.
 *
 * Panel count scales with layer tension ("hectic and complex") and drops
 * back after a breakthrough ("simplifying"), then climbs again at the new
 * depth.
 */
const SPAWN_COOLDOWN_MS = 900

export class Director {
  private panels: TaskPanel[] = []
  private spawnCooldown = 0

  constructor(
    private manager: WindowManager,
    private state: GameState,
    private layers: LayerSystem,
    private rng: Rng,
    private onPanelComplete: (panel: TaskPanel) => void,
    private onPanelProgress: (panel: TaskPanel, delta: number) => void,
  ) {}

  get activePanels(): readonly TaskPanel[] {
    return this.panels
  }

  /** How many panels should be alive right now, given depth and tension. */
  private get desiredCount(): number {
    const base = 3
    const byTension = Math.floor(this.layers.tension * 3)
    return Math.min(6, base + byTension)
  }

  tick(dtMs: number): void {
    this.panels = this.panels.filter((p) => !p.isDone)
    this.spawnCooldown -= dtMs

    if (this.panels.length < this.desiredCount && this.spawnCooldown <= 0) {
      this.spawn()
      this.spawnCooldown = SPAWN_COOLDOWN_MS
    }
  }

  /** Clear the board -- used by the breakthrough sequence. */
  clearAll(): void {
    for (const p of this.panels) p.win.close()
    this.panels = []
  }

  spawn(): TaskPanel | null {
    const pool = LAYER_POOLS[this.state.layer]
    const activeTypes = this.panels.map((p) => p.id.split('-')[0] ?? '')
    const typeId = pickPanelType(pool, activeTypes, (arr) => pick(this.rng, arr))
    const factory = PANEL_TYPES[typeId]
    if (!factory) return null

    const panel = factory(this.manager, {
      rng: this.rng,
      intensity: Math.min(1, this.layers.tension),
      onComplete: (p) => this.onPanelComplete(p),
      onProgress: (p, d) => this.onPanelProgress(p, d),
    })
    this.panels.push(panel)
    return panel
  }
}
