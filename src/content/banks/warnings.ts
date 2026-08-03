import type { Bank } from '../grammar'

/** Alerts, IDS trips, countermeasure notices. */
export const warnings: Bank = {
  idsAlert: [
    { t: '[{severity}] IDS: {adjective} traffic pattern from {ip}', w: 3 },
    { t: '[{severity}] signature match: possible intrusion on {host}', w: 2 },
    { t: '[{severity}] rate limit exceeded -- {int:2-40} req/s from {ip}', w: 2 },
    { t: '[{severity}] SOC ticket #{int:10000-99999} opened', w: 1 },
  ],
  countermeasure: [
    { t: 'firewall rule updated -- blocking {cidr}', w: 2 },
    { t: 'session {uuid} flagged for review', w: 2 },
    { t: 'honeypot triggered -- feeding decoy responses', w: 1 },
    { t: 'trace initiated -- estimated resolve in {int:20-180}s', w: 1 },
  ],
  traceWarning: [
    'WARNING: connection origin being traced',
    'WARNING: your session is under active analysis',
    'WARNING: countermeasures deploying',
  ],
  systemDenial: [
    { t: 'ACCESS DENIED :: {reason}', w: 3 },
    { t: 'AUTHENTICATION FAILED ({int:1-4}/5 attempts)', w: 2 },
  ],
  reason: [
    'insufficient privilege', 'credential expired', 'account locked',
    'source IP blacklisted', 'MFA challenge failed',
  ],
}
