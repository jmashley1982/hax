/**
 * The montage behind the ending banner.
 *
 * Every run used to end on three lines of text over a dark scrim, gone in
 * under four seconds -- the cheapest-looking screen in a game that had
 * spent the whole run building a 69-image library. This spends that
 * library on the one moment it was always for.
 *
 * What it shows depends on how the run ended, because a loss should land
 * as hard as a win:
 *
 *   clean   the paper you took, and the building you took it from.
 *   burned  THEIR photographs of YOU -- the junction box you tapped, the
 *           car you sat in. The same recon shots the reverse-hack beat
 *           uses to say "we see you", now entered as evidence.
 *
 * Deliberately not a `showMediaOverlay`: that is single-instance,
 * self-dismissing on any keypress, and framed with caption chrome. This is
 * a full-bleed backdrop that lives and dies with the banner it decorates.
 */
import { pickAvailableDoc, docSrc, type DocImage, type ImageCategory } from '@/media/imageRegistry'
import type { Rng } from '@/core/rng'

export type EndingTone = 'clean' | 'burned'

/**
 * Which categories each ending draws from, in preference order.
 *
 * Both tones end on `location` so the last frame is always a place --
 * cutting from paper or surveillance to the building reads as the camera
 * pulling back, and it is the one category guaranteed to be landscape.
 */
const TONE_CATEGORIES: Record<EndingTone, readonly ImageCategory[]> = {
  clean: ['document', 'document', 'location', 'location'],
  burned: ['recon', 'recon', 'recon', 'location'],
}

export interface EndingMontageOptions {
  rng: Rng
  tone: EndingTone
  /** How many frames to try for. Fewer are used if the library is thin. */
  frames?: number
  /** How long each frame holds before the next crossfades in. */
  frameMs?: number
  /**
   * Shell's tracked `later`, NOT a bare setTimeout. `destroy()` only
   * cancels timers in `this.pending`, so an untracked frame schedule would
   * keep firing into a torn-down session -- the exact latent leak the
   * banner's own removal timer already has.
   */
  later: (fn: () => void, ms: number) => void
}

/**
 * Mount the montage into `host` (the ending banner element).
 *
 * Silently mounts nothing when no images are available. That is the same
 * contract the breakthrough backdrop and the boot dossier keep: media is
 * always optional, and a missing library degrades to the plain text
 * ending rather than an error or an empty frame.
 */
export function mountEndingMontage(host: HTMLElement, opts: EndingMontageOptions): void {
  const frames = opts.frames ?? 4
  const frameMs = opts.frameMs ?? 1150
  const picks = pickFrames(opts.rng, opts.tone, frames)
  if (picks.length === 0) return

  const strip = document.createElement('div')
  strip.className = 'ending-montage'

  picks.forEach((doc, i) => {
    const img = document.createElement('img')
    img.className = 'ending-montage__frame'
    img.src = docSrc(doc)
    img.alt = ''
    // The first frame is up with the banner; the rest are cued. Every
    // image here is already known-present (pickAvailableDoc only returns
    // probed files), so this is a reveal schedule, not a load race.
    if (i === 0) img.classList.add('is-on')
    else opts.later(() => img.classList.add('is-on'), i * frameMs)
    strip.appendChild(img)
  })

  host.appendChild(strip)
}

/**
 * Distinct images for the montage, in tone order.
 *
 * `pickAvailableDoc` keeps its own per-category recency list, so asking it
 * repeatedly can hand back a repeat once a thin category is exhausted --
 * de-duping here means a two-image `recon` folder yields a two-frame
 * montage instead of the same photo flashing four times.
 */
function pickFrames(rng: Rng, tone: EndingTone, want: number): DocImage[] {
  const wanted = TONE_CATEGORIES[tone]
  const out: DocImage[] = []
  const seen = new Set<string>()

  for (let i = 0; i < want; i++) {
    const category = wanted[Math.min(i, wanted.length - 1)]
    const doc = pickAvailableDoc(rng, category ? [category] : undefined)
    if (doc && !seen.has(doc.file)) {
      seen.add(doc.file)
      out.push(doc)
    }
  }

  // A thin category should borrow rather than end the montage early: fall
  // back to the whole library to top up, still de-duped.
  for (let guard = 0; out.length < want && guard < want * 3; guard++) {
    const doc = pickAvailableDoc(rng)
    if (!doc) break
    if (seen.has(doc.file)) continue
    seen.add(doc.file)
    out.push(doc)
  }

  return out
}
