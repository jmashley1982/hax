import { int, type Rng } from '@/core/rng'
import { docSrc, pickAvailableDoc } from '@/media/imageRegistry'
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
export function spawnDocWindow(manager: WindowManager, rng: Rng, org: string): boolean {
  const doc = pickAvailableDoc(rng)
  if (!doc) return false

  const win = manager.spawn(
    { title: `RECOVERED :: ${org.toUpperCase()}`, modal: false, closable: true, decor: 'normal' },
    'random',
  )
  win.el.classList.add('docwin')

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
