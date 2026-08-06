import type { WindowManager } from '@/ui/windows/manager'
import type { PanelContext, TaskPanel } from './panel'
import { BruteForcePanel } from './bruteForce'
import { PortScanPanel } from './portScan'
import { CipherLockPanel } from './cipherLock'
import { NodePathPanel } from './nodePath'
import { FileExfilPanel } from './fileExfil'
import { KeyRecoveryPanel } from './keyRecovery'
import { TraceDefensePanel } from './traceDefense'
import { SignalAlignPanel } from './signalAlign'
import { DragExfilPanel } from './dragExfil'

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
  fileExfil: (m, c) => new FileExfilPanel(m, c),
  keyRecovery: (m, c) => new KeyRecoveryPanel(m, c),
  traceDefense: (m, c) => new TraceDefensePanel(m, c),
  signalAlign: (m, c) => new SignalAlignPanel(m, c),
  dragExfil: (m, c) => new DragExfilPanel(m, c),
}

/** Human-readable names, used to announce unlocks at a breakthrough. */
export const PANEL_LABELS: Record<string, string> = {
  ports: 'PORT SCAN',
  brute: 'BRUTE FORCE',
  cipher: 'CIPHER LOCK',
  nodePath: 'ROUTE TRACING',
  fileExfil: 'FILE EXFIL',
  keyRecovery: 'KEY RECOVERY',
  traceDefense: 'TRACE DEFENSE',
  signalAlign: 'SIGNAL LOCK',
  dragExfil: 'VAULT PULL',
}

/**
 * Bias spawns away from types already on screen, so the board shows a mix
 * of things to do rather than three identical grids.
 */
export function pickPanelType(
  pool: readonly string[],
  activeTypes: readonly string[],
  rngPick: (a: readonly string[]) => string,
): string {
  const unused = pool.filter((t) => !activeTypes.includes(t))
  return rngPick(unused.length > 0 ? unused : pool)
}
