import { saveState, type GameState } from '@/core/state'
import { cycleTheme } from '@/themes/themes'
import { generateContracts, sectorLabel, type Contract } from '@/sim/contracts'
import { mulberry32, int, pick } from '@/core/rng'
import type { InteractionMode } from '@/core/events'

/**
 * The workstation dashboard -- the game's home base (plan §16A).
 *
 * The game used to start the instant the page loaded, which left nowhere to
 * choose a handle, pick a job, or see how you'd done. This is that place.
 *
 * It must NOT become §13a's dead boot gate. That failure was a static
 * screen the player could sit on with nothing happening. This one idles
 * like a real machine: a live clock, a scrolling system log, a blinking
 * cursor, and a contract board full of things to read. Nothing here blocks
 * on a timer -- the player leaves when they choose a job.
 */

const IDLE_LOG = [
  'nullstack v0.9 -- workstation ready',
  'tunnel daemon .............. standby',
  'relay pool ................. 7 nodes',
  'crypt volume ............... mounted',
  'no active contract',
  'awaiting operator input',
  'scanning broker feeds ......',
  'contract board refreshed',
  'idle',
]

export interface DashboardOptions {
  onStart: (contract: Contract) => void
}

export class Dashboard {
  private el: HTMLElement
  private contracts: Contract[]
  private selected: Contract | null = null
  private timers: Array<ReturnType<typeof setInterval>> = []
  private boardEl!: HTMLElement
  private detailEl!: HTMLElement
  private startBtn!: HTMLButtonElement

  constructor(mount: HTMLElement, private state: GameState, private opts: DashboardOptions) {
    // A fresh board every visit, per "generated anew on every new start".
    this.contracts = generateContracts(state.seed + state.contractsRun * 7919 + 13)

    this.el = document.createElement('div')
    this.el.className = 'dash'
    this.el.append(this.buildHeader(), this.buildBody(), this.buildFooter())
    mount.appendChild(this.el)

    this.renderBoard()
  }

  // -- chrome ------------------------------------------------------------

  private buildHeader(): HTMLElement {
    const head = document.createElement('div')
    head.className = 'dash__head'

    const brand = document.createElement('div')
    brand.className = 'dash__brand'
    brand.textContent = 'N U L L S T A C K'

    const clock = document.createElement('div')
    clock.className = 'dash__clock'
    const paint = (): void => {
      const d = new Date()
      const p = (n: number): string => String(n).padStart(2, '0')
      clock.textContent = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    }
    paint()
    this.timers.push(setInterval(paint, 1000))

    head.append(brand, clock)
    return head
  }

  private buildBody(): HTMLElement {
    const body = document.createElement('div')
    body.className = 'dash__body'

    // --- left column: operator + settings + log
    const left = document.createElement('div')
    left.className = 'dash__col dash__col--left'
    left.append(this.buildOperatorPanel(), this.buildSettingsPanel(), this.buildLogPanel())

    // --- right column: the contract board + detail
    const right = document.createElement('div')
    right.className = 'dash__col dash__col--right'

    const boardBox = document.createElement('section')
    boardBox.className = 'dash__box dash__box--grow'
    boardBox.append(boxTitle('AVAILABLE CONTRACTS'))
    this.boardEl = document.createElement('div')
    this.boardEl.className = 'dash__board'
    boardBox.appendChild(this.boardEl)

    const detailBox = document.createElement('section')
    detailBox.className = 'dash__box'
    detailBox.append(boxTitle('BRIEF'))
    this.detailEl = document.createElement('div')
    this.detailEl.className = 'dash__detail'
    detailBox.appendChild(this.detailEl)

    right.append(boardBox, detailBox)
    body.append(left, right)
    return body
  }

