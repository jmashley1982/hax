import type { Contract } from '@/sim/contracts'
import { sectorLabel } from '@/sim/contracts'
import type { SessionOutcome } from '@/ui/shell'
import type { PlayMode } from '@/core/events'
import { initialsFrom, normalise, qualifies, submitScore } from '@/core/highScores'
import { saveState, type GameState } from '@/core/state'
import { awardAchievements } from '@/sim/achievements'

/**
 * The post-contract results screen.
 *
 * A finished run used to drop straight back to the contract board -- "no
 * YOU WON or CONGRATS, it just ended and i was on the menu again" -- and
 * because a run can also end by being burned or by a stray abort, every
 * ending looked identical to a crash. This is the screen that tells you
 * which one happened and what it was worth.
 *
 * Deliberately **dismissed by the player, never on a timer**: a results
 * screen you can miss is the bug it was written to fix.
 */

export interface DebriefOptions {
  contract: Contract
  outcome: SessionOutcome
  integrityLeft: number
  elapsedMs: number
  onContinue: () => void
  /** Needed for the score wall: which table, and a starting guess at the initials. */
  state: GameState
}

interface Verdict {
  title: string
  sub: string
  tone: 'win' | 'loss' | 'neutral'
  /** Fraction of the earned score actually banked. */
  payoutFactor: number
}

function verdictFor(outcome: SessionOutcome, contract: Contract): Verdict {
  if (outcome.kind === 'completed') {
    return {
      title: 'CONTRACT COMPLETE',
      sub: `${contract.facts.org} is yours. Payment cleared.`,
      tone: 'win',
      payoutFactor: 1,
    }
  }
  if (outcome.kind === 'burned') {
    return {
      title: 'BURNED',
      sub: `${contract.facts.org} pushed you off the box. Partial payment only.`,
      tone: 'loss',
      payoutFactor: 0.35,
    }
  }
  return {
    title: 'CONTRACT ABANDONED',
    sub: 'You pulled the plug. Nothing banked for an unfinished job.',
    tone: 'neutral',
    payoutFactor: 0.15,
  }
}

/** A grade, so two completed runs aren't indistinguishable. */
function gradeFor(outcome: SessionOutcome, integrityLeft: number, contract: Contract): string {
  if (outcome.kind !== 'completed') return integrityLeft > 40 ? 'D' : 'F'
  const score = integrityLeft * 0.6 + contract.tier * 8
  if (score >= 90) return 'S'
  if (score >= 72) return 'A'
  if (score >= 55) return 'B'
  return 'C'
}

export class Debrief {
  private el: HTMLElement

  constructor(mount: HTMLElement, private opts: DebriefOptions) {
    const { contract, outcome, integrityLeft, elapsedMs } = opts
    const verdict = verdictFor(outcome, contract)
    const payout = Math.round(outcome.scoreEarned * verdict.payoutFactor * contract.reward)

    this.el = document.createElement('div')
    this.el.className = `debrief debrief--${verdict.tone}`

    const box = document.createElement('div')
    box.className = 'debrief__box'

    const title = document.createElement('div')
    title.className = 'debrief__title'
    title.textContent = verdict.title

    const sub = document.createElement('div')
    sub.className = 'debrief__sub'
    sub.textContent = verdict.sub

    const rows = document.createElement('div')
    rows.className = 'debrief__rows'
    rows.append(
      row('TARGET', `${contract.facts.org}  (${sectorLabel(contract.sector)}, TIER ${contract.tier})`),
      row('JOB', contract.job.brief),
      row('OBJECTIVE', outcome.kind === 'completed' ? 'SECURED' : 'NOT SECURED'),
      row('DEEPEST LAYER', outcome.deepestLayer.toUpperCase()),
      row('INTEGRITY LEFT', `${Math.round(integrityLeft)}%`),
      row('TIME ON TARGET', formatDuration(elapsedMs)),
    )

    const payoutBox = document.createElement('div')
    payoutBox.className = 'debrief__payout'
    payoutBox.append(
      payoutLine('EARNED', String(outcome.scoreEarned)),
      payoutLine('TIER MULTIPLIER', `x${contract.reward.toFixed(2)}`),
      payoutLine('PAYOUT', `${payout} CR`, true),
    )

    const grade = document.createElement('div')
    grade.className = 'debrief__grade'
    grade.textContent = gradeFor(outcome, integrityLeft, contract)

    const btn = document.createElement('button')
    btn.className = 'debrief__continue'
    btn.textContent = 'CONTINUE'
    btn.addEventListener('click', () => this.finish())

    const grade2 = gradeFor(outcome, integrityLeft, contract)
    box.append(title, sub, grade, rows, payoutBox)

    // The arcade beat, and only when it is earned: offering the initials
    // entry on a score that will not make the wall is the saddest possible
    // version of a high-score table.
    const mode: PlayMode = opts.state.mode
    if (qualifies(mode, payout)) {
      box.appendChild(
        this.buildInitials(mode, {
          // One id for this run, so re-submitting on each keystroke edits
          // the row instead of adding another.
          id: `${contract.id}-${Math.round(elapsedMs)}-${payout}`,
          initials: initialsFrom(opts.state),
          score: payout,
          org: contract.facts.org,
          layer: outcome.deepestLayer.toUpperCase(),
          grade: grade2,
          at: Date.now(),
        }),
      )
    }

    // Unlocks last, under everything else. Awarded AFTER the wall check, so
    // ON THE WALL can read whether this run actually made it -- and awarded
    // here rather than in the Shell because the payout and the wall are
    // computed on this screen, not during the run.
    const fresh = awardAchievements(opts.state, {
      kind: outcome.kind,
      deepestLayer: outcome.deepestLayer,
      integrityLeft,
      elapsedMs,
      peakHeat: outcome.peakHeat,
      lowestIntegrity: outcome.lowestIntegrity,
      gatesCleared: outcome.gatesCleared,
      allyKeysUsed: outcome.allyKeysUsed,
      levelsCleared: outcome.levelsCleared,
      tier: contract.tier,
      madeTheWall: qualifies(mode, payout),
    })
    if (fresh.length > 0) {
      saveState(opts.state)
      const wrap = document.createElement('div')
      wrap.className = 'debrief__unlocks'
      const label = document.createElement('div')
      label.className = 'debrief__unlocks-label'
      label.textContent = fresh.length === 1 ? 'UNLOCKED' : `UNLOCKED x${fresh.length}`
      wrap.appendChild(label)
      for (const a of fresh) {
        const row = document.createElement('div')
        row.className = 'debrief__unlock'
        const name = document.createElement('span')
        name.className = 'debrief__unlock-name'
        name.textContent = a.name
        const note = document.createElement('span')
        note.className = 'debrief__unlock-note'
        note.textContent = a.note
        row.append(name, note)
        wrap.appendChild(row)
      }
      box.appendChild(wrap)
    }

    box.append(btn)
    this.el.appendChild(box)
    mount.appendChild(this.el)

    // Focus so Enter/Space also dismisses -- but nothing auto-advances.
    requestAnimationFrame(() => btn.focus())
    this.payout = payout
  }

