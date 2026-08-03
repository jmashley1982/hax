import type { Bank } from '../grammar'

/**
 * Boot sequence lines, ambient asides, and generic responses to raw input
 * before the command router (Phase 3) exists. This bank is what makes
 * "mash keys, get convincing output" work in Phase 1.
 */
export const flavor: Bank = {
  boot: [
    'NULLSTACK v0.1 -- initializing subsystems',
    'loading kernel modules... ok',
    'mounting encrypted volumes... ok',
    'establishing relay chain... {int:2-7} hops',
    'entropy pool seeded ({hex:16})',
    'handshake with {host} :: {int:60-100}% signal',
  ],
  ambientChaos: [
    { t: 'buffer flush :: {hex:12}', w: 2 },
    { t: 'injecting payload segment {int:1-9}/{int:9-9}', w: 2 },
    { t: 'bypassing checksum on {host}', w: 2 },
    { t: 'keystroke pattern logged :: entropy +{int:1-9}', w: 1 },
    { t: 'spoofing {mac} on uplink', w: 1 },
    { t: 'cache poisoned :: {ip} -> {ip2}', w: 1 },
    { t: 'socket {int:1024-65535} opened on {host}', w: 2 },
    { t: 'decoy traffic injected ({int:3-40} pkts)', w: 1 },
  ],
  ambientSuccess: [
    'access token acquired',
    'shell spawned :: uid=0',
    'privilege escalation confirmed',
    'tunnel established',
    'trace evasion successful',
  ],
  nonsenseFail: [
    { t: 'unrecognized sequence -- discarded', w: 2 },
    { t: 'no matching syscall for input', w: 2 },
    { t: 'garbled input :: parity error', w: 1 },
    { t: 'input ignored (not a valid directive)', w: 1 },
    { t: '...nothing happens.', w: 1 },
  ],
}
