import { int, type Rng } from '@/core/rng'
import { docShape, docSrc, pickAvailableDoc, type DocShape } from '@/media/imageRegistry'
import type { WindowManager } from './manager'

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

export function spawnDocWindow(manager: WindowManager, rng: Rng, org: string): boolean {
  const doc = pickAvailableDoc(rng)
  if (!doc) return false

  // The library used to be uniformly 9:16 and this was hardcoded to 1x2.
  // It no longer is -- a landscape screen grab in a tall box letterboxes
  // to a strip barely bigger than the caption under it -- so the window
  // claims the grid shape the actual image wants.
  const shape = docShape(doc)
  const win = manager.spawn(
    {
      title: `RECOVERED :: ${org.toUpperCase()}`,
      modal: false,
      closable: true,
      decor: 'normal',
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
  frame.appendChild(img)

  const cap = document.createElement('div')
  cap.className = 'docwin__caption'
  cap.textContent = `${doc.file}  --  ${doc.label}`

  body.append(frame, cap)
  win.setBody(body)

  const t = setTimeout(() => win.close(), int(rng, 9000, 15000))
  win.onClose(() => clearTimeout(t))
  return true
}
