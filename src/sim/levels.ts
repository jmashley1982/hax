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
}

/**
 * Two levels, deliberately.
 *
 * MAP proves the basic shape (a required tool, a count, a real win
 * condition). BREACH proves the part that actually answers "different
 * objectives require different tools": it needs TWO, and one feeds the
 * other. Building both before the remaining four means the model is tested
 * against its hardest case first rather than its easiest.
 */
const LEVEL_SPECS: Partial<Record<LayerId, LevelSpec>> = {
  surface: {
    kind: 'map',
    tools: ['ports'],
    target: 3,
    unit: 'HOSTS MAPPED',
    label: (f, t, facts) => `MAP ${facts.org.toUpperCase()} -- ${f}/${t} live hosts found`,
    brief: (facts) =>
      `>> LEVEL 1 :: map the perimeter. run PORT SCANs until you have three live hosts on ${facts.domain}.`,
  },
  perimeter: {
    kind: 'breach',
    tools: ['nodePath', 'cipher'],
    target: 3,
    unit: 'KEY SEGMENTS',
    label: (f, t) => `BREACH THE GATEWAY -- ${f}/${t} key segments assembled`,
    brief: () =>
      '>> LEVEL 2 :: trace a route to bank a fragment, then feed it to a CIPHER LOCK. three segments opens the gateway.',
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
   * BREACH only: fragments banked by ROUTE TRACING and spent by CIPHER
   * LOCK. Kept here rather than on the panels because it is a property of
   * the LEVEL -- a route traced before the objective existed should not
   * secretly count, and a fragment must survive the panel that produced it.
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

    if (this.spec.kind === 'breach') {
      if (typeId === 'nodePath') {
        this.fragments += 1
        return {
          counted: false,
          note: `>> route traced -- key fragment banked (${this.fragments} in hand)`,
          found: this.found,
        }
      }
      // cipher
      if (this.fragments <= 0) {
        return {
          counted: false,
          note: '-- cipher aligned, but you have no fragment to feed it. trace a ROUTE first.',
          found: this.found,
        }
      }
      this.fragments -= 1
      this.found += 1
      this.onMilestone(this.found, this.spec.target)
      return {
        counted: true,
        note: `>> KEY SEGMENT ${this.found}/${this.spec.target} assembled`,
        found: this.found,
      }
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
