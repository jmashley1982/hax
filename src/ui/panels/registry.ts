import type { WindowManager } from '@/ui/windows/manager'
import type { PanelContext, TaskPanel } from './panel'
import { BruteForcePanel } from './bruteForce'
import { PortScanPanel } from './portScan'
import { CipherLockPanel } from './cipherLock'
import { NodePathPanel } from './nodePath'
import { KeyRecoveryPanel } from './keyRecovery'
import { TraceDefensePanel } from './traceDefense'
import { SignalAlignPanel } from './signalAlign'
import { DragExfilPanel } from './dragExfil'
import { FileSystem3dPanel } from './fileSystem3d'

export type PanelFactory = (manager: WindowManager, ctx: PanelContext) => TaskPanel

/**
 * Which panel types exist. Availability is decided by depth --
 * `unlockedPanelTypes()` in sim/layers.ts returns the cumulative set for
 * the current layer, so each breakthrough introduces a genuinely new kind
 * of thing to do rather than reshuffling the same three.
 */
export const PANEL_TYPES: Record<string, PanelFactory> = {
  ports: (m, c) => new PortScanPanel(m, c),
  brute: (m, c) => new BruteForcePanel(m, c),
  cipher: (m, c) => new CipherLockPanel(m, c),
  nodePath: (m, c) => new NodePathPanel(m, c),
  keyRecovery: (m, c) => new KeyRecoveryPanel(m, c),
  traceDefense: (m, c) => new TraceDefensePanel(m, c),
  signalAlign: (m, c) => new SignalAlignPanel(m, c),
  dragExfil: (m, c) => new DragExfilPanel(m, c),
  fs3d: (m, c) => new FileSystem3dPanel(m, c),
}

/** Human-readable names, used to announce unlocks at a breakthrough. */
export const PANEL_LABELS: Record<string, string> = {
  ports: 'PORT SCAN',
  brute: 'BRUTE FORCE',
  cipher: 'CIPHER LOCK',
  nodePath: 'ROUTE TRACING',
  keyRecovery: 'KEY RECOVERY',
  traceDefense: 'TRACE DEFENSE',
  signalAlign: 'SIGNAL LOCK',
  dragExfil: 'VAULT PULL',
  fs3d: 'FILE SYSTEM NAVIGATOR',
}

/**
 * Bias spawns away from types already on screen, so the board shows a mix
 * of things to do rather than three identical grids.
 *
 * `preferred` is the current level's required tools. It is applied FIRST
 * and only among types not already on the board, which is what keeps both
 * halves true: the tool the objective needs turns up promptly, and the
 * board still fills with everything else once one of each is out.
 */
export function pickPanelType(
  pool: readonly string[],
  activeTypes: readonly string[],
  rngPick: (a: readonly string[]) => string,
  preferred: readonly string[] = [],
): string {
  const unused = pool.filter((t) => !activeTypes.includes(t))
  const wanted = unused.filter((t) => preferred.includes(t))
  if (wanted.length > 0) return rngPick(wanted)
  return rngPick(unused.length > 0 ? unused : pool)
}
