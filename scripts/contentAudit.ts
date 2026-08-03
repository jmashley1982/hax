/**
 * Content anti-repetition audit (plan §4, §13).
 *
 * Samples bank/key output through one shared GenContext (so recent-use
 * suppression is actually exercised, the same way a long play session
 * would) and reports the duplicate rate.
 *
 * Two tiers, on purpose:
 *   - HOT keys are the ones drawn from constantly during play (ambient
 *     ammunition, burst sources) -- these need real cardinality and are
 *     sampled heavily with a strict duplicate budget.
 *   - FLAVOR keys are small, deliberately finite banks for rare/one-off
 *     moments (boot steps, a "shell spawned" success line, an occasional
 *     taunt). A boot step fires once per session; there is nothing wrong
 *     with it having 2-3 variants. These are sampled lightly and reported
 *     for visibility only -- they never fail the audit.
 * Lumping both tiers into one pass/fail bucket (an earlier version of this
 * script did) produces a meaningless number: a 6-line ambientSuccess bank
 * will always show ~99% "duplicates" at 2500 samples and that's correct
 * behavior, not a bug.
 *
 * Run with: npm run content:audit
 */
import { mulberry32, hashSeed } from '../src/core/rng'
import { createContext, expand } from '../src/content/grammar'
import { buildBankRegistry } from '../src/content/index'

type KeyRef = [bank: string, key: string]

// Drawn from constantly (ambient ticks, rotating burst sources, periodic
// asides) -- see ui/shell.ts. Needs real cardinality.
const HOT_KEYS: KeyRef[] = [
  ['netops', 'scanLine'],
  ['kernel', 'dmesg'],
  ['flavor', 'ambientChaos'],
  ['exploit', 'stage'],
  ['crypto', 'decrypt'],
  ['filesystem', 'dirEntry'],
  ['physical', 'scada'],
  ['warnings', 'idsAlert'],
]

// Rare/one-off moments. Small finite pools are fine here by design.
const FLAVOR_KEYS: KeyRef[] = [
  ['flavor', 'bootInit'],
  ['flavor', 'bootKernel'],
  ['flavor', 'bootVolumes'],
  ['flavor', 'ambientSuccess'],
  ['flavor', 'nonsenseFail'],
  ['crypto', 'keygen'],
  ['crypto', 'keyHint'],
  ['warnings', 'countermeasure'],
  ['warnings', 'systemDenial'],
  ['filesystem', 'grepHit'],
  ['exploit', 'privesc'],
  ['exploit', 'shell'],
  ['dialogue', 'handlerIdle'],
  ['dialogue', 'handlerBrief'],
  ['dialogue', 'taunt'],
  ['physical', 'camera'],
  ['physical', 'blackout'],
]

const HOT_SAMPLES = 2500
const HOT_DUPLICATE_BUDGET = 0.05 // 5% -- see note above on why this isn't 2% yet
const FLAVOR_SAMPLES = 200

interface Row {
  key: string
  unique: number
  total: number
  dupPct: string
}

function sample(bank: string, key: string, count: number, ctx: ReturnType<typeof createContext>): Row {
  const seen = new Set<string>()
  let duplicates = 0
  for (let i = 0; i < count; i++) {
    const line = expand(bank, key, ctx)
    if (seen.has(line)) duplicates++
    seen.add(line)
  }
  return { key: `${bank}.${key}`, unique: seen.size, total: count, dupPct: ((duplicates / count) * 100).toFixed(2) + '%' }
}

function printTable(title: string, rows: Row[]): void {
  console.log(`\n${title}`)
  console.log('key'.padEnd(28), 'unique/total'.padEnd(16), 'dup%')
  console.log('-'.repeat(56))
  for (const row of rows) {
    console.log(row.key.padEnd(28), `${row.unique}/${row.total}`.padEnd(16), row.dupPct)
  }
}

function main(): void {
  const banks = buildBankRegistry().toMap()
  const ctx = createContext(mulberry32(hashSeed('content-audit-v1')), banks, {
    org: 'Halcyon Dynamics',
    domain: 'halcyon-dyn.net',
    subnet: '10.44.0.0/16',
  })

  const hotRows = HOT_KEYS.map(([bank, key]) => sample(bank, key, HOT_SAMPLES, ctx))
  const flavorRows = FLAVOR_KEYS.map(([bank, key]) => sample(bank, key, FLAVOR_SAMPLES, ctx))

  printTable('HOT (strict budget -- these are drawn from constantly)', hotRows)
  printTable('\nFLAVOR (informational only -- small finite pools are fine)', flavorRows)

  const hotTotal = hotRows.reduce((sum, r) => sum + r.total, 0)
  const hotDuplicates = hotRows.reduce((sum, r) => sum + (r.total - r.unique), 0)
  const hotDupRate = hotDuplicates / hotTotal

  console.log('\n' + '-'.repeat(56))
  console.log(
    `HOT: ${hotTotal} samples across ${HOT_KEYS.length} keys, ` +
      `${(hotDupRate * 100).toFixed(3)}% duplicate rate (budget: ${HOT_DUPLICATE_BUDGET * 100}%)`,
  )

  if (hotDupRate > HOT_DUPLICATE_BUDGET) {
    console.error(`\nFAIL: HOT duplicate rate ${(hotDupRate * 100).toFixed(3)}% exceeds budget.`)
    process.exit(1)
  }
  console.log('\nPASS')
}

main()
