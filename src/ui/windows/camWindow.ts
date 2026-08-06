import { int, type Rng } from '@/core/rng'
import { SyntheticFeed } from '@/media/syntheticFeed'
import { clipSrc, pickClip, probeClip, type FeedClip, type FeedKind } from '@/media/videoRegistry'
import type { WindowManager } from './manager'

/**
 * A hijacked camera feed popping open on the desktop.
 *
 * Two flavours, and the difference is the whole point:
 *   - THEIR cameras (cctv/thermal/doorcam) -- you're in their building.
 *   - YOUR webcam (during a reverse hack) -- they're watching you back.
 *
 * The window renders a real clip from public/video/ when one exists and a
 * canvas-rendered synthetic feed when it doesn't, decided per-popup by
 * videoRegistry.probeClip. Nothing above this needs to know which it got,
 * so the feature is complete before any media lands and upgrades itself
 * silently as clips are added.
 */

export interface CamWindowOptions {
  manager: WindowManager
  rng: Rng
  /** Restrict to a kind -- 'webcam' for the "they're watching you" beat. */
  kind?: FeedKind
  /** Overrides the burned-in label (e.g. to name the target org). */
  labelPrefix?: string
  /** Auto-close after this long. Omit to leave it until evicted. */
  ttlMs?: number
  hostile?: boolean
}

export function spawnCamWindow(opts: CamWindowOptions): void {
  const clip = pickClip(opts.rng, opts.kind)
  const label = opts.labelPrefix ? `${opts.labelPrefix} :: ${clip.label}` : clip.label

  const win = opts.manager.spawn(
    { title: `▶ ${label}`, modal: false, closable: true, decor: opts.hostile ? 'danger' : 'normal' },
    'random',
  )
  win.el.classList.add('camwin')
  if (opts.hostile) win.el.classList.add('camwin--hostile')

  const body = document.createElement('div')
  body.className = 'camwin__body'

  const stage = document.createElement('div')
  stage.className = 'camwin__stage'
  body.appendChild(stage)

  // Burned-in overlay: this is what actually sells it as a feed, and it
  // sits on top of either source identically.
  const hud = document.createElement('div')
  hud.className = 'camwin__hud'
  const rec = document.createElement('span')
  rec.className = 'camwin__rec'
  rec.textContent = '● REC'
  const tc = document.createElement('span')
  tc.className = 'camwin__tc'
  hud.append(rec, tc)
  stage.appendChild(hud)

  const idTag = document.createElement('div')
  idTag.className = 'camwin__id'
  idTag.textContent = clip.label
  stage.appendChild(idTag)

  // Live timecode. Uses wall clock deliberately -- a feed whose clock is
  // frozen reads as a still image.
  const paintTc = (): void => {
    const d = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    tc.textContent = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  paintTc()
  const tcTimer = setInterval(paintTc, 1000)

  let synthetic: SyntheticFeed | null = null

  const mountSynthetic = (): void => {
    if (synthetic) return
    synthetic = new SyntheticFeed(clip.kind, int(opts.rng, 1, 1e9))
    stage.insertBefore(synthetic.canvas, hud)
  }

  const mountVideo = (c: FeedClip): void => {
    const v = document.createElement('video')
    v.className = 'camwin__video'
    v.src = clipSrc(c)
    v.muted = true
    v.loop = true
    v.autoplay = true
    v.playsInline = true
    v.preload = 'auto'
    // If playback fails after the probe passed (codec, decode error), fall
    // back rather than leaving a black rectangle.
    v.addEventListener('error', () => {
      v.remove()
      mountSynthetic()
    })
    stage.insertBefore(v, hud)
    void v.play().catch(() => {
      /* autoplay refused: the frame still shows, which is enough for a prop */
    })
  }

  // Show the synthetic feed immediately so the popup is never empty, then
  // swap in the real clip if one turns out to exist. The probe is async and
  // a popup that waits on it would flash blank.
  mountSynthetic()
  void probeClip(clip).then((present) => {
    if (!present || win.isClosed) return
    synthetic?.destroy()
    synthetic?.canvas.remove()
    synthetic = null
    mountVideo(clip)
  })

  win.setBody(body)

  const ttl = opts.ttlMs ?? int(opts.rng, 7000, 13000)
  const closeTimer = setTimeout(() => win.close(), ttl)

  win.onClose(() => {
    clearInterval(tcTimer)
    clearTimeout(closeTimer)
    synthetic?.destroy()
  })
}