  private buildOperatorPanel(): HTMLElement {
    const box = document.createElement('section')
    box.className = 'dash__box'
    box.append(boxTitle('OPERATOR'))

    const row = document.createElement('label')
    row.className = 'dash__field'
    const lab = document.createElement('span')
    lab.textContent = 'HANDLE'
    const input = document.createElement('input')
    input.className = 'dash__input'
    input.value = this.state.handle
    input.maxLength = 18
    input.spellcheck = false
    input.autocomplete = 'off'
    input.addEventListener('input', () => {
      this.state.handle = input.value.trim() || 'operator'
      saveState(this.state)
    })
    row.append(lab, input)

    const stats = document.createElement('div')
    stats.className = 'dash__stats'
    stats.append(
      statLine('CAREER SCORE', String(Math.floor(this.state.score))),
      statLine('CONTRACTS RUN', String(this.state.contractsRun)),
      statLine('DEEPEST LAYER', this.state.deepestLayer.toUpperCase()),
      statLine('INTEGRITY', `${Math.round(this.state.integrity)}%`),
    )

    box.append(row, stats)
    return box
  }

  private buildSettingsPanel(): HTMLElement {
    const box = document.createElement('section')
    box.className = 'dash__box'
    box.append(boxTitle('SETTINGS'))

    const modeRow = document.createElement('div')
    modeRow.className = 'dash__field'
    const modeLab = document.createElement('span')
    modeLab.textContent = 'INPUT'
    const modeBtn = document.createElement('button')
    modeBtn.className = 'dash__toggle'
    const modes: InteractionMode[] = ['hybrid', 'chaos', 'intent']
    // INTENT deliberately makes raw keystrokes inert, which is impossible to
    // guess from the word "INTENT" alone -- picking it and then finding the
    // windows unresponsive reads as a broken game, not as a mode.
    const modeBlurbs: Record<InteractionMode, string> = {
      hybrid: 'mash keys AND type commands',
      chaos: 'mash keys, no commands needed',
      intent: 'typed commands only -- keys alone do nothing',
    }
    const modeHint = document.createElement('div')
    modeHint.className = 'dash__fieldhint'
    const paintMode = (): void => {
      modeBtn.textContent = this.state.mode.toUpperCase()
      modeHint.textContent = modeBlurbs[this.state.mode]
    }
    modeBtn.addEventListener('click', () => {
      const i = modes.indexOf(this.state.mode)
      this.state.mode = modes[(i + 1) % modes.length] ?? 'hybrid'
      paintMode()
      saveState(this.state)
    })
    paintMode()
    modeRow.append(modeLab, modeBtn)

    const themeRow = document.createElement('div')
    themeRow.className = 'dash__field'
    const themeLab = document.createElement('span')
    themeLab.textContent = 'THEME'
    const themeBtn = document.createElement('button')
    themeBtn.className = 'dash__toggle'
    themeBtn.textContent = this.state.theme.toUpperCase()
    themeBtn.addEventListener('click', () => {
      cycleTheme(this.state)
      themeBtn.textContent = this.state.theme.toUpperCase()
    })
    themeRow.append(themeLab, themeBtn)

    box.append(modeRow, modeHint, themeRow)
    return box
  }

  private buildLogPanel(): HTMLElement {
    const box = document.createElement('section')
    box.className = 'dash__box dash__box--grow'
    box.append(boxTitle('SYSTEM'))
    const log = document.createElement('div')
    log.className = 'dash__log'
    box.appendChild(log)

    // The idling machine. This is what keeps the dashboard from reading as
    // a dead menu -- there is always something moving on screen.
    const rng = mulberry32(this.state.seed + 991)
    let i = 0
    const push = (): void => {
      const line = document.createElement('div')
      line.textContent = i < IDLE_LOG.length ? (IDLE_LOG[i] ?? '') : ambientLine(rng)
      log.appendChild(line)
      while (log.childElementCount > 40) log.firstElementChild?.remove()
      log.scrollTop = log.scrollHeight
      i += 1
    }
    for (let k = 0; k < 6; k++) push()
    this.timers.push(setInterval(push, 1400))
    return box
  }

