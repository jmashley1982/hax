import { int, pick, type Rng } from '@/core/rng'
import type { ContentEngine } from '@/content'
import type { LayerDef } from '@/sim/layers'
import type { WindowManager } from './manager'

/**
 * A background process window: pops open, streams a burst of generated
 * code/log lines fast, flashes an exit code, closes itself. Not a task --
 * nothing to click, nothing to solve, never claims a keystroke (it isn't
 * registered with the Director or added to any of shell.ts's input-routing
 * lists, so Round 5's onKeyBurst() plumbing never sees it at all). Purely
 * "like we're triggering events behind the scenes" texture, per the brief.
 */
const PROC_LABELS = [
  'exploit/multi/handler',
  'auxiliary/scanner/portscan',
  'post/multi/gather/env',
  'payload/stager',
  'session_dump',
  'cred_harvest',
  'lateral_move',
  'persist/cron',
  'proxy/socks5',
  'collect/browser_creds',
  'recon/subdomain_enum',
  'exfil/stage2',
] as const

export function spawnProcessWindow(manager: WindowManager, content: ContentEngine, layer: LayerDef, rng: Rng): void {
  const pid = int(rng, 1000, 9999)
  const label = pick(rng, PROC_LABELS)
  const win = manager.spawn({ title: `PROC ${pid} :: ${label}`, modal: false, closable: true, decor: 'normal' }, 'random')
  win.el.classList.add('proc-window')

  const body = document.createElement('div')
  body.className = 'proc-window__log'
  win.setBody(body)

  const lineDelayMs = int(rng, 30, 60)
  const totalLines = int(rng, 5, 11)
  const sources = layer.burstSources
  let printed = 0

  const timer = setInterval(() => {
    if (printed >= totalLines) {
      clearInterval(timer)
      const failed = rng() < 0.15
      const exitLine = document.createElement('div')
      exitLine.className = `proc-window__line ${failed ? 'is-err' : 'is-ok'}`
      exitLine.textContent = failed ? '[process exited with code 1]' : '[process exited with code 0]'
      body.appendChild(exitLine)
      body.scrollTop = body.scrollHeight
      setTimeout(() => win.close(), int(rng, 900, 1600))
      return
    }
    const source = sources[printed % sources.length]
    if (source) {
      const line = document.createElement('div')
      line.className = 'proc-window__line'
      line.textContent = content.line(...source)
      body.appendChild(line)
      body.scrollTop = body.scrollHeight
    }
    printed += 1
  }, lineDelayMs)

  win.onClose(() => clearInterval(timer))
}
