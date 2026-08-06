/**
 * Recovered-document images (dropped into public/images/ by hand).
 *
 * Same contract as the camera clips: the files may not exist yet, may
 * arrive one at a time, and must never produce an error or an empty
 * window. Availability is probed once per entry with an Image() load --
 * not fetch/HEAD, which is blocked for local files under file://.
 */

export interface DocImage {
  file: string
  /** Caption burned into the popup, framed as provenance. */
  label: string
}

export const DOC_IMAGES: readonly DocImage[] = [
  { file: 'docs-01.png', label: 'recovered from /var/backups' },
  { file: 'docs-02.png', label: 'attachment :: internal mail spool' },
  { file: 'docs-03.png', label: 'scanned :: records room' },
  { file: 'docs-04.png', label: 'recovered from a deleted share' },
  { file: 'docs-05.png', label: 'attachment :: legal hold archive' },
  { file: 'docs-06.png', label: 'pulled from an executive laptop' },
  { file: 'docs-07.png', label: 'recovered :: badge system export' },
  { file: 'docs-08.png', label: 'attachment :: vendor correspondence' },
  { file: 'docs-09.png', label: 'scanned :: physical file cabinet' },
]

const DIR = './images/'
const PROBE_TIMEOUT_MS = 2500

const availability = new Map<string, boolean>()
const resolvedFile = new Map<string, string>()
const inFlight = new Map<string, Promise<boolean>>()

function candidates(file: string): string[] {
  const alt = file.endsWith('.png')
    ? file.replace(/\.png$/, '.jpg')
    : file.endsWith('.jpg')
      ? file.replace(/\.jpg$/, '.png')
      : null
  return alt ? [file, alt] : [file]
}

function tryLoad(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    let settled = false
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    img.addEventListener('load', () => done(true), { once: true })
    img.addEventListener('error', () => done(false), { once: true })
    setTimeout(() => done(false), PROBE_TIMEOUT_MS)
    img.src = src
  })
}

export function probeDoc(doc: DocImage): Promise<boolean> {
  const cached = availability.get(doc.file)
  if (cached !== undefined) return Promise.resolve(cached)
  const existing = inFlight.get(doc.file)
  if (existing) return existing

  const p = (async (): Promise<boolean> => {
    for (const c of candidates(doc.file)) {
      if (await tryLoad(DIR + c)) {
        resolvedFile.set(doc.file, c)
        availability.set(doc.file, true)
        inFlight.delete(doc.file)
        return true
      }
    }
    availability.set(doc.file, false)
    inFlight.delete(doc.file)
    return false
  })()
  inFlight.set(doc.file, p)
  return p
}

export function docSrc(doc: DocImage): string {
  return DIR + (resolvedFile.get(doc.file) ?? doc.file)
}

/** Warm the cache so the first popup doesn't wait on a probe. */
export function preloadDocs(): void {
  for (const d of DOC_IMAGES) void probeDoc(d)
}

/** Any image known to exist, or null if none have landed yet. */
export function pickAvailableDoc(rand: () => number): DocImage | null {
  const present = DOC_IMAGES.filter((d) => availability.get(d.file) === true)
  if (present.length === 0) return null
  return present[Math.floor(rand() * present.length)] ?? null
}