  private buildFooter(): HTMLElement {
    const foot = document.createElement('div')
    foot.className = 'dash__foot'

    const hint = document.createElement('div')
    hint.className = 'dash__foot-hint'
    hint.textContent = 'SELECT A CONTRACT'

    this.startBtn = document.createElement('button')
    this.startBtn.className = 'dash__start'
    this.startBtn.textContent = '▶  JACK IN'
    this.startBtn.disabled = true
    this.startBtn.addEventListener('click', () => this.start())

    const rand = document.createElement('button')
    rand.className = 'dash__random'
    rand.textContent = 'RANDOM JOB'
    rand.addEventListener('click', () => {
      const c = pick(mulberry32(Date.now() & 0xffff), this.contracts)
      this.select(c)
      this.start()
    })

    foot.append(hint, rand, this.startBtn)
    return foot
  }

  // -- board -------------------------------------------------------------

  private renderBoard(): void {
    this.boardEl.replaceChildren()
    for (const c of this.contracts) {
      const row = document.createElement('button')
      row.className = 'contract'
      row.dataset.contractId = c.id

      const name = document.createElement('span')
      name.className = 'contract__org'
      name.textContent = c.facts.org

      const sector = document.createElement('span')
      sector.className = 'contract__sector'
      sector.textContent = sectorLabel(c.sector)

      const job = document.createElement('span')
      job.className = 'contract__job'
      job.textContent = c.job.kind.toUpperCase()

      const tier = document.createElement('span')
      tier.className = 'contract__tier'
      tier.textContent = '◆'.repeat(c.tier) + '◇'.repeat(5 - c.tier)

      row.append(name, sector, job, tier)
      row.addEventListener('click', () => this.select(c))
      this.boardEl.appendChild(row)
    }
  }

  private select(contract: Contract): void {
    this.selected = contract
    for (const el of this.boardEl.querySelectorAll('.contract')) {
      el.classList.toggle('is-selected', (el as HTMLElement).dataset.contractId === contract.id)
    }
    this.startBtn.disabled = false

    this.detailEl.replaceChildren()
    this.detailEl.append(
      detailLine('TARGET', `${contract.facts.org}  (${contract.facts.domain})`),
      detailLine('SECTOR', sectorLabel(contract.sector)),
      detailLine('SUBNET', contract.facts.subnet),
      detailLine('SECURITY', `TIER ${contract.tier} / 5`),
      detailLine('PAYOUT', `x${contract.reward.toFixed(2)}`),
      detailLine('JOB', contract.job.brief),
      detailLine('INTEL', contract.intel),
    )
  }

  private start(): void {
    if (!this.selected) return
    this.opts.onStart(this.selected)
  }

  destroy(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    this.el.remove()
  }
}

// -- small builders ------------------------------------------------------

function boxTitle(text: string): HTMLElement {
  const t = document.createElement('div')
  t.className = 'dash__box-title'
  t.textContent = text
  return t
}

function statLine(label: string, value: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'dash__stat'
  const l = document.createElement('span')
  l.textContent = label
  const v = document.createElement('span')
  v.className = 'dash__stat-value'
  v.textContent = value
  row.append(l, v)
  return row
}

function detailLine(label: string, value: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'dash__detail-row'
  const l = document.createElement('span')
  l.className = 'dash__detail-label'
  l.textContent = label
  const v = document.createElement('span')
  v.textContent = value
  row.append(l, v)
  return row
}

function ambientLine(rng: () => number): string {
  const opts = [
    () => `relay ${int(rng, 1, 9)} latency ${int(rng, 12, 240)}ms`,
    () => `keyring: ${int(rng, 2, 40)} identities loaded`,
    () => `broker feed sync ${int(rng, 80, 100)}%`,
    () => `entropy pool ${int(rng, 200, 4096)} bits`,
    () => `tunnel daemon heartbeat ok`,
    () => `discarded ${int(rng, 1, 30)} stale listings`,
  ]
  return pick(rng, opts)()
}
