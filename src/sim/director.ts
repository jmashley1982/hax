import { pick, type Rng } from '@/core/rng'
import type { GameState } from '@/core/state'
import type { WindowManager } from '@/ui/windows/manager'
import type { TaskPanel } from '@/ui/panels/panel'
import { PANEL_TYPES, pickPanelType } from '@/ui/panels/registry'
import { unlockedPanelTypes, type LayerSystem } from './layers'

/** Outcome hooks the Shell wants from whichever panel happens to carry them. */
export interface DirectorHooks {
  onArtifactSecured?: () => void
  onCorrupted?: (panelId: string) => void
  onPurged?: (file: { name: string; corrupted: boolean }) => void
}

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
/**
 * Short enough that a cleared board refills fast (a player solving panels
 * quickly should not be punished with an empty screen), long enough that
 * panels arrive as a visible stagger rather than all at once.
 */
const SPAWN_COOLDOWN_MS = 380

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
    /** Vault-pull outcome hooks, threaded per panel instead of via statics. */
    private hooks: DirectorHooks = {},
  ) {}

  /**
   * The contract's objective filename, waiting to be handed to the next
   * vault-pull panel built.
   *
   * Deliberately an instance field on the Director, not a static on the
   * panel class: the Director dies with its Shell, so a run that ends
   * before the file is ever claimed cannot poison the next contract.
   */
  private pendingArtifact: string | null = null

  /** Called by the Shell when the run reaches the job's layer. */
  seedArtifact(name: string): void {
    this.pendingArtifact = name
  }

  /**
   * The file the current level wants located.
   *
   * Unlike the artifact this is NOT consumed on first use: every navigator
   * built during the level hides the same file, because the level's
   * objective is that one file and a second navigator showing a different
   * one would be incoherent.
   */
  private findTarget: string | null = null

  setFindTarget(name: string | null): void {
    this.findTarget = name
  }

  get activePanels(): readonly TaskPanel[] {
    return this.panels
  }

  /**
   * How many panels should be alive right now. The floor rises with depth
   * so the physical layer *starts* as busy as the surface layer ends --
   * part of making the descent feel like escalation.
   */
  private get desiredCount(): number {
    const floor = this.layers.current.panelFloor
    const byTension = Math.floor(this.layers.tension * 3)
    const wanted = Math.min(7, floor + byTension)
    // The board budget caps how many windows may exist in total, and task
    // panels count. Without this the Director would happily hold seven
    // panels while ambient popups fought for the remainder, and the board
    // ran to 18 windows at depth -- measured, on IRL, in a 150s run.
    const cap = this.getWindowBudget?.()
    return cap === undefined ? wanted : Math.max(2, Math.min(wanted, cap))
  }

  /** Set by the Shell: how many budgeted windows may exist right now. */
  private getWindowBudget: (() => number) | null = null

  setBudgetProvider(fn: () => number): void {
    this.getWindowBudget = fn
  }

  /**
   * Panel types the current level actually needs.
   *
   * Without this a level asking for CIPHER LOCKs competes on equal terms
   * with every other unlocked type, so the objective advances at the speed
   * of a dice roll and the level reads as slow rather than as a task. The
   * bias is a preference, not a filter -- the other types still spawn, so
   * the board keeps its variety and the required tool never becomes the
   * only thing on screen.
   */
  private preferred: readonly string[] = []

  setPreferredTypes(types: readonly string[]): void {
    this.preferred = types
  }

  /**
   * @param canSpawn false while the player is mid-interaction (a drag).
   *        Decay and bookkeeping still run -- only *new* panels are held
   *        back, so a window can't appear on top of the drag in progress.
   */
  tick(dtMs: number, canSpawn = true): void {
    // A panel whose WINDOW is gone is gone, solved or not. Without this a
    // dismissed panel stayed in the list forever, counting against
    // desiredCount, so the board quietly ran one panel short for the rest
    // of the session and no replacement ever spawned.
    this.panels = this.panels.filter((p) => !p.isDone && !p.win.isClosed)
    this.spawnCooldown -= dtMs

    for (const p of this.panels) p.tickDecayModifier(dtMs)

    if (canSpawn && this.panels.length < this.desiredCount && this.spawnCooldown <= 0) {
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
    // The cap lives HERE, not only in tick(), because the Shell calls
    // spawn() directly from five different "refill the board" loops
    // (session start, breakthrough, ejection, overrun, manhunt escape).
    // Those all used the layer's panelFloor and bypassed desiredCount
    // entirely, which is how the board reached eight panels while the
    // budget believed it was allowing three.
    const cap = this.getWindowBudget?.()
    if (cap !== undefined && this.panels.length >= cap) return null

    // The level's required tools are ALWAYS spawnable, even if the depth
    // ladder has not unlocked them yet.
    //
    // Without this union a level can demand a tool the layer refuses to
    // spawn, and because a levelled run only ends when its OBJECTIVE is
    // met -- applyResidualProgress explicitly cannot win a level -- that
    // is a permanent softlock, not a slow patch. It shipped exactly once:
    // KERNEL's "hold the channel" spends clear windows on SIGNAL LOCK,
    // which layers.ts unlocks a layer LATER at PHYSICAL, so the panel
    // could never appear. Reported from a real run stuck at 0/3 holds
    // with eight unspendable windows banked.
    //
    // Unioning here rather than editing that one unlock list is the point:
    // it makes "a level cannot require a tool it cannot spawn" true by
    // construction for every spec written from now on. The ladder still
    // governs everything the level did not ask for, so a tool borrowed
    // early is borrowed for the job, not handed over wholesale.
    const unlocked = unlockedPanelTypes(this.state.layer)
    const pool = [...new Set([...unlocked, ...this.preferred])]
    const activeTypes = this.panels.map((p) => p.id.split('-')[0] ?? '')
    // Guarantee the level's tools are available WITHOUT letting them take
    // the whole board. Measured before this cap: at PERIMETER, whose level
    // wants ROUTE + CIPHER, zero PORT SCAN panels spawned in 45 seconds --
    // panels crack fast, the board is usually below its floor, and every
    // refill went to a missing required type. That trades "there is always
    // a right answer" for "there is only one thing on screen", and the
    // board showing a mix of things to do is not negotiable.
    const liveRequired = activeTypes.filter((t) => this.preferred.includes(t)).length
    const roomForMore = liveRequired < Math.ceil(this.desiredCount / 2)
    const typeId = pickPanelType(
      pool,
      activeTypes,
      (arr) => pick(this.rng, arr),
      roomForMore ? this.preferred : [],
    )
    const factory = PANEL_TYPES[typeId]
    if (!factory) return null

    // Hand the objective file to the first vault-pull panel that appears,
    // then clear it so it is never handed out twice.
    const artifact = typeId === 'dragExfil' ? this.pendingArtifact : null
    if (artifact) this.pendingArtifact = null

    const panel = factory(this.manager, {
      rng: this.rng,
      artifact,
      onArtifactSecured: this.hooks.onArtifactSecured,
      onCorrupted: this.hooks.onCorrupted,
      onPurged: this.hooks.onPurged,
      findTarget: this.findTarget,
      // Size/complexity comes from depth first, tension second -- so deep
      // panels are visibly denser than shallow ones regardless of timing.
      intensity: Math.min(1, this.layers.current.sizeBias * 0.7 + this.layers.tension * 0.3),
      modifier: this.layers.current.modifier,
      onComplete: (p) => this.onPanelComplete(p),
      onProgress: (p, d) => this.onPanelProgress(p, d),
    })
    this.panels.push(panel)
    return panel
  }
}
