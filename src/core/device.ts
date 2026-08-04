/**
 * Layout mode.
 *
 * The desktop build is built around a physical keyboard (mashing keys is
 * the core input) and a wide screen of floating, draggable windows.
 * Neither exists on a phone, so the app switches to a genuinely different
 * layout + input model rather than just shrinking -- see styles/mobile.css
 * and ui/touch.ts.
 *
 * Detection is capability + size based, never UA sniffing: a coarse
 * pointer (finger) OR a narrow viewport gets the touch layout, so it also
 * kicks in correctly for a narrow desktop window or a tablet, and it
 * re-evaluates live on resize/rotate.
 */
export type LayoutMode = 'desktop' | 'mobile'

const NARROW_PX = 820

function detect(): LayoutMode {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const narrow = window.innerWidth < NARROW_PX
  return coarse || narrow ? 'mobile' : 'desktop'
}

let current: LayoutMode = detect()

export function layoutMode(): LayoutMode {
  return current
}

export function isMobileLayout(): boolean {
  return current === 'mobile'
}

/**
 * Applies the mode to <html data-layout> (which is what mobile.css keys
 * off) and keeps it in sync. `onChange` fires only on an actual mode flip,
 * so callers can rebuild the bits that can't restyle themselves.
 */
/**
 * Rewrites input verbs for the touch build.
 *
 * The panel/objective copy is written for a mouse and keyboard ("CLICK
 * the open ports", "mash keys to force the key"). On a phone those are
 * instructions to do something the device can't do. Doing this as one
 * substitution at the render points beats editing a dozen scattered
 * string literals with inline conditionals -- new copy picks it up for
 * free instead of silently shipping desktop wording.
 */
const TOUCH_VERBS: ReadonlyArray<readonly [RegExp, string]> = [
  [/HOLD\/MASH ANY KEYS/g, 'HOLD THE BREACH PAD'],
  [/mash keys/gi, 'hold BREACH'],
  [/\bCLICK\b/g, 'TAP'],
  [/\bClick\b/g, 'Tap'],
  [/\bclick\b/g, 'tap'],
  [/\bDRAG\b/g, 'SLIDE'],
  [/\bdrag\b/g, 'slide'],
]

export function inputVerbs(text: string): string {
  if (current !== 'mobile') return text
  return TOUCH_VERBS.reduce((s, [re, to]) => s.replace(re, to), text)
}

export function initLayoutMode(onChange?: (mode: LayoutMode) => void): LayoutMode {
  const apply = (): void => {
    const next = detect()
    if (next === current && document.documentElement.dataset.layout) return
    current = next
    document.documentElement.dataset.layout = next
    onChange?.(next)
  }
  apply()
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  return current
}
