import { int, type Rng } from '@/core/rng'
import { playSfx } from '@/audio/sounds'

/**
 * The cinematic beat: one recovered image, full-screen, for a few seconds.
 *
 * Every other media surface in this game is a small desktop popup -- see
 * ui/windows/docWindow.ts and camWindow.ts, both capped at a few hundred
 * pixels because they are ambient texture among a dozen other windows.
 * This is the opposite: the ONE thing worth stopping to look at, drawn
 * over everything, held long enough to land.
 *
 * Deliberately NOT a Win. It never touches WindowManager, never counts
 * against BoardBudget, and is appended straight to the shell element --
 * the same pattern showBreakthroughCard/showEndingBanner already use for
 * a beat that owns the whole screen for a moment.
 *
 * Deliberately does NOT capture the keyboard. The gate scrim it borrows
 * its visual language from is the one thing in this game that freezes
 * input on purpose; this is not that. A keystroke that dismisses the
 * overlay must still reach Shell.handleKey on the same frame, or mashing
 * through a "you found something" beat would read as the game eating a
 * keystroke -- exactly the dead spot the whole project exists to avoid.
 */

export interface MediaOverlayOptions {
  src: string
  caption: string
  /** Short label above the image, e.g. "ARTIFACT LOCATED". */
  kicker: string
  rng: Rng
  onDone?: () => void
}

/** At most one on screen -- a second request while one is up is dropped. */
let active: HTMLElement | null = null

export function showMediaOverlay(mount: HTMLElement, opts: MediaOverlayOptions): void {
  if (active) return
  playSfx('winOpen')

  const el = document.createElement('div')
  el.className = 'media-overlay'

  const frame = document.createElement('div')
  frame.className = 'media-overlay__frame'

  const kicker = document.createElement('div')
  kicker.className = 'media-overlay__kicker'
  kicker.textContent = opts.kicker.toUpperCase()

  const imgWrap = document.createElement('div')
  imgWrap.className = 'media-overlay__imgwrap'
  const img = document.createElement('img')
  img.className = 'media-overlay__img'
  img.src = opts.src
  img.alt = ''
  // A decode failure must close the beat, not leave a blank frame sitting
  // over the board for its full duration.
  img.addEventListener('error', () => close(), { once: true })
  imgWrap.appendChild(img)

  const scan = document.createElement('div')
  scan.className = 'media-overlay__decrypt'
  scan.textContent = 'DECRYPTING...'

  const caption = document.createElement('div')
  caption.className = 'media-overlay__caption'
  caption.textContent = opts.caption

  frame.append(kicker, imgWrap, scan, caption)
  el.appendChild(frame)
  mount.appendChild(el)
  active = el

  let closed = false
  const timer = setTimeout(close, int(opts.rng, 2800, 3800))

  function close(): void {
    if (closed) return
    closed = true
    clearTimeout(timer)
    window.removeEventListener('keydown', onKey)
    el.removeEventListener('pointerdown', onPointer)
    el.classList.add('is-closing')
    setTimeout(() => el.remove(), 220)
    if (active === el) active = null
    opts.onDone?.()
  }

  // Non-capturing, and never calls preventDefault/stopPropagation -- the
  // same keystroke that closes this also has to reach Shell.handleKey.
  function onKey(): void {
    close()
  }
  function onPointer(): void {
    close()
  }
  window.addEventListener('keydown', onKey)
  el.addEventListener('pointerdown', onPointer)
}

/** Whether a beat is currently up -- callers use this to avoid stacking requests. */
export function mediaOverlayActive(): boolean {
  return active !== null
}
