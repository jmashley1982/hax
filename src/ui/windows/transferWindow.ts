import { hex, int, pick, type Rng } from '@/core/rng'
import type { MissionFacts } from '@/content/grammar'
import type { WindowManager } from './manager'

/**
 * An ambient file transfer: a bar that fills on its own and closes itself.
 *
 * This is FILE EXFIL, demoted. That panel asked you to click rows to fill
 * progress bars, which is mechanically BRUTE FORCE with filenames on it,
 * and it sat in the same unlock pool as VAULT PULL -- the panel that has
 * dragging, SCAN, PURGE, corrupted files and the contract's objective
 * artifact. Two panels about pulling files off a server, one of which owns
 * the entire mechanic, is a board slot spent on a duplicate.
 *
 * So the *content* survives and the demand goes away: transfers still pop
 * up naming plausible spool files, they still stall and occasionally fail,
 * but they run themselves. "The machine is working for you rather than
 * only at you" -- which is the ambient transfer beat the plan asked for
 * and never got, delivered by deleting a panel rather than adding a
 * system.
 *
 * Non-interactive, exactly like a process window: not registered with the
 * Director, not in any of shell.ts's input-routing lists, so the keystroke
 * plumbing never sees it. A transfer that could eat a keystroke would be a
 * regression of the input-routing fix, not a feature.
 */

const SPOOLS = [
  'payroll_q4',
  'access_matrix',
  'staff_roster',
  'vault_manifest',
  'incident_rpt',
  'keychain',
  'cam_index',
  'badge_db',
  'contracts',
  'board_minutes',
  'wire_log',
  'shift_rota',
] as const

const EXTS = ['sql', 'csv', 'db', 'tar.gz', 'pem', 'log'] as const

/** How the transfer ends. Most land; the rest are honest surprises. */
type Outcome = 'ok' | 'stall' | 'reset'

export function spawnTransferWindow(
  manager: WindowManager,
  facts: MissionFacts,
  rng: Rng,
): void {
  const name = `${pick(rng, SPOOLS)}_${hex(rng, 3)}.${pick(rng, EXTS)}`
  const sizeMb = int(rng, 4, 940)
  // Weighted so the failure modes stay a surprise rather than a tax: a
  // transfer that usually fails would just be noise you learn to ignore.
  const outcome: Outcome = rng() < 0.72 ? 'ok' : rng() < 0.6 ? 'stall' : 'reset'

  const win = manager.spawn(
    { title: `XFER :: ${name}`, modal: false, closable: true, decor: 'normal' },
    'random',
  )
  win.el.classList.add('xfer')

  const body = document.createElement('div')
  body.className = 'xfer__body'

  const src = document.createElement('div')
  src.className = 'xfer__src'
  src.textContent = `${facts.domain}:/var/spool/${name}`

  const bar = document.createElement('div')
  bar.className = 'xfer__bar'
  const fill = document.createElement('div')
  fill.className = 'xfer__fill'
  bar.appendChild(fill)

  const meta = document.createElement('div')
  meta.className = 'xfer__meta'
  const pctEl = document.createElement('span')
  const rateEl = document.createElement('span')
  meta.append(pctEl, rateEl)

  body.append(src, bar, meta)
  win.setBody(body)

  let pct = 0
  // Where a stall/reset bites. Never in the first tenth -- a transfer that
  // dies before it visibly starts reads as a broken window, not a setback.
  const breakAt = int(rng, 24, 88)
  let stalled = false
  let rate = int(rng, 40, 900) / 10

  const timer = setInterval(() => {
    if (stalled) return
    if (outcome !== 'ok' && pct >= breakAt) {
      stalled = true
      if (outcome === 'reset') {
        pct = 0
        fill.style.width = '0%'
        pctEl.textContent = 'CONNECTION RESET'
      } else {
        pctEl.textContent = `STALLED AT ${Math.round(pct)}%`
      }
      rateEl.textContent = '0.0 MB/s'
      win.el.classList.add('is-bad')
      window.setTimeout(() => win.close(), int(rng, 1400, 2600))
      return
    }

    pct = Math.min(100, pct + int(rng, 2, 11))
    // Throughput wanders instead of holding a constant, because a perfectly
    // steady rate is the tell that nothing is really happening.
    rate = Math.max(0.4, rate + (rng() - 0.5) * 6)
    fill.style.width = `${pct}%`
    pctEl.textContent = `${Math.round(pct)}%  ${Math.round((sizeMb * pct) / 100)}/${sizeMb} MB`
    rateEl.textContent = `${rate.toFixed(1)} MB/s`

    if (pct >= 100) {
      clearInterval(timer)
      win.el.classList.add('is-done')
      pctEl.textContent = `COMPLETE  ${sizeMb} MB`
      rateEl.textContent = 'verified'
      window.setTimeout(() => win.close(), int(rng, 1100, 2000))
    }
  }, int(rng, 90, 170))

  win.onClose(() => clearInterval(timer))
}
