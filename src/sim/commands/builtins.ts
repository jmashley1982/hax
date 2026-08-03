/**
 * The global keyword vocabulary for Phase 3. Not mission-gated yet (that's
 * Phase 5's job -- missions will layer their own `commandRoutes` on top of
 * this), just the always-available verbs that make typing real hacking
 * words feel meaningfully better than typing nonsense.
 *
 * Each route names the bank/key its response is drawn from, reusing the
 * Phase 2 content banks rather than inventing new copy -- "scan" sounds
 * like a scan because it draws from the same netops.scanLine bank the
 * ambient chaos does.
 */
export interface Route {
  bank: string
  key: string
}

export const KEYWORD_ROUTES: Record<string, Route> = {
  scan: { bank: 'netops', key: 'scanLine' },
  ping: { bank: 'netops', key: 'scanLine' },
  trace: { bank: 'netops', key: 'scanLine' },
  connect: { bank: 'netops', key: 'scanLine' },
  pivot: { bank: 'netops', key: 'scanLine' },

  exploit: { bank: 'exploit', key: 'stage' },
  hack: { bank: 'exploit', key: 'stage' },
  backdoor: { bank: 'exploit', key: 'stage' },
  breach: { bank: 'exploit', key: 'stage' },
  infiltrate: { bank: 'exploit', key: 'stage' },

  access: { bank: 'exploit', key: 'privesc' },
  root: { bank: 'exploit', key: 'privesc' },
  sudo: { bank: 'exploit', key: 'privesc' },
  escalate: { bank: 'exploit', key: 'privesc' },

  decrypt: { bank: 'crypto', key: 'decrypt' },
  crack: { bank: 'crypto', key: 'decrypt' },
  bypass: { bank: 'crypto', key: 'decrypt' },
  unlock: { bank: 'crypto', key: 'decrypt' },

  inject: { bank: 'flavor', key: 'ambientChaos' },
  spoof: { bank: 'flavor', key: 'ambientChaos' },

  code: { bank: 'filesystem', key: 'grepHit' },
  grep: { bank: 'filesystem', key: 'grepHit' },
  ls: { bank: 'filesystem', key: 'dirEntry' },
  cat: { bank: 'filesystem', key: 'dirEntry' },
  enumerate: { bank: 'filesystem', key: 'dirEntry' },

  terminal: { bank: 'kernel', key: 'dmesg' },
  kernel: { bank: 'kernel', key: 'dmesg' },

  override: { bank: 'physical', key: 'scada' },
}

/**
 * Softer, hacking-adjacent nouns that don't have a dedicated verb route but
 * should still feel "on the right track" rather than pure nonsense.
 */
export const THEMATIC_WORDS = new Set([
  'password', 'firewall', 'network', 'server', 'database', 'port', 'key',
  'cipher', 'admin', 'credential', 'socket', 'packet', 'node', 'protocol',
  'vulnerability', 'shell', 'encrypt', 'tunnel', 'proxy', 'router', 'login',
  'session', 'token', 'payload', 'malware', 'worm', 'trojan', 'ransomware',
])
