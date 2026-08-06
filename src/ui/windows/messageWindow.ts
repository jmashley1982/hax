import { int, pick, type Rng } from '@/core/rng'
import { ALLY_HANDLES, ALLY_TIPS, OPERATOR_TAUNTS, type MessageLine } from '@/content/banks/messages'
import type { WindowManager } from './manager'

/**
 * Chat pop-ups from the two human channels (plan §16G / §16H).
 *
 * Kept small, self-closing and non-interactive so they never compete with
 * the board for input -- they are read, not played. Styling is what
 * separates them: the target's staff arrive in hostile red, allies in a
 * friendly accent, so which channel is talking is obvious before you read
 * a word.
 */

export interface OperatorMsgOptions {
  manager: WindowManager
  rng: Rng
  org: string
  handle: string
  /** 0-3, rising with depth and heat. */
  tier: number
}

function fill(text: string, org: string, handle: string, code = ''): string {
  return text.replace(/\{org\}/g, org).replace(/\{handle\}/g, handle).replace(/\{code\}/g, code)
}

function spawnChat(
  manager: WindowManager,
  cls: string,
  channel: string,
  line: MessageLine,
  ttl: number,
  /** An ally handing over a code is actionable and must not be buried. */
  priority = false,
): void {
  const win = manager.spawn(
    {
      title: channel,
      modal: false,
      closable: true,
      decor: cls === 'msg--op' ? 'danger' : 'normal',
      priority,
    },
    'random',
  )
  win.el.classList.add('msgwin', cls)

  const body = document.createElement('div')
  body.className = 'msgwin__body'

  const from = document.createElement('div')
  from.className = 'msgwin__from'
  from.textContent = line.from

  const text = document.createElement('div')
  text.className = 'msgwin__text'
  text.textContent = line.text

  body.append(from, text)
  win.setBody(body)

  const t = setTimeout(() => win.close(), ttl)
  win.onClose(() => clearTimeout(t))
}

/** The target's staff, escalating from curious to personal. */
export function spawnOperatorMessage(opts: OperatorMsgOptions): void {
  const tier = Math.max(0, Math.min(OPERATOR_TAUNTS.length - 1, opts.tier))
  const pool = OPERATOR_TAUNTS[tier] ?? OPERATOR_TAUNTS[0]!
  const raw = pick(opts.rng, pool)
  spawnChat(
    opts.manager,
    'msg--op',
    `MSG :: ${opts.org.toUpperCase()}`,
    { from: fill(raw.from, opts.org, opts.handle), text: fill(raw.text, opts.org, opts.handle) },
    int(opts.rng, 7000, 11000),
  )
}

export type AllyTipKind = keyof typeof ALLY_TIPS

export interface AllyMsgOptions {
  manager: WindowManager
  rng: Rng
  org: string
  kind: AllyTipKind
  /** A code the player can actually use later, when the tip carries one. */
  code?: string
}

/**
 * Another hacker, arriving *before* the thing they are warning about.
 * Returns the handle that sent it so the caller can log it.
 */
export function spawnAllyMessage(opts: AllyMsgOptions): string {
  const handle = pick(opts.rng, ALLY_HANDLES)
  const raw = pick(opts.rng, ALLY_TIPS[opts.kind] as readonly string[])
  spawnChat(
    opts.manager,
    'msg--ally',
    `MSG :: ${handle}`,
    { from: `${handle}@relay`, text: fill(raw, opts.org, '', opts.code ?? '') },
    int(opts.rng, 9000, 13000),
    // A tip carrying a real code is the one message that changes what the
    // player should do next.
    Boolean(opts.code),
  )
  return handle
}
