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

/**
 * Process windows come in flavors so a screen full of them doesn't read as
 * the same window stamped six times. Each kind draws its body from a
 * different generator, so one is streaming a hex dump while another is
 * compiling and a third is dumping SQL.
 */
type ProcKind = 'log' | 'hexdump' | 'build' | 'source'

const KIND_TITLES: Record<ProcKind, (rng: Rng) => string> = {
  log: (r) => `PROC ${int(r, 1000, 9999)} :: ${pick(r, PROC_LABELS)}`,
  hexdump: (r) => `xxd :: 0x${int(r, 0x1000, 0xfffff).toString(16)}`,
  build: (r) => `cc :: payload-${pick(r, ['x86_64', 'aarch64', 'armv7'] as const)}`,
  source: (r) => `less :: ${pick(r, ['stage2.c', 'hook.py', 'inject.rs', 'dropper.go', 'shim.asm'] as const)}`,
}

function bodyLine(kind: ProcKind, content: ContentEngine, layer: LayerDef, rng: Rng, i: number): string {
  switch (kind) {
    case 'hexdump': {
      const off = (0x400 + i * 16).toString(16).padStart(8, '0')
      const bytes = Array.from({ length: 8 }, () => int(rng, 0, 255).toString(16).padStart(2, '0')).join(' ')
      return `${off}  ${bytes}  ${content.line('crypto', 'keygen').slice(0, 16)}`
    }
    case 'build':
      return pick(rng, [
        `  CC    ${pick(rng, ['loader', 'stage2', 'hook', 'shim'] as const)}.o`,
        `  LD    payload.elf`,
        `  STRIP payload.elf  (${int(rng, 12, 340)}KB)`,
        `  warning: unused result [-Wunused-result]`,
        `  ${int(rng, 1, 90)}% [${'='.repeat(int(rng, 1, 18))}>]`,
      ])
    case 'source':
      return content.line('filesystem', 'grepHit')
    case 'log':
    default: {
      const source = layer.burstSources[i % layer.burstSources.length]
      return source ? content.line(...source) : ''
    }
  }
}

export function spawnProcessWindow(manager: WindowManager, content: ContentEngine, layer: LayerDef, rng: Rng): void {
  const kind: ProcKind = pick(rng, ['log', 'log', 'hexdump', 'build', 'source'] as const)
  const win = manager.spawn(
    { title: KIND_TITLES[kind](rng), modal: false, closable: true, decor: 'normal' },
    'random',
  )
  win.el.classList.add('proc-window', `proc-window--${kind}`)

  const body = document.createElement('div')
  body.className = 'proc-window__log'
  win.setBody(body)

  const lineDelayMs = int(rng, 26, 55)
  const totalLines = int(rng, 5, 12)
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
    const text = bodyLine(kind, content, layer, rng, printed)
    if (text) {
      const line = document.createElement('div')
      line.className = 'proc-window__line'
      line.textContent = text
      body.appendChild(line)
      body.scrollTop = body.scrollHeight
    }
    printed += 1
  }, lineDelayMs)

  win.onClose(() => clearInterval(timer))
}
