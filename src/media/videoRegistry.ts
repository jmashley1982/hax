/**
 * Camera / feed clip registry.
 *
 * The clips are dropped into `public/video/` by hand and are NOT bundled --
 * vite.config.ts deliberately keeps media external so the single-file build
 * doesn't balloon into base64. That means at any moment some, all, or none
 * of them may exist, and the game has to be fine in every case.
 *
 * So availability is *probed*, never assumed: each entry is resolved once
 * by actually trying to load it, and anything missing silently falls back
 * to a canvas-rendered synthetic feed (media/syntheticFeed.ts). The result
 * is that this works fully today with zero media files, and every clip that
 * appears in the folder later gets picked up automatically with no code
 * change.
 *
 * Probing uses a <video> element rather than fetch/HEAD on purpose: the
 * build must run from file://, where fetch of a local file is blocked by
 * CORS rules but a media element load is not.
 */

export type FeedKind = 'cctv' | 'webcam' | 'thermal' | 'doorcam'

export interface FeedClip {
  /** Filename inside public/video/. Rename freely -- this list is the only source of truth. */
  file: string
  /** Burned-in camera label. */
  label: string
  kind: FeedKind
}

/**
 * The expected clips. Twenty slots to match the batch being produced --
 * edit the labels/filenames here and nothing else needs to change. Missing
 * files are not an error; they just render synthetically.
 */
export const FEED_CLIPS: readonly FeedClip[] = [
  { file: 'cam-01.mp4', label: 'CAM-01 LOBBY NORTH', kind: 'cctv' },
  { file: 'cam-02.mp4', label: 'CAM-02 LOADING BAY', kind: 'cctv' },
  { file: 'cam-03.mp4', label: 'CAM-03 SERVER HALL', kind: 'cctv' },
  { file: 'cam-04.mp4', label: 'CAM-04 STAIRWELL B', kind: 'cctv' },
  { file: 'cam-05.mp4', label: 'CAM-05 CAR PARK L2', kind: 'cctv' },
  { file: 'cam-06.mp4', label: 'CAM-06 RECEPTION', kind: 'cctv' },
  { file: 'cam-07.mp4', label: 'CAM-07 CORRIDOR 3F', kind: 'cctv' },
  { file: 'cam-08.mp4', label: 'CAM-08 PLANT ROOM', kind: 'cctv' },
  { file: 'cam-09.mp4', label: 'CAM-09 PERIMETER E', kind: 'cctv' },
  { file: 'cam-10.mp4', label: 'CAM-10 ELEVATOR 2', kind: 'cctv' },
  { file: 'cam-11.mp4', label: 'ROOF ACCESS', kind: 'thermal' },
  { file: 'cam-12.mp4', label: 'DOCK GATE', kind: 'thermal' },
  { file: 'cam-13.mp4', label: 'FRONT DOOR', kind: 'doorcam' },
  { file: 'cam-14.mp4', label: 'SIDE ENTRY', kind: 'doorcam' },
  { file: 'cam-15.mp4', label: 'WORKSTATION 04', kind: 'webcam' },
  { file: 'cam-16.mp4', label: 'WORKSTATION 11', kind: 'webcam' },
  { file: 'cam-17.mp4', label: 'LAPTOP / m.okafor', kind: 'webcam' },
  { file: 'cam-18.mp4', label: 'LAPTOP / r.vance', kind: 'webcam' },
  { file: 'cam-19.mp4', label: 'CONF ROOM 2A', kind: 'webcam' },
  { file: 'cam-20.mp4', label: 'HOME OFFICE', kind: 'webcam' },
]

/** Where the files live, relative to index.html (base: './'). */
const VIDEO_DIR = './video/'
const PROBE_TIMEOUT_MS = 2500

type Availability = 'unknown' | 'present' | 'missing'

const availability = new Map<string, Availability>()
const inFlight = new Map<string, Promise<boolean>>()

/**
 * Resolve whether a clip actually exists, once, and cache it.
 *
 * Never rejects, and never logs -- a missing clip is the expected case
 * until the media lands, so it must not read as an error anywhere.
 */
