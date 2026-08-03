import { mulberry32 } from '@/core/rng'
import { BankRegistry, expand, type GenContext, type MissionFacts } from './grammar'
import { netops } from './banks/netops'
import { kernel } from './banks/kernel'
import { flavor } from './banks/flavor'

/**
 * Wires the grammar engine (grammar.ts) to the actual bank data. This is
 * the one file that knows every bank that exists — Phase 2 registers ~9
 * more here without touching the engine itself.
 */
export class ContentEngine {
  private ctx: GenContext

  constructor(seed: number, facts?: MissionFacts) {
    const registry = new BankRegistry()
    registry.register('netops', netops)
    registry.register('kernel', kernel)
    registry.register('flavor', flavor)

    this.ctx = {
      rng: mulberry32(seed),
      banks: registry.toMap(),
      facts,
    }
  }

  line(bankId: string, key: string): string {
    return expand(bankId, key, this.ctx)
  }

  setFacts(facts: MissionFacts): void {
    this.ctx.facts = facts
  }
}
