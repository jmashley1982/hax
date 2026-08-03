import { KEYWORD_ROUTES, THEMATIC_WORDS, type Route } from './builtins'

/**
 * Command router: exact route match > fuzzy (typo-tolerant) keyword match >
 * thematic word > nonsense (plan §3, INTENT mode). This is deliberately
 * global vocabulary, not gated by mission/layer state yet -- Phase 5's
 * mission-scoped `commandRoutes` will take priority over this when a
 * mission is active; until then this is the whole router.
 */
export type MatchTier = 'exact' | 'fuzzy' | 'thematic' | 'nonsense'

export interface MatchResult {
  tier: MatchTier
  route?: Route
  matchedWord?: string
  /** Progress multiplier applied on top of the mode's submitGain. */
  strength: number
}

const STRENGTH: Record<MatchTier, number> = {
  exact: 1,
  fuzzy: 0.7,
  thematic: 0.4,
  nonsense: 0.05,
}

const FUZZY_MAX_DISTANCE = 2

export function matchCommand(rawLine: string): MatchResult {
  const tokens = rawLine
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (tokens.length === 0) return { tier: 'nonsense', strength: STRENGTH.nonsense }

  for (const token of tokens) {
    const route = KEYWORD_ROUTES[token]
    if (route) return { tier: 'exact', route, matchedWord: token, strength: STRENGTH.exact }
  }

  let bestFuzzy: { word: string; route: Route; dist: number } | null = null
  for (const token of tokens) {
    for (const [word, route] of Object.entries(KEYWORD_ROUTES)) {
      const dist = levenshtein(token, word)
      if (dist <= FUZZY_MAX_DISTANCE && (!bestFuzzy || dist < bestFuzzy.dist)) {
        bestFuzzy = { word, route, dist }
      }
    }
  }
  if (bestFuzzy) {
    return { tier: 'fuzzy', route: bestFuzzy.route, matchedWord: bestFuzzy.word, strength: STRENGTH.fuzzy }
  }

  for (const token of tokens) {
    if (THEMATIC_WORDS.has(token)) {
      return { tier: 'thematic', matchedWord: token, strength: STRENGTH.thematic }
    }
  }

  return { tier: 'nonsense', strength: STRENGTH.nonsense }
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  // Bail early on wildly different lengths -- not a real typo of each other.
  if (Math.abs(m - n) > FUZZY_MAX_DISTANCE + 1) return FUZZY_MAX_DISTANCE + 1

  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array<number>(n + 1).fill(0)

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        (prev[j] ?? Infinity) + 1,
        (curr[j - 1] ?? Infinity) + 1,
        (prev[j - 1] ?? Infinity) + cost,
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n] ?? FUZZY_MAX_DISTANCE + 1
}
