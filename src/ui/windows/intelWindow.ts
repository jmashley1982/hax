import { int, pick, hex, type Rng } from '@/core/rng'
import type { ContentEngine } from '@/content'
import type { Contract } from '@/sim/contracts'
import { sectorLabel } from '@/sim/contracts'
import { drawStreetGrid, makeStreetGrid } from '@/media/streetMap'
import type { WindowManager } from './manager'

/**
 * Ambient intel: the little bits of the outside world that make a target
 * feel like a real organisation rather than a bag of statistics.
 *
 * Two kinds live here -- press coverage and facility/location cards. The
 * third, the public livestream, is a framing option on camWindow rather
 * than a rewrite of it: the synthetic-to-real-clip swap in that file is
 * the valuable part and must stay shared.
 *
 * A constraint worth restating because it is permanent: real map tiles
 * and real external streams are impossible here. The app makes zero
 * external network requests and has to work opened from `file://`. So the
 * map is genuinely drawn (media/streetMap.ts) and the "livestream" is the
 * existing clip library in browser chrome. At popup size both read
 * correctly, and that is the honest ceiling.
 */

export interface NewsOptions {
  manager: WindowManager
  rng: Rng
  content: ContentEngine
  contract: Contract
  /** Deep in the run the break itself becomes the story. */
  breaking?: boolean
}

export function spawnNewsWindow(opts: NewsOptions): void {
  const { manager, rng, content, contract } = opts
  const outlet = content.line('news', 'outlet')
  const win = manager.spawn(
    {
      title: outlet,
      modal: false,
      closable: true,
      decor: 'normal',
      // Wide: a headline that wraps over four lines does not read as a
      // news site.
      span: { cols: 2, rows: 1 },
    },
    'random',
  )
  win.el.classList.add('newswin')

  const body = document.createElement('div')
  body.className = 'newswin__body'

  const kicker = document.createElement('div')
  kicker.className = 'newswin__kicker'
  kicker.textContent = `${sectorLabel(contract.sector)} · ${outlet}`

  const head = document.createElement('div')
  head.className = `newswin__head${opts.breaking ? ' is-breaking' : ''}`
  head.textContent = content.line('news', opts.breaking ? 'breaking' : 'headline')

  const dek = document.createElement('div')
  dek.className = 'newswin__dek'
  dek.textContent = content.line('news', 'dek')

  const meta = document.createElement('div')
  meta.className = 'newswin__meta'
  meta.textContent = `By ${content.line('news', 'byline')}  ·  ${int(rng, 2, 40)} min ago`

  body.append(kicker, head, dek, meta)
  win.setBody(body)

  const t = setTimeout(() => win.close(), int(rng, 9000, 15000))
  win.onClose(() => clearTimeout(t))
}

const SITE_TYPES = ['HQ', 'DATA CENTRE', 'DEPOT', 'PLANT', 'ANNEX', 'FIELD OFFICE']
const CITIES = ['LEEDS', 'ROTTERDAM', 'TALLINN', 'PORTLAND', 'VALENCIA', 'HAMILTON', 'MALMO', 'CORK']

export interface FacilityOptions {
  manager: WindowManager
  rng: Rng
  contract: Contract
}

/**
 * A location card for one of the target's sites: a drawn street grid, a
 * pin, coordinates, headcount and the nearest response unit.
 */
export function spawnFacilityWindow(opts: FacilityOptions): void {
  const { manager, rng, contract } = opts
  const city = pick(rng, CITIES)
  const type = pick(rng, SITE_TYPES)

  const win = manager.spawn(
    { title: `SITE :: ${type} / ${city}`, modal: false, closable: true, decor: 'normal' },
    'random',
  )
  win.el.classList.add('geowin')

  const body = document.createElement('div')
  body.className = 'geowin__body'

  const canvas = document.createElement('canvas')
  canvas.width = 232
  canvas.height = 124
  canvas.className = 'geowin__canvas'
  body.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  if (ctx) {
    const grid = makeStreetGrid(rng, canvas.width, canvas.height)
    drawStreetGrid(ctx, grid, canvas.width, canvas.height, {
      bg: '#0b0e12',
      stroke: 'rgba(130,160,180,0.45)',
    })

    // The site itself: a footprint polygon and a pin.
    const px = int(rng, 60, canvas.width - 60)
    const py = int(rng, 40, canvas.height - 40)
    ctx.fillStyle = 'rgba(255,190,60,0.22)'
    ctx.strokeStyle = 'rgba(255,190,60,0.9)'
    ctx.lineWidth = 1
    const bw = int(rng, 26, 44)
    const bh = int(rng, 18, 30)
    ctx.fillRect(px - bw / 2, py - bh / 2, bw, bh)
    ctx.strokeRect(px - bw / 2, py - bh / 2, bw, bh)
    ctx.beginPath()
    ctx.arc(px, py, 3, 0, Math.PI * 2)
    ctx.fillStyle = '#ffbe3c'
    ctx.fill()

    // Scale bar, because a map without one reads as a diagram.
    ctx.strokeStyle = 'rgba(220,235,245,0.7)'
    ctx.beginPath()
    ctx.moveTo(8, canvas.height - 10)
    ctx.lineTo(48, canvas.height - 10)
    ctx.stroke()
    ctx.fillStyle = 'rgba(220,235,245,0.8)'
    ctx.font = '8px ui-monospace, Menlo, monospace'
    ctx.fillText('200m', 52, canvas.height - 7)
  }

  const rows = document.createElement('div')
  rows.className = 'geowin__rows'
  const lat = `${int(rng, 34, 61)}.${int(rng, 1000, 9999)}`
  const lon = `${int(rng, -8, 24)}.${int(rng, 1000, 9999)}`
  for (const [label, value] of [
    ['SITE', `${contract.facts.org} ${type}`],
    ['COORD', `${lat}, ${lon}`],
    ['ON SITE', `${int(rng, 4, 240)} staff`],
    ['NEAREST UNIT', `${int(rng, 2, 14)} min`],
    ['BADGE ZONE', hex(rng, 4).toUpperCase()],
  ] as const) {
    const row = document.createElement('div')
    row.className = 'geowin__row'
    const l = document.createElement('span')
    l.className = 'geowin__label'
    l.textContent = label
    const v = document.createElement('span')
    v.textContent = value
    row.append(l, v)
    rows.appendChild(row)
  }

  body.appendChild(rows)
  win.setBody(body)

  const t = setTimeout(() => win.close(), int(rng, 10_000, 16_000))
  win.onClose(() => clearTimeout(t))
}
