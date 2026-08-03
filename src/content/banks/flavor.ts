import type { Bank } from '../grammar'

/**
 * Boot sequence lines, ambient asides, and generic responses to raw input
 * before the command router (Phase 3) exists. This bank is what makes
 * "mash keys, get convincing output" work in Phase 1.
 */
export const flavor: Bank = {
  // Distinct keys (not one shuffled pool) so the boot log reads as a real
  // causal sequence -- init, then kernel, then volumes, etc. -- while each
  // step still has a couple of weighted variants for replay variety.
  bootInit: ['NULLSTACK v0.1 -- initializing subsystems', 'NULLSTACK core online -- bringing up subsystems'],
  bootKernel: ['loading kernel modules... ok', 'kernel modules loaded ({int:8-40} modules)'],
  bootVolumes: ['mounting encrypted volumes... ok', 'encrypted volumes mounted -- {int:1-6} partitions'],
  bootRelay: [{ t: 'establishing relay chain... {int:2-7} hops', w: 1 }],
  bootEntropy: [{ t: 'entropy pool seeded ({hex:16})', w: 1 }],
  bootHandshake: [{ t: 'handshake with {host} :: {int:60-100}% signal', w: 1 }],
  ambientChaos: [
    { t: 'buffer flush :: {hex:12}', w: 2 },
    { t: 'injecting payload segment {int:1-9}/{int:9-16} :: {hex:4}', w: 2 },
    { t: 'bypassing checksum on {host} :: {hex:6}', w: 2 },
    { t: 'keystroke pattern logged :: entropy +{int:1-9} ({hex:4})', w: 1 },
    { t: 'spoofing {mac} on uplink', w: 1 },
    { t: 'cache poisoned :: {ip} -> {ip2}', w: 1 },
    { t: 'socket {int:1024-65535} opened on {host}', w: 2 },
    { t: 'decoy traffic injected ({int:3-40} pkts, {hex:4})', w: 1 },
    { t: 'signal noise on {ip} :: {float:0.1-99.9}dB', w: 1 },
    { t: 'relaying through {mac} :: window {int:1-999}ms', w: 1 },
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
