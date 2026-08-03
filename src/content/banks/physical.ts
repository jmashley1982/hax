import type { Bank } from '../grammar'

/**
 * SCADA / door controller / camera subsystem chatter for the deepest
 * layers. Foreshadows the video subsystem (Phase 7) — cameras named here
 * are exactly the kind of entity {facts} will later pin to real cues.
 */
export const physical: Bank = {
  scada: [
    { t: 'PLC {host} :: setpoint {int:10-90}% -> {int:10-90}% ({hex:4})', w: 2 },
    { t: 'HVAC zone {int:1-12} :: override accepted, node {hex:6}', w: 1 },
    { t: 'UPS bank {int:1-4} :: load {int:20-98}%, runtime {int:5-90}min', w: 1 },
    { t: 'badge reader {int:1-40} :: {verdict} ({badge})', w: 2 },
    { t: 'door controller {int:1-60} on {host} :: {verdict}', w: 1 },
    { t: 'sensor {hex:4} on floor {int:1-9} :: reading {int:0-100}', w: 1 },
  ],
  verdict: ['access granted', 'access denied', 'offline', 'tamper alert cleared'],
  camera: [
    { t: 'CAM-{int:1-40} :: feed acquired', w: 2 },
    { t: 'CAM-{int:1-40} :: motion detected', w: 1 },
    { t: 'CAM-{int:1-40} :: signal degraded', w: 1 },
  ],
  blackout: [
    'sector {int:1-8} lighting -- OFFLINE',
    'backup power -- FAILED TO ENGAGE',
    'all badge readers -- OFFLINE',
    'fire suppression -- MANUAL OVERRIDE',
  ],
}
