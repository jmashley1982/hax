import { int, pick, type Rng } from '@/core/rng'

/**
 * Procedural network-flavored value generators. Called by the grammar
 * expander (content/grammar.ts) for built-in filler tokens like {ip} or
 * {mac}. Kept separate from the grammar engine so Phase 2's audit script
 * and any future generator can reuse them directly.
 */

const PRIVATE_OCTET_1 = [10, 172, 192] as const

export function ip(rng: Rng): string {
  const first = pick(rng, PRIVATE_OCTET_1)
  const b = first === 172 ? int(rng, 16, 31) : first === 192 ? 168 : int(rng, 0, 255)
  return `${first}.${b}.${int(rng, 0, 255)}.${int(rng, 1, 254)}`
}

/** IP drawn from within a specific CIDR's /24, for mission-scoped coherence. */
export function ipInSubnet(rng: Rng, subnetBase: string): string {
  const parts = subnetBase.split('.')
  const base = parts.slice(0, 3).join('.')
  return `${base}.${int(rng, 1, 254)}`
}

export function mac(rng: Rng): string {
  const bytes = Array.from({ length: 6 }, () => int(rng, 0, 255).toString(16).padStart(2, '0'))
  return bytes.join(':')
}

export function cidr(rng: Rng): string {
  const bits = pick(rng, [16, 20, 22, 24] as const)
  return `${ip(rng).split('.').slice(0, 2).join('.')}.0.0/${bits}`
}

const TLDS = ['net', 'sec', 'internal', 'corp', 'io', 'systems'] as const
const HOST_PREFIXES = [
  'gw', 'edge', 'db', 'auth', 'vpn', 'proxy', 'app', 'cache', 'log', 'mail',
  'ns', 'rtr', 'sw', 'bastion', 'ci', 'build', 'vault', 'ldap', 'dc', 'hv',
] as const

export function hostname(rng: Rng, domain?: string): string {
  const name = `${pick(rng, HOST_PREFIXES)}-${int(rng, 1, 24)}`
  return domain ? `${name}.${domain}` : `${name}.${pick(rng, TLDS)}`
}

const PORTS = [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 502, 3306, 3389, 5432, 6379, 8080, 8443, 9200] as const
export function port(rng: Rng): number {
  return pick(rng, PORTS)
}

export function asn(rng: Rng): string {
  return `AS${int(rng, 1000, 65535)}`
}
