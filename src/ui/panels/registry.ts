import type { LayerId } from '@/core/state'
import type { WindowManager } from '@/ui/windows/manager'
import type { PanelContext, TaskPanel } from './panel'
import { BruteForcePanel } from './bruteForce'
import { PortScanPanel } from './portScan'
import { CipherLockPanel } from './cipherLock'

export type PanelFactory = (manager: WindowManager, ctx: PanelContext) => TaskPanel

export const PANEL_TYPES: Record<string, PanelFactory> = {
  brute: (m, c) => new BruteForcePanel(m, c),
  ports: (m, c) => new PortScanPanel(m, c),
  cipher: (m, c) => new CipherLockPanel(m, c),
}

/**
 * Per-layer panel pools. Outer layers lean scanning/brute-force, deeper
 * layers lean cipher work -- so descending changes what you're *doing*,
 * not just the numbers (plan §13c: six layers should read as six distinct
 * stretches). More panel types get added to these pools as they're built.
 */
export const LAYER_POOLS: Record<LayerId, readonly string[]> = {
  surface: ['ports', 'brute', 'cipher'],
  perimeter: ['ports', 'brute', 'cipher'],
  intranet: ['brute', 'cipher', 'ports'],
  core: ['cipher', 'brute', 'ports'],
  kernel: ['cipher', 'brute', 'ports'],
  physical: ['cipher', 'brute', 'ports'],
}

/**
 * Bias spawns away from whatever type is already on screen, so the board
 * shows a mix of things to do rather than three identical port grids.
 */
export function pickPanelType(pool: readonly string[], activeTypes: readonly string[], rngPick: (a: readonly string[]) => string): string {
  const unused = pool.filter((t) => !activeTypes.includes(t))
  return rngPick(unused.length > 0 ? unused : pool)
}