export function probeClip(clip: FeedClip): Promise<boolean> {
  const cached = availability.get(clip.file)
  if (cached === 'present') return Promise.resolve(true)
  if (cached === 'missing') return Promise.resolve(false)

  const existing = inFlight.get(clip.file)
  if (existing) return existing

  const promise = (async (): Promise<boolean> => {
    for (const candidate of candidatesFor(clip.file)) {
      if (await tryLoad(`${VIDEO_DIR}${candidate}`)) {
        resolvedFile.set(clip.file, candidate)
        availability.set(clip.file, 'present')
        inFlight.delete(clip.file)
        return true
      }
    }
    availability.set(clip.file, 'missing')
    inFlight.delete(clip.file)
    return false
  })()

  inFlight.set(clip.file, promise)
  return promise
}

/** Resolves true only if the browser can actually decode the file. Never throws, never logs -- a missing clip is the expected case until media lands. */
function tryLoad(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    let settled = false
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      v.removeAttribute('src')
      v.load()
      resolve(ok)
    }
    v.preload = 'metadata'
    v.muted = true
    v.addEventListener('loadeddata', () => done(true), { once: true })
    v.addEventListener('loadedmetadata', () => done(true), { once: true })
    v.addEventListener('error', () => done(false), { once: true })
    // A load that never resolves either way (seen on some file:// paths)
    // counts as missing rather than hanging the popup forever.
    setTimeout(() => done(false), PROBE_TIMEOUT_MS)
    v.src = src
  })
}

export function clipSrc(clip: FeedClip): string {
  return `${VIDEO_DIR}${resolvedFile.get(clip.file) ?? clip.file}`
}

/**
 * The filename that actually loaded, which may differ from the one listed.
 *
 * FEED_CLIPS lists `.mp4`, but exporting to `.webm` is just as common and
 * expecting someone to re-encode (or hand-edit the manifest) to match an
 * arbitrary default is a pointless obstacle. Each entry falls back to the
 * sibling extension, so dropping in either format just works.
 */
const resolvedFile = new Map<string, string>()

function candidatesFor(file: string): string[] {
  const alt = file.endsWith('.mp4')
    ? file.replace(/\.mp4$/, '.webm')
    : file.endsWith('.webm')
      ? file.replace(/\.webm$/, '.mp4')
      : null
  return alt ? [file, alt] : [file]
}

/** True once at least one real clip has been found this session. */
export function anyClipPresent(): boolean {
  for (const v of availability.values()) if (v === 'present') return true
  return false
}

/** Warm the cache in the background so the first popup doesn't wait on a probe. */
export function preloadAvailability(limit = FEED_CLIPS.length): void {
  // Probe every slot, not just the first few: unprobed clips render
  // synthetically for a beat before swapping, and with a full folder that
  // swap is visible. preload='metadata' means this reads headers, not whole
  // files, so covering all of them is cheap.
  for (const clip of FEED_CLIPS.slice(0, limit)) void probeClip(clip)
}

/**
 * Clips shown recently, newest last.
 *
 * Without this, an unweighted draw happily returns the same feed two or
 * three popups running -- which is exactly how seventeen distinct clips
 * read as "i keep seeing the same one a lot". Same trick the content
 * grammar already uses for text: recently-used entries are skipped until
 * the pool has cycled.
 */
const recentClips: string[] = []
const RECENT_LIMIT = 6

export function pickClip(rand: () => number, kind?: FeedKind | readonly FeedKind[]): FeedClip {
  const kinds = kind === undefined ? null : Array.isArray(kind) ? kind : [kind as FeedKind]
  const byKind = kinds ? FEED_CLIPS.filter((c) => kinds.includes(c.kind)) : FEED_CLIPS
  const base = byKind.length > 0 ? byKind : FEED_CLIPS

  // Prefer clips that are known to actually exist. FEED_CLIPS is a manifest
  // of *slots*, and any slot with no file renders as canvas static -- so
  // drawing blindly from the manifest served a synthetic feed roughly one
  // popup in six once 17 of 20 clips had landed, which reads as a broken
  // window rather than as a fallback. Falls back to the full list only
  // before probing has resolved, or if no clip exists at all.
  const present = base.filter((c) => availability.get(c.file) === 'present')
  const pool = present.length > 0 ? present : base

  const fresh = pool.filter((c) => !recentClips.includes(c.file))
  const list = fresh.length > 0 ? fresh : pool
  const pick = list[Math.floor(rand() * list.length)] ?? FEED_CLIPS[0]!

  recentClips.push(pick.file)
  // Never suppress the whole pool: a two-clip kind (thermal, doorcam) would
  // otherwise empty `fresh` on every draw and lose the benefit entirely.
  const cap = Math.min(RECENT_LIMIT, Math.max(1, pool.length - 1))
  while (recentClips.length > cap) recentClips.shift()
  return pick
}
