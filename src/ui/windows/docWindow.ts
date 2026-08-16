import { int, type Rng } from '@/core/rng'
import {
  docShape,
  docSrc,
  pickAvailableDoc,
  type DocShape,
  type ImageCategory,
} from '@/media/imageRegistry'
import { showMediaOverlay } from '@/ui/mediaOverlay'
import type { WindowManager } from './manager'

/** Title framing per category -- what kind of find this reads as. */
const TITLE_BY_CATEGORY: Record<ImageCategory, string> = {
  document: 'RECOVERED',
  recon: 'FIELD PHOTO',
  location: 'SITE RECON',
  corporate: 'OSINT',
}

/**
 * A document recovered off the target's servers.
 *
 * Unlike the camera popups there is no synthetic fallback: a fake
 * "document" would just be a grey rectangle, which reads as a broken
 * window rather than as content. So this simply does not open unless a
 * real image is known to exist -- callers get `false` back and nothing
 * happens, which keeps the build clean before any images land.
 */
/**
 * Grid cost per image shape. Slot pitch is 268x228, so a landscape photo
 * needs two columns to reach a sane width and a portrait one needs two
 * rows to reach a sane height.
 */
const SPAN_BY_SHAPE: Record<DocShape, { cols: number; rows: number }> = {
  portrait: { cols: 1, rows: 2 },
  landscape: { cols: 2, rows: 1 },
  square: { cols: 1, rows: 1 },
}

/**
 * @param categories Narrow the draw to specific categories (e.g. the
 *   reverse-hack recon beat forces `['recon']`). Omitted, any present
 *   image is fair game -- callers ambient-spawning off a layer's mix pass
 *   the category `pickImageCategory` already rolled.
 * @param decor Passed straight through to the window -- 'danger' is what
 *   lets the reverse-hack beat read as hostile chrome, not a normal find.
 */
export function spawnDocWindow(
  manager: WindowManager,
  rng: Rng,
  org: string,
  categories?: readonly ImageCategory[],
  decor: 'normal' | 'danger' = 'normal',
): boolean {
  const doc = pickAvailableDoc(rng, categories)
  if (!doc) return false

  // The library used to be uniformly 9:16 and this was hardcoded to 1x2.
  // It no longer is -- a landscape screen grab in a tall box letterboxes
  // to a strip barely bigger than the caption under it -- so the window
  // claims the grid shape the actual image wants.
  const shape = docShape(doc)
  const win = manager.spawn(
    {
      title: `${TITLE_BY_CATEGORY[doc.category]} :: ${org.toUpperCase()}`,
      modal: false,
      closable: true,
      decor,
      span: SPAN_BY_SHAPE[shape],
    },
    'random',
  )
  win.el.classList.add('docwin', `docwin--${shape}`)

  const body = document.createElement('div')
  body.className = 'docwin__body'

  const frame = document.createElement('div')
  frame.className = 'docwin__frame'
  const img = document.createElement('img')
  img.className = 'docwin__img'
  img.src = docSrc(doc)
  img.alt = ''
  // Probed already, but a decode failure here must not leave an empty box.
  img.addEventListener('error', () => win.close(), { once: true })
  // The lightbox: the small popup is not the only way to see this image.
  img.addEventListener('click', () => {
    const mount = document.querySelector('.shell') as HTMLElement | null
    if (!mount) return
    showMediaOverlay(mount, {
      src: docSrc(doc),
      caption: doc.label,
      kicker: TITLE_BY_CATEGORY[doc.category],
      rng,
    })
  })
  frame.appendChild(img)

  const cap = document.createElement('div')
  cap.className = 'docwin__caption'
  // Just the label -- a raw filename like `recon-07-building-at-night.jpg`
  // in the caption breaks the fiction the label exists to build.
  cap.textContent = doc.label

  body.append(frame, cap)
  win.setBody(body)

  const t = setTimeout(() => win.close(), int(rng, 9000, 15000))
  win.onClose(() => clearTimeout(t))
  return true
}
