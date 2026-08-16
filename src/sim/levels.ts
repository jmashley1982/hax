import type { LayerId } from '@/core/state'
import type { MissionFacts } from '@/content/grammar'

/**
 * What finishing a level actually MEANS.
 *
 * Every layer used to end the same way: `LayerSystem.addProgress` filling
 * to a threshold. Progress came from keystrokes, clicks, panel completions
 * and a passive drip, and every source was fungible -- so WHAT you did
 * never mattered, only HOW MUCH. That is the literal mechanism behind "it
 * all feels very random and inconsequential... theres no rhyme or reason
 * to the gameplay loop", and it is also why six unlocked panel types never
 * amounted to anything: the game handed you new tools and never once asked
 * for a specific one.
 *
 * A level now ends when its OBJECTIVE is met. Mashing still drives the
 * panels and still feels good, but only the level's required tools yield
 * objective items -- so for the first time the board has a right answer.
 *
 * Layers with no spec here fall back to the old threshold, which is what
 * lets this ship two levels at a time without the deeper half of the game
 * becoming unplayable in between.
 */

export type ObjectiveKind = 'map' | 'breach' | 'locate' | 'assemble' | 'hold' | 'trip'

/** Every blocking interrupt the game can throw at you. See ui/gate.ts. */
export type GateKind = 'password' | 'purge' | 'rekey' | 'trace' | 'route'

/**
 * A blocking interrupt, placed on the OBJECTIVE rather than on a clock.
 *
 * This is the whole difference between an interruption that means
 * something and the "random" the player reported: every other interrupt in
 * the game fires off `nextChainAt`/`nextFieldOpAt`/`nextReverseRollAt`,
 * timers unrelated to anything the player is doing. A gate fires because
 * you just got somewhere.
 */
export interface GateSpec {
  /** Objective items held when this fires. */
  atFound: number
  kind: GateKind
}

export interface LevelSpec {
  kind: ObjectiveKind
  /** Panel type ids that yield objective items. Anything else is just work. */
  tools: readonly string[]
  /** How many items the objective needs. */
  target: number
  /** The standing goal line, shown in the objective bar's job slot. */
  label: (found: number, target: number, facts: MissionFacts) => string
  /** Announced on arrival, in the terminal. */
  brief: (facts: MissionFacts) => string
  /** Short noun for the FIND LOG, e.g. "HOSTS MAPPED". */
  unit: string
  /**
   * Blocking interrupts. Count and variety grow with depth -- level 1 gets
   * one, and only the gentler kind, so the first one a player ever sees is
   * a surprise rather than an ambush.
   */
  gates: readonly GateSpec[]
  /**
   * A two-tool dependency: clearing `banks` produces a token, clearing
   * `spends` consumes one to make an objective item.
   *
   * This started life hardcoded inside BREACH's branch of credit(). It is
   * pulled out because it turns out to be the single most useful shape in
   * the game -- it is what makes "different objectives require different
   * tools" bite, since neither tool alone gets you anywhere -- and three
   * of the six levels want it with different nouns.
   */
  pair?: { banks: string; spends: string; noun: string }
}

/**
 * Six levels, each a different SHAPE of task rather than the same task
 * with bigger numbers -- which was the whole complaint.
 *
 *   1 MAP       one tool, a simple count. The tutorial, without saying so.
 *   2 BREACH    two tools, one feeding the other.
 *   3 LOCATE    a single find, in a place you have to fly around.
 *   4 ASSEMBLE  one tool, but three of them, under real pressure.
 *   5 HOLD      two tools again, and the pair is inverted -- you open a
 *               window by fighting, then use it.
 *   6 TRIP      two tools where the second is a DRAG, and the shortest
 *               target in the game, because the finale follows it.
 *
 * Gate count and gate variety climb with depth, and every level past the
 * second introduces a gate kind the player has not seen.
 */