  /** Extra score awarded by the payout multiplier, applied by the App. */
  payout = 0

  /**
   * Three letters, arrows or typing, exactly like the cabinet.
   *
   * Submitted on the first change and RE-submitted on every edit rather
   * than on CONTINUE: a player who closes the tab from this screen still
   * gets their row, and a row that only lands if you press the right
   * button afterwards is a row people will lose.
   */
  private buildInitials(
    mode: PlayMode,
    entry: { id: string; initials: string; score: number; org: string; layer: string; grade: string; at: number },
  ): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'debrief__initials'

    const label = document.createElement('div')
    label.className = 'debrief__initials-label'
    label.textContent = 'HIGH SCORE -- ENTER YOUR INITIALS'

    const row = document.createElement('div')
    row.className = 'debrief__initials-row'

    let value = normalise(entry.initials).split('')
    const cells: HTMLInputElement[] = []
    const commit = (): void => {
      submitScore(mode, { ...entry, initials: value.join('') })
    }

    for (let i = 0; i < 3; i++) {
      const cell = document.createElement('input')
      cell.className = 'debrief__initial'
      cell.value = value[i] ?? 'A'
      cell.maxLength = 1
      cell.spellcheck = false
      cell.autocomplete = 'off'
      cell.setAttribute('aria-label', `initial ${i + 1}`)
      cell.addEventListener('input', () => {
        const ch = normalise(cell.value || 'A')[0] ?? 'A'
        cell.value = ch
        value[i] = ch
        commit()
        if (cell.value) cells[i + 1]?.focus()
      })
      cell.addEventListener('keydown', (e) => {
        // Arrows cycle the letter, like a cabinet with no keyboard.
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
          const at = Math.max(0, alphabet.indexOf(cell.value))
          const next = (at + (e.key === 'ArrowUp' ? 1 : alphabet.length - 1)) % alphabet.length
          cell.value = alphabet[next] ?? 'A'
          value[i] = cell.value
          commit()
        }
        e.stopPropagation()
      })
      cells.push(cell)
      row.appendChild(cell)
    }

    // Bank the default immediately, so the row exists even if they never
    // touch it.
    commit()
    wrap.append(label, row)
    return wrap
  }

  private finish(): void {
    this.el.remove()
    this.opts.onContinue()
  }

  destroy(): void {
    this.el.remove()
  }
}

function row(label: string, value: string): HTMLElement {
  const r = document.createElement('div')
  r.className = 'debrief__row'
  const l = document.createElement('span')
  l.className = 'debrief__row-label'
  l.textContent = label
  const v = document.createElement('span')
  v.textContent = value
  r.append(l, v)
  return r
}

function payoutLine(label: string, value: string, strong = false): HTMLElement {
  const r = document.createElement('div')
  r.className = `debrief__payout-row${strong ? ' is-total' : ''}`
  const l = document.createElement('span')
  l.textContent = label
  const v = document.createElement('span')
  v.textContent = value
  r.append(l, v)
  return r
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}
