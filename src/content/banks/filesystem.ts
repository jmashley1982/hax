import type { Bank } from '../grammar'

/** Plausible directory trees and file listings. */
export const filesystem: Bank = {
  dirEntry: [
    { t: 'drwx------  {int:2-12}  {username}  {int:2-9}.{int:0-9}K  {dirname}/', w: 2 },
    { t: '-rw-r-----  1  {username}  {int:1-999}K  {filename}', w: 3 },
    { t: '-rwx------  1  root  {int:1-99}K  {exename} [pid {int:200-65000}]', w: 1 },
  ],
  dirname: ['backups', 'staging', 'private', 'archive', 'incoming', 'logs', 'secure', 'tmp', '.config'],
  filename: [
    { t: '{word}_{int:2019-2026}.bak', w: 2 },
    { t: '{word}.{ext}', w: 3 },
    { t: '.{word}_hidden', w: 1 },
  ],
  word: ['payroll', 'access_matrix', 'incident_report', 'vault_manifest', 'staff_roster', 'firmware_dump', 'keychain'],
  ext: ['sql', 'csv', 'log', 'conf', 'zip', 'pem', 'db'],
  exename: ['agent', 'watchdog', 'syncd', 'updater', 'relay'],
  grepHit: [
    { t: '{path}:{int:1-400}: {sql}', w: 2 },
    { t: '{path}:{int:1-400}: {config}', w: 2 },
    { t: 'match in {path} -- {int:1-40} occurrences', w: 1 },
  ],
  path: [
    { t: '/var/{dirname}/{filename}', w: 2 },
    { t: '/home/{username}/{dirname}/{filename}', w: 1 },
    { t: '/opt/app/{dirname}/{filename}', w: 1 },
  ],
}
