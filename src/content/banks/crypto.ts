import type { Bank } from '../grammar'

/** Cipher/keygen/decrypt chatter. */
export const crypto: Bank = {
  keygen: [
    { t: 'deriving key material :: {hex:32}', w: 2 },
    { t: 'PBKDF2 iteration {int:1000-50000}/{int:50000-90000} :: seed {hex:8}', w: 2 },
    { t: 'entropy source: {adjective} timing jitter ({int:60-99}% confidence, {hex:6})', w: 1 },
    { t: 'candidate key {hex:16} -- {verdict}', w: 2 },
    { t: 'keyring sync with {host} :: fingerprint {sha}', w: 1 },
  ],
  verdict: ['rejected (weak)', 'rejected (collision)', 'accepted', 'queued for verification'],
  // High-frequency bank (a default burst source) -- every rule carries at
  // least one wide-range or hex/sha slot so the template pick itself isn't
  // the only source of variety.
  decrypt: [
    { t: 'attempting {cipher} on {host} :: block {int:1-64}/{int:64-256} ({hex:4})', w: 3 },
    { t: 'plaintext fragment recovered: "{fragment}" ({int:1-99}% confidence, offset {hex:4})', w: 2 },
    { t: 'checksum {hex:8} mismatch on block {int:1-64} -- retrying with shifted key', w: 1 },
    { t: '{cipher} broken in {float:0.4-9.8}s -- {int:1-9999} candidates tested', w: 1 },
    { t: 'key schedule {hex:12} rejected -- {verdict}', w: 1 },
    { t: 'session key for {host} recovered :: {sha}', w: 1 },
  ],
  cipher: ['AES-256-GCM', 'ChaCha20-Poly1305', 'RSA-4096', 'legacy XOR cascade', 'a proprietary stream cipher'],
  fragment: [
    'ACCESS GRANTED PENDING', 'DO NOT DISTRIBUTE', 'ROOT// [redacted]',
    'BACKUP KEY ROTATION', 'ADMIN OVERRIDE', 'FACILITY CODE 7',
  ],
  keyHint: [
    { t: 'hint: try the {adjective} certificate on {host}', w: 1 },
    { t: 'hint: {org} rotates keys every {int:30-90} days -- this one is stale', w: 1 },
  ],
}
