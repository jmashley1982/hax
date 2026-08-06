import type { Contract } from '@/sim/contracts'
import { sectorLabel } from '@/sim/contracts'
import type { SessionOutcome } from '@/ui/shell'

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
      payoutLine(
        'PAYOUT',
        String(payout),
        true,
      ),
    )

    const grade = document.createElement('div')
    grade.className = 'debrief__grade'
    grade.textContent = gradeFor(outcome, integrityLeft, contract)

    const btn = document.createElement('button')
    btn.className = 'debrief__continue'
    btn.textContent = 'CONTINUE'
    btn.addEventListener('click', () => this.finish())

    box.append(title, sub, grade, rows, payoutBox, btn)
    this.el.appendChild(box)
    mount.appendChild(this.el)

    // Focus so Enter/Space also dismisses -- but nothing auto-advances.
    requestAnimationFrame(() => btn.focus())
    this.payout = payout
  }

  /** Extra score awarded by the payout multiplier, applied by the App. */
  payout = 0

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
