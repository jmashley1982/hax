import { mulberry32 } from '@/core/rng'
import { BankRegistry, createContext, expand, type GenContext, type MissionFacts } from './grammar'
import { netops } from './banks/netops'
import { kernel } from './banks/kernel'
import { flavor } from './banks/flavor'
import { tokens } from './banks/tokens'
import { crypto } from './banks/crypto'
import { warnings } from './banks/warnings'
import { filesystem } from './banks/filesystem'
import { exploit } from './banks/exploit'
import { dialogue } from './banks/dialogue'
import { physical } from './banks/physical'

export type { MissionFacts } from './grammar'

/**
 * Wires the grammar engine (grammar.ts) to the actual bank data. This is
 * the one file that knows every bank that exists — adding a bank means
 * writing the data file and adding one `registry.register(...)` line here,
 * nothing in the engine changes.
 */
export function buildBankRegistry(): BankRegistry {
  const registry = new BankRegistry()
  registry.register('netops', netops)
  registry.register('kernel', kernel)
  registry.register('flavor', flavor)
  registry.register('tokens', tokens)
  registry.register('crypto', crypto)
  registry.register('warnings', warnings)
  registry.register('filesystem', filesystem)
  registry.register('exploit', exploit)
  registry.register('dialogue', dialogue)
  registry.register('physical', physical)
  return registry
}

export class ContentEngine {
  private ctx: GenContext

  constructor(seed: number, facts?: MissionFacts) {
    this.ctx = createContext(mulberry32(seed), buildBankRegistry().toMap(), facts)
  }

  line(bankId: string, key: string): string {
    return expand(bankId, key, this.ctx)
  }

  setFacts(facts: MissionFacts): void {
    this.ctx.facts = facts
  }
}
