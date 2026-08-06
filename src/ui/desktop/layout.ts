/**
 * The desktop, as actual regions.
 *
 * Every surface in the session used to be an independently-positioned
 * absolute overlay dropped onto one shared plane: the terminal was a left
 * strip at 42% opacity, the messenger was docked on top of it, the HUD
 * floated top-right with `pointer-events: none`, the status bar was
 * pinned to the bottom, and the window layer scattered windows across the
 * entire viewport. Nothing owned any region, so everything collided with
 * everything -- and three separate reported defects were direct
 * consequences (an illegible messenger, an unclickable token chip, and
 * windows piling on each other).
 *
 * This is a CSS grid with four named areas. Each component mounts into
 * the region that owns it, so their geometry is decided once, here,
 * rather than by four sets of absolute offsets that have to agree.
 *
 *   ┌─ TOP ─────────────────────────────────┐
 *   │ menu bar · objective · meters · tokens│  interactive, not an overlay
 *   ├─ RAIL ──┬─ WORK ─────────────────────┤
 *   │ terminal│  windows live here, and     │
 *   │ messenger  ONLY here                  │
 *   ├─ BAR ───┴────────────────────────────┤
 *   │ desktop icons · prompt · status       │
 *   └───────────────────────────────────────┘
 *
 * The work area mattering most: the window manager measures its grid from
 * this element instead of from the viewport, so "how many windows fit
 * without overlapping" becomes a real answer about a real box.
 */

export interface DesktopRegions {
  root: HTMLElement
  /** Menu bar, objective, HUD meters and the token rack. */
  top: HTMLElement
  /** Terminal and messenger, stacked as siblings rather than layered. */
  rail: HTMLElement
  /** The only place windows are placed. */
  work: HTMLElement
  /** Desktop icons, the command prompt and the status line. */
  bar: HTMLElement
}

export class DesktopLayout implements DesktopRegions {
  readonly root: HTMLElement
  readonly top: HTMLElement
  readonly rail: HTMLElement
  readonly work: HTMLElement
  readonly bar: HTMLElement

  constructor(mount: HTMLElement) {
    this.root = el('desk')
    this.top = el('desk__top')
    this.rail = el('desk__rail')
    this.work = el('desk__work')
    this.bar = el('desk__bar')

    // A period menu bar. The menus are deliberately inert -- the point is
    // the silhouette of an operating system, and a working File menu would
    // be a distraction from the one on screen that matters.
    const menu = el('desk__menu')
    for (const label of ['FILE', 'EDIT', 'TARGET', 'RELAY', 'HELP']) {
      const m = el('desk__menu-item')
      m.textContent = label
      menu.appendChild(m)
    }
    this.top.appendChild(menu)

    this.root.append(this.top, this.rail, this.work, this.bar)
    mount.appendChild(this.root)
  }

  destroy(): void {
    this.root.remove()
  }
}

function el(cls: string): HTMLElement {
  const node = document.createElement('div')
  node.className = cls
  return node
}
