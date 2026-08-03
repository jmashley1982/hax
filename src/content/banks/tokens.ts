import type { Bank } from '../grammar'

/**
 * Shared vocabulary referenced tersely (bare `{name}`, no bank prefix) from
 * any other bank — vendors, codenames, adjectives shared across contexts.
 */
export const tokens: Bank = {
  vendor: [
    'Cortessa', 'Halyard', 'Meridian Systems', 'Vantage Networks', 'Obsidian',
    'Northgate', 'Ferrovax', 'Sable Instruments', 'Continuum', 'Redshift Labs',
  ],
  codename: [
    'NIGHTGLASS', 'COLDHARBOR', 'DEADBOLT', 'GREYMATTER', 'PALEHORSE',
    'SILENTKEY', 'BLACKGLASS', 'IRONVEIL', 'LOOSETHREAD', 'HOLLOWPOINT',
  ],
  adjective: [
    'anomalous', 'unauthenticated', 'stale', 'orphaned', 'privileged',
    'unpatched', 'legacy', 'volatile', 'unverified', 'deprecated',
  ],
  severity: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
}
