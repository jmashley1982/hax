/**
 * Recovered-document images (dropped into public/images/ by hand).
 *
 * Same contract as the camera clips: the files may not exist yet, may
 * arrive one at a time, and must never produce an error or an empty
 * window. Availability is probed once per entry with an Image() load --
 * not fetch/HEAD, which is blocked for local files under file://.
 */

/**
 * What KIND of recovered media this is, in-fiction. Drives the popup's
 * title, which layers draw it more often (see sim/layers.ts imageMix), and
 * nothing else -- the probe/shape/pick machinery below treats every
 * category identically.
 *
 *   document   paper trail. memos, ledgers, letters, microfilm.
 *   recon      amateur field photography of the target's physical plant.
 *   location   the building itself -- exteriors, lobbies, boardrooms.
 *   corporate  the target's own polish -- stock photography, reports.
 */
export type ImageCategory = 'document' | 'recon' | 'location' | 'corporate'

export interface DocImage {
  file: string
  /** Caption burned into the popup, framed as provenance. */
  label: string
  category: ImageCategory
}

/**
 * Slots, not a hand-maintained list of what exists.
 *
 * Every entry is probed and any that is missing is silently skipped, so
 * the count here is a *ceiling* on how many images the game can use --
 * dropping a new file into public/images/ and adding one line here is the
 * entire installation procedure.
 */
export const DOC_IMAGES: readonly DocImage[] = [
  { file: 'docs-01.png', label: 'recovered from /var/backups', category: 'document' },
  { file: 'docs-02.png', label: 'attachment :: internal mail spool', category: 'document' },
  { file: 'docs-03.png', label: 'scanned :: records room', category: 'document' },
  { file: 'docs-04.png', label: 'recovered from a deleted share', category: 'document' },
  { file: 'docs-05.png', label: 'attachment :: legal hold archive', category: 'document' },
  { file: 'docs-06.png', label: 'pulled from an executive laptop', category: 'document' },
  { file: 'docs-07.png', label: 'recovered :: badge system export', category: 'document' },
  { file: 'docs-08.png', label: 'attachment :: vendor correspondence', category: 'document' },
  { file: 'docs-09.png', label: 'scanned :: physical file cabinet', category: 'document' },
  { file: 'docs-10.png', label: 'recovered :: finance share', category: 'document' },
  { file: 'docs-11.png', label: 'screen capture :: engineering workstation', category: 'document' },
  { file: 'docs-12.png', label: 'attachment :: procurement thread', category: 'document' },
  { file: 'docs-13.png', label: 'recovered from a wiped laptop', category: 'document' },
  { file: 'docs-14.png', label: 'scanned :: site drawing set', category: 'document' },
  { file: 'docs-15.png', label: 'pulled from a shared drive', category: 'document' },
  { file: 'docs-16.png', label: 'attachment :: board correspondence', category: 'document' },
  { file: 'docs-17.png', label: 'recovered :: access control export', category: 'document' },
  { file: 'docs-18.png', label: 'photographed :: desk, out of hours', category: 'document' },
  { file: 'docs-19.png', label: 'scanned :: shipping manifests', category: 'document' },
  { file: 'docs-20.png', label: 'recovered from an offsite backup', category: 'document' },
  { file: 'docs-21.png', label: 'screen capture :: operations console', category: 'document' },
  { file: 'docs-22.png', label: 'attachment :: personnel file', category: 'document' },
  { file: 'docs-23.png', label: 'recovered :: contractor handover', category: 'document' },
  { file: 'docs-24.png', label: 'photographed :: whiteboard, floor 3', category: 'document' },

  // -- document: paper trail, ledgers, letters, microfilm -----------------
  { file: 'doc-25-redacted-memo.jpg', label: 'recovered :: internal memo, redacted', category: 'document' },
  { file: 'doc-26-newspaper-clipping.jpg', label: 'clipped and taped :: someone was tracking this', category: 'document' },
  { file: 'doc-27-circled-list.jpg', label: 'photographed :: a list, marked up by hand', category: 'document' },
  { file: 'doc-28-certified-mail-receipt.jpg', label: 'scanned :: certified mail receipt', category: 'document' },
  { file: 'doc-29-microfilm-reader.jpg', label: 'photographed :: microfilm reader, records room', category: 'document' },
  { file: 'doc-30-microfiche-card.jpg', label: 'recovered :: archived microfiche card', category: 'document' },
  { file: 'doc-31-disbursements-ledger.jpg', label: 'scanned :: disbursements ledger, redacted', category: 'document' },
  { file: 'doc-32-redacted-form-stained.jpg', label: 'photocopy :: heavily redacted, coffee ring and all', category: 'document' },
  { file: 'doc-33-denial-letter.jpg', label: 'scanned :: a formal denial letter', category: 'document' },
  { file: 'doc-34-circled-menu.jpg', label: 'photographed :: something circled in red, not a menu', category: 'document' },

  // -- recon: amateur field photography of the physical plant -------------
  { file: 'recon-01-junction-box.jpg', label: 'field photo :: junction box, rear of site', category: 'recon' },
  { file: 'recon-02-tape-box.jpg', label: 'field photo :: a box of old tapes, dead drop', category: 'recon' },
  { file: 'recon-03-dead-air-screen.jpg', label: 'shot from a parked car :: dead air on their feed', category: 'recon' },
  { file: 'recon-04-rack-label.jpg', label: 'field photo :: server rack, hand-labelled', category: 'recon' },
  { file: 'recon-05-loading-dock-pallet.jpg', label: 'field photo :: loading dock, unmarked pallet', category: 'recon' },
  { file: 'recon-06-rooftop-dish.jpg', label: 'field photo :: their dish, rooftop access', category: 'recon' },
  { file: 'recon-07-building-at-night.jpg', label: 'shot from a parked car :: the building, after hours', category: 'recon' },
  { file: 'recon-08-empty-meeting-room.jpg', label: 'field photo :: an empty room, taken in a hurry', category: 'recon' },
  { file: 'recon-09-blank-plaque.jpg', label: 'field photo :: the plaque by the side door', category: 'recon' },
  { file: 'recon-10-fiber-trench.jpg', label: 'field photo :: their fiber, freshly trenched', category: 'recon' },
  { file: 'recon-11-utility-cabinet.jpg', label: 'field photo :: utility cabinet, left unlocked', category: 'recon' },
  { file: 'recon-12-tape-archive-shelf.jpg', label: 'field photo :: their whole tape archive', category: 'recon' },
  { file: 'recon-13-van-fleet.jpg', label: 'shot from a parked car :: their fleet, idling', category: 'recon' },
  { file: 'recon-14-loading-door-keypad.jpg', label: 'field photo :: the keypad on the loading door', category: 'recon' },

  // -- location: the building itself, target identity ----------------------
  { file: 'location-01-exterior-office.jpg', label: 'street view :: registered address', category: 'location' },
  { file: 'location-02-exterior-stirling.jpg', label: 'street view :: the front entrance', category: 'location' },
  { file: 'location-03-reception.jpg', label: 'their lobby. cameras at 10 and 2', category: 'location' },
  { file: 'location-04-office-corner.jpg', label: 'inside, upper floor', category: 'location' },
  { file: 'location-05-boardroom-wide.jpg', label: 'the boardroom, empty for now', category: 'location' },

  // -- corporate: the target's own polish -----------------------------------
  { file: 'corp-01-meeting-review.jpg', label: 'their own press kit', category: 'corporate' },
  { file: 'corp-02-investment-report.jpg', label: 'pulled from the annual report', category: 'corporate' },
]

