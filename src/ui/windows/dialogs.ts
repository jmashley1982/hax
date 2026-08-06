import type { WindowManager } from './manager'
import { Win } from './window'

/** Visual countdown bar; calls onExpire once, and stops if the window closes first. */
function attachCountdown(win: Win, durationMs: number, onExpire: () => void): void {
  const wrap = document.createElement('div')
  wrap.className = 'win__countdown'
  const bar = document.createElement('div')
  bar.className = 'win__countdown-bar'
  wrap.appendChild(bar)
  win.body.appendChild(wrap)
  requestAnimationFrame(() => {
    bar.style.transition = `transform ${durationMs}ms linear`
    bar.style.transform = 'scaleX(0)'
  })
  const timer = setTimeout(onExpire, durationMs)
  win.onClose(() => clearTimeout(timer))
}

/**
 * Any keystroke inside a dialog's own input must not also reach the global
 * listeners (ui/prompt.ts's command buffer, the Tab mode-switch hotkey) --
 * stopPropagation here is what keeps "typing a passcode" from also typing
 * into the ambient command line underneath it.
 */
function isolateKeys(el: HTMLElement): void {
  el.addEventListener('keydown', (e) => e.stopPropagation())
}

export interface AuthPromptOptions {
  title: string
  prompt: string
  hint?: string
  timeoutMs?: number
  onResult: (result: 'accept' | 'cancel' | 'timeout', value?: string) => void
}

/** A passcode / access-code modal. Phase 4 accepts any non-empty entry -- real validation lands with Phase 6's minigames. */
export function spawnAuthPrompt(manager: WindowManager, opts: AuthPromptOptions): Win {
  const win = manager.spawn({ title: opts.title, modal: true, closable: false, decor: 'normal' }, 'center')

  const body = document.createElement('div')
  const p = document.createElement('p')
  p.textContent = opts.prompt
  body.appendChild(p)
  if (opts.hint) {
    const hint = document.createElement('p')
    hint.style.color = 'var(--fg-dim)'
    hint.style.fontSize = '11px'
    hint.textContent = opts.hint
    body.appendChild(hint)
  }
  const input = document.createElement('input')
  input.className = 'win__input'
  input.type = 'text'
  input.placeholder = 'ACCESS CODE'
  input.autocomplete = 'off'
  input.spellcheck = false
  isolateKeys(input)
  body.appendChild(input)
  win.setBody(body)

  let resolved = false
  const finish = (result: 'accept' | 'cancel' | 'timeout', value?: string) => {
    if (resolved) return
    resolved = true
    opts.onResult(result, value)
    win.close()
  }

  win.addButtonRow([
    { label: 'SUBMIT', onClick: () => finish(input.value.trim() ? 'accept' : 'cancel', input.value.trim()) },
    { label: 'ABORT', onClick: () => finish('cancel') },
  ])
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) finish('accept', input.value.trim())
  })
  setTimeout(() => input.focus(), 50)

  if (opts.timeoutMs) attachCountdown(win, opts.timeoutMs, () => finish('timeout'))
  return win
}

export interface ChoiceOption {
  label: string
  onSelect: () => void
}

export interface ChoicePromptOptions {
  title: string
  prompt: string
  options: ChoiceOption[]
  decor?: 'normal' | 'danger'
  timeoutMs?: number
  onTimeout?: () => void
}

/** A "pick one of N" decision modal. No wrong answer ends the run -- every option just leads somewhere different. */
export function spawnChoicePrompt(manager: WindowManager, opts: ChoicePromptOptions): Win {
  const win = manager.spawn(
    { title: opts.title, modal: true, closable: false, decor: opts.decor ?? 'normal' },
    'center',
  )
  const body = document.createElement('div')
  const p = document.createElement('p')
  p.textContent = opts.prompt
  body.appendChild(p)
  win.setBody(body)

  let resolved = false
  win.addButtonRow(
    opts.options.map((o) => ({
      label: o.label,
      onClick: () => {
        if (resolved) return
        resolved = true
        o.onSelect()
        win.close()
      },
    })),
  )

  if (opts.timeoutMs) {
    attachCountdown(win, opts.timeoutMs, () => {
      if (resolved) return
      resolved = true
      opts.onTimeout?.()
      win.close()
    })
  }
  return win
}

export interface WarningDialogOptions {
  title: string
  message: string
  ttlMs?: number
}

/** A non-modal, self-dismissing alert -- an IDS trip, a system notice. Never blocks play. */
export function spawnWarningDialog(manager: WindowManager, opts: WarningDialogOptions): Win {
  const win = manager.spawn(
    { title: opts.title, modal: false, closable: true, decor: 'danger', priority: true },
    'random',
  )
  win.setBody(opts.message)
  if (opts.ttlMs) setTimeout(() => win.close(), opts.ttlMs)
  return win
}