/** Exported for scripts/levelCheck.ts, which proves every level can actually be finished. */
export const LEVEL_SPECS: Partial<Record<LayerId, LevelSpec>> = {
  surface: {
    kind: 'map',
    tools: ['ports'],
    target: 3,
    unit: 'HOSTS MAPPED',
    gates: [{ atFound: 2, kind: 'password' }],
    label: (f, t, facts) => `MAP ${facts.org.toUpperCase()} -- ${f}/${t} live hosts found`,
    brief: (facts) =>
      `>> LEVEL 1 :: map the perimeter. run PORT SCANs until you have three live hosts on ${facts.domain}.`,
  },
  perimeter: {
    kind: 'breach',
    tools: ['nodePath', 'cipher'],
    target: 3,
    unit: 'KEY SEGMENTS',
    pair: { banks: 'nodePath', spends: 'cipher', noun: 'key fragment' },
    gates: [
      { atFound: 1, kind: 'purge' },
      { atFound: 2, kind: 'password' },
    ],
    label: (f, t) => `BREACH THE GATEWAY -- ${f}/${t} key segments assembled`,
    brief: () =>
      '>> LEVEL 2 :: trace a route to bank a fragment, then feed it to a CIPHER LOCK. three segments opens the gateway.',
  },
  core: {
    kind: 'assemble',
    tools: ['keyRecovery'],
    target: 3,
    unit: 'KEY FRAGMENTS',
    gates: [
      { atFound: 1, kind: 'rekey' },
      { atFound: 2, kind: 'trace' },
    ],
    label: (f, t) => `REBUILD THE MASTER KEY -- ${f}/${t} fragments recovered`,
    brief: () =>
      '>> LEVEL 4 :: the master key is in three pieces. run KEY RECOVERY until you have all of them.',
  },
  kernel: {
    kind: 'hold',
    // The pair inverted: here you FIGHT to open a window, then use it.
    // Same mechanic as level 2, opposite feeling.
    tools: ['traceDefense', 'signalAlign'],
    target: 3,
    unit: 'HOLDS',
    pair: { banks: 'traceDefense', spends: 'signalAlign', noun: 'clear window' },
    gates: [
      { atFound: 1, kind: 'route' },
      { atFound: 2, kind: 'rekey' },
      { atFound: 3, kind: 'trace' },
    ],
    label: (f, t) => `HOLD THE CHANNEL -- ${f}/${t} locks held`,
    brief: () =>
      '>> LEVEL 5 :: block a trace to buy a clear window, then get a SIGNAL LOCK inside it. three holds.',
  },
  physical: {
    kind: 'trip',
    tools: ['signalAlign', 'dragExfil'],
    // Two, not three: the finale fires the moment this completes, and a
    // long objective in front of the ending makes the ending feel late.
    target: 2,
    unit: 'CONTROLS TRIPPED',
    pair: { banks: 'signalAlign', spends: 'dragExfil', noun: 'clearance' },
    gates: [
      { atFound: 0, kind: 'trace' },
      { atFound: 1, kind: 'route' },
    ],
    label: (f, t, facts) => `TRIP ${facts.org.toUpperCase()}'S CONTROLS -- ${f}/${t}`,
    brief: () =>
      '>> LEVEL 6 :: align a control to earn a clearance, then spend it on a VAULT PULL. twice, and the building is yours.',
  },
  intranet: {
    kind: 'locate',
    tools: ['fs3d'],
    target: 1,
    unit: 'FILE LOCATED',
    // Only one gate, and the gentler kind: this level is already the
    // hardest thing on the board and a second interruption would break
    // concentration the navigator depends on.
    gates: [{ atFound: 0, kind: 'purge' }],
    label: (f, t, facts) =>
      f >= t
        ? `LOCATED on ${facts.domain}`
        : `LOCATE ${facts.org.toUpperCase()}'S COPY -- fly the file tree`,
    brief: (facts) =>
      `>> LEVEL 3 :: their storage is a place. open the FILE SYSTEM NAVIGATOR and go and find it on ${facts.domain}.`,
  },
}

export function levelSpec(layer: LayerId): LevelSpec | null {
  return LEVEL_SPECS[layer] ?? null
}

export interface LevelCredit {
  /** Did this completion count toward the objective? */
  counted: boolean
  /** A line to print, when the player deserves to know why. */
  note?: string
  /** Objective items now held. */
  found: number
}

/**
 * The live state of one level.
 *
 * Deliberately dumb: it holds a count and the rules for incrementing it.
 * All the fiction lives in the spec, all the board lives in the Shell.
 */