/** All entries belonging to one category. */
export function docsByCategory(category: ImageCategory): readonly DocImage[] {
  return DOC_IMAGES.filter((d) => d.category === category)
}

/**
 * Which grid shape a document's window should claim.
 *
 * MEASURED from the loaded image rather than declared per entry, because
 * the images are dropped in by hand and a declared aspect would be a
 * second thing to remember and a first thing to get wrong. The probe
 * already constructs an Image() and waits for it to load, so the natural
 * dimensions are free.
 */
export type DocShape = 'portrait' | 'landscape' | 'square'

const shapes = new Map<string, DocShape>()

function classify(w: number, h: number): DocShape {
  if (h <= 0 || w <= 0) return 'portrait'
  const r = w / h
  // Generous middle band: a 4:3 photo is not meaningfully "landscape" at
  // popup size, and forcing it into a 2-wide window wastes a whole slot.
  if (r > 1.2) return 'landscape'
  if (r < 0.85) return 'portrait'
  return 'square'
}

/** The shape of a known-present image. Portrait is the safe default. */
export function docShape(doc: DocImage): DocShape {
  return shapes.get(doc.file) ?? 'portrait'
}

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

function tryLoad(src: string, slot: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    let settled = false
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    img.addEventListener(
      'load',
      () => {
        // The one moment the real dimensions are known for free.
        shapes.set(slot, classify(img.naturalWidth, img.naturalHeight))
        done(true)
      },
      { once: true },
    )
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
      if (await tryLoad(DIR + c, doc.file)) {
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

/**
 * Documents shown recently, newest last -- kept PER CATEGORY.
 *
 * The camera clips got this treatment when nine distinct clips were
 * reading as "the same one over and over"; the images never did, and it
 * showed the moment they started appearing at a real rate -- five
 * document popups in one run drew from exactly two files
 * (09, 05, 09, 05, 09). Same fix: skip what was just shown until the pool
 * has cycled. Split by category so a run of `document` draws cannot starve
 * `location`'s own suppression list into uselessness -- each category
 * cycles on its own clock.
 */
const recentDocs = new Map<ImageCategory, string[]>()
const RECENT_LIMIT = 5

/**
 * Any image known to exist, or null if none have landed yet.
 *
 * `categories` narrows the draw to one or more categories (e.g. a boot
 * dossier wants `['location']` only); omitted, any present image is fair
 * game. A category with nothing present yet is simply empty, not an error.
 */
export function pickAvailableDoc(
  rand: () => number,
  categories?: readonly ImageCategory[],
): DocImage | null {
  const present = DOC_IMAGES.filter(
    (d) => availability.get(d.file) === true && (!categories || categories.includes(d.category)),
  )
  if (present.length === 0) return null

  // Recency is scoped to whichever categories this draw is allowed to pick
  // from, not the whole library -- a `['location']` draw must not be
  // suppressed by a document that was shown a moment ago.
  const recentPool = new Set(
    (categories ?? ([...new Set(present.map((d) => d.category))] as ImageCategory[])).flatMap(
      (c) => recentDocs.get(c) ?? [],
    ),
  )
  const fresh = present.filter((d) => !recentPool.has(d.file))
  const pool = fresh.length > 0 ? fresh : present
  const pick = pool[Math.floor(rand() * pool.length)] ?? null
  if (!pick) return null

  const bucket = recentDocs.get(pick.category) ?? []
  bucket.push(pick.file)
  // Never suppress a whole category's pool -- with only two images present
  // in it, a limit of five would empty `fresh` on every draw and achieve
  // nothing.
  const categoryPresent = present.filter((d) => d.category === pick.category).length
  const cap = Math.min(RECENT_LIMIT, Math.max(1, categoryPresent - 1))
  while (bucket.length > cap) bucket.shift()
  recentDocs.set(pick.category, bucket)
  return pick
}
