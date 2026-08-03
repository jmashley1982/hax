import type { Bank } from '../grammar'

/** Scan/route/handshake/packet chatter. */
export const netops: Bank = {
  scanLine: [
    { t: '{ts}  probing {cidr} :: port {port} [{scanMode}]', w: 3 },
    { t: '{ts}  SYN sweep {ip} -> {ip2}  ttl={int:32-255} win={int:512-65535}', w: 2 },
    { t: '{ts}  {host} responded in {float:0.3-84.2}ms  banner="{banner}"', w: 2 },
    { t: '{ts}  !! filtered at hop {int:3-19} ({ip}) -- rerouting via {relay}', w: 1 },
    { t: '{ts}  arp: {mac} claims {ip}', w: 2 },
    { t: '{ts}  route to {host} via {relay}, {int:2-14} hops', w: 1 },
    { t: '{ts}  {realhost} :: {tech} fingerprint matched', w: 2 },
  ],
  scanMode: ['stealth', 'aggressive', 'passive', 'fragmented', 'decoyed'],
  banner: [
    'OpenSSH_{int:6-9}.{int:0-9}p1',
    'nginx/1.{int:18-27}.{int:0-4}',
    'Apache/2.4.{int:6-58}',
    'ProFTPD 1.3.{int:0-8}',
    'BIND {int:9-9}.{int:10-18}',
  ],
  relay: [
    'AS{int:1000-65535}',
    'TOR::{hex:8}',
    'relay-{int:1-9}.exchange',
    'hop{int:2-9}.upstream',
  ],
}
