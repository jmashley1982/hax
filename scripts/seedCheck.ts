/**
 * The determinism regression test the README promises: run the same seed
 * twice and diff the output. `?seed=` reproducibility (film-mode's whole
 * reason to exist) depends on every random draw going through
 * `core/rng.ts` instead of a bare `Math.random()` -- this is the cheapest
 * check that actually proves it, run headlessly, no DOM required.
 *
 * Two independent surfaces, both seed-derived:
 *   1. mulberry32 itself -- the raw stream.
 *   2. ContentEngine -- the generated-text layer everything else draws
 *      through, exercised across several banks so a regression in the
 *      grammar layer (not just the PRNG) would also be caught.
 */
import { mulberry32, hashSeed } from '../src/core/rng'
import { ContentEngine } from '../src/content'

const SEED_LABEL = 'seed-check-2026'
const seed = hashSeed(SEED_LABEL)

function checkRawStream(): boolean {
  const a = mulberry32(seed)
  const b = mulberry32(seed)
  for (let i = 0; i < 2000; i++) {
    const x = a()
    const y = b()
    if (x !== y) {
      console.error(`FAIL raw stream: draw ${i} diverged (${x} !== ${y})`)
      return false
    }
  }
  return true
}

const BANKS: Array<[string, string]> = [
  ['flavor', 'bootInit'],
  ['flavor', 'bootRelay'],
  ['exploit', 'stage'],
  ['warnings', 'idsAlert'],
  ['messages', 'operatorTaunt1'],
  ['netops', 'scanLine'],
]

function checkContentEngine(): boolean {
  const facts = {
    org: 'HALCYON DYNAMICS',
    domain: 'halcyon-dynamics.example',
    subnet: '10.20.0.0/16',
  } as import('../src/content/grammar').MissionFacts

  const engineA = new ContentEngine(seed, facts)
  const engineB = new ContentEngine(seed, facts)

  for (let round = 0; round < 40; round++) {
    for (const [bank, key] of BANKS) {
      const x = engineA.line(bank, key)
      const y = engineB.line(bank, key)
      if (x !== y) {
        console.error(`FAIL content engine: round ${round} ${bank}/${key} diverged\n  A: ${x}\n  B: ${y}`)
        return false
      }
    }
  }
  return true
}

const rawOk = checkRawStream()
const contentOk = checkContentEngine()

if (rawOk && contentOk) {
  console.log(`PASS -- seed "${SEED_LABEL}" (${seed}) reproduces identically across both checks`)
  process.exit(0)
} else {
  process.exit(1)
}