export class LevelRun {
  found = 0
  /**
   * Tokens banked by the pair's `banks` tool, waiting for its `spends`
   * tool. Kept here rather than on the panels because it is a property of
   * the LEVEL -- work done before the objective existed should not
   * secretly count, and a token must survive the panel that produced it.
   */
  private fragments = 0

  constructor(
    readonly layer: LayerId,
    readonly spec: LevelSpec,
    /** Fired on every increment. Gates hang off this, so they land on progress rather than a clock. */
    private onMilestone: (found: number, target: number) => void = () => {},
  ) {}

  get target(): number {
    return this.spec.target
  }

  get complete(): boolean {
    return this.found >= this.spec.target
  }

  /** Fragments in hand -- shown in the FIND LOG so the two-tool loop is legible. */
  get held(): number {
    return this.fragments
  }

  /**
   * Gates already fired, by their `atFound`.
   *
   * Tracked here rather than in the Shell because a failed gate can push
   * `found` back down (see penalise), and without this the same gate would
   * fire again the moment you recovered -- turning one mistake into a
   * loop.
   */
  private firedGates = new Set<number>()

  /** The gate due at the current count, if one is and it has not fired. */
  takeDueGate(): GateSpec | null {
    for (const g of this.spec.gates) {
      if (g.atFound !== this.found) continue
      if (this.firedGates.has(g.atFound)) continue
      this.firedGates.add(g.atFound)
      return g
    }
    return null
  }

  /**
   * The next gate still ahead of us, WITHOUT consuming it.
   *
   * The ally coupling needs to know what is coming before it is due -- a
   * contact who hands you a key at the same instant the prompt appears has
   * not helped you. Gates are listed in ascending `atFound`, and anything
   * already behind the current count can no longer fire, so the first
   * unfired gate at or after `found` is the one to warn about.
   */
  peekGate(): GateSpec | null {
    for (const g of this.spec.gates) {
      if (this.firedGates.has(g.atFound)) continue
      if (g.atFound < this.found) continue
      return g
    }
    return null
  }

  /**
   * A panel of type `typeId` was cleared.
   *
   * Returns whether it counted, and optionally why not. "Why not" matters:
   * a cipher cleared with no fragment banked looks identical to one that
   * counted unless the game says otherwise, and an unexplained non-event
   * is exactly the feeling this whole round is removing.
   */
  credit(typeId: string): LevelCredit {
    if (this.complete) return { counted: false, found: this.found }
    if (!this.spec.tools.includes(typeId)) return { counted: false, found: this.found }

    const pair = this.spec.pair
    if (pair) {
      if (typeId === pair.banks) {
        this.fragments += 1
        return {
          counted: false,
          note: `>> ${pair.noun} banked (${this.fragments} in hand)`,
          found: this.found,
        }
      }
      if (this.fragments <= 0) {
        return {
          counted: false,
          note: `-- nothing to spend. you need a ${pair.noun} first.`,
          found: this.found,
        }
      }
      this.fragments -= 1
    }

    this.found += 1
    this.onMilestone(this.found, this.spec.target)
    return {
      counted: true,
      note: `>> ${this.spec.unit} ${this.found}/${this.spec.target}`,
      found: this.found,
    }
  }

  /**
   * Satisfy the objective outright.
   *
   * For the SKELETON KEY, which is described as opening every lock on the
   * layer. It used to call the shell's breakthrough directly, which in a
   * levelled mode meant the layer fell with the objective still reading
   * 0/3 -- a second, invisible win condition, and exactly the "the
   * objective is what wins" promise being quietly broken. Routing it
   * through the objective keeps the token just as powerful and leaves one
   * way to finish a level.
   */
  fulfil(): void {
    this.found = this.spec.target
    this.onMilestone(this.found, this.spec.target)
  }

  /**
   * A failed gate makes the objective harder without ending the run --
   * "costs you, run continues". Dropping a held item is the cheapest
   * honest penalty: it is felt immediately, it is recoverable by doing
   * more of what you were already doing, and it can never make the level
   * unwinnable the way raising `target` past the panel supply could.
   */
  penalise(): void {
    if (this.fragments > 0) this.fragments -= 1
    else if (this.found > 0) this.found -= 1
  }
}
