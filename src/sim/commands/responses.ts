import type { ContentEngine } from '@/content'
import type { TerminalLine } from '@/core/events'
import type { MatchResult } from './registry'

/**
 * Turns a command match tier into actual terminal output. Successful
 * (exact) commands get a short burst -- spectacle scales with how "real"
 * the input was, same principle as CHAOS's escalating bursts. Nonsense
 * still gets something -- per the brief, a failure should still look cool,
 * never just a blank refusal.
 */
export function buildCommandResponse(match: MatchResult, content: ContentEngine): TerminalLine[] {
  switch (match.tier) {
    case 'exact': {
      const route = match.route!
      const lines: TerminalLine[] = [
        { text: `> ${match.matchedWord} :: initiating`, tone: 'success', speed: 3 },
      ]
      for (let i = 0; i < 3; i++) {
        lines.push({ text: content.line(route.bank, route.key), tone: 'dim', speed: 2 })
      }
      return lines
    }
    case 'fuzzy': {
      const route = match.route!
      return [
        { text: `> interpreting as "${match.matchedWord}"`, tone: 'system', speed: 4 },
        { text: content.line(route.bank, route.key), tone: 'normal', speed: 3 },
      ]
    }
    case 'thematic': {
      return [
        { text: `> processing "${match.matchedWord}"...`, tone: 'dim', speed: 4 },
        { text: content.line('flavor', 'ambientChaos'), tone: 'dim', speed: 3 },
      ]
    }
    case 'nonsense':
    default:
      return [{ text: content.line('flavor', 'nonsenseFail'), tone: 'dim', speed: 5 }]
  }
}
