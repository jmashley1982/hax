/**
 * In-fiction chat traffic (plan §16G / §16H).
 *
 * Two channels that mirror each other, which is what turns the pop-ups
 * from decoration into a mechanic:
 *
 *   OPERATORS -- the target's own staff, who have noticed you. They
 *   escalate with depth and heat: curious, then irritated, then
 *   threatening, then personal. They also foreshadow the reverse hack, so
 *   the taunts read as the opponent winding up rather than flavour.
 *
 *   ALLIES -- other hackers, who arrive *before* the thing they warn about
 *   and hand you the answer. Reading them is a real edge; ignoring them is
 *   survivable.
 *
 * `{org}` / `{handle}` / `{code}` are substituted by the caller.
 */

export interface MessageLine {
  from: string
  text: string
}

/** Tier 0-3, rising with depth + heat. */
export const OPERATOR_TAUNTS: readonly (readonly MessageLine[])[] = [
  [
    { from: 'noc@{org}', text: 'seeing weird auth failures on the edge. anyone else?' },
    { from: 'sysadmin@{org}', text: 'who is scanning us at this hour' },
    { from: 'oncall@{org}', text: 'that traffic pattern is not one of ours.' },
  ],
  [
    { from: 'secops@{org}', text: 'ok we see you. cute.' },
    { from: 'sysadmin@{org}', text: 'whatever you think you found, we have backups.' },
    { from: 'noc@{org}', text: 'get off our box.' },
  ],
  [
    { from: 'secops@{org}', text: 'you are going to regret this one.' },
    { from: 'ir-lead@{org}', text: 'we are already pulling your route. keep going, please.' },
    { from: 'secops@{org}', text: 'enjoy it while it lasts. we are coming down the tunnel.' },
  ],
  [
    { from: 'ir-lead@{org}', text: 'we have your exit node, {handle}. that was sloppy.' },
    { from: 'secops@{org}', text: 'hope that machine of yours is backed up, {handle}.' },
    { from: 'ir-lead@{org}', text: 'we are on your side of the wire now. say hi.' },
  ],
]

export const ALLY_HANDLES = ['nullwidow', 'pyre', 'k0bold', 'saltmarsh', 'ghostwire', 'dead_air'] as const

/** Each carries an actual answer, delivered before the thing it applies to. */
export const ALLY_TIPS = {
  vaultKey: [
    'heads up -- if {org} asks for a vault key tonight it is {code}. burn it after.',
    '{code}. that is their recovery key. you did not get it from me.',
  ],
  badFiles: [
    'do NOT pull anything from {org} signed after the 14th. they poisoned the share.',
    'their .pem files are booby-trapped this week. scan before you grab.',
  ],
  incoming: [
    '{org} is spinning up a counter-op. get your integrity up NOW.',
    'their IR team just got paged. you have maybe a minute.',
  ],
  route: [
    'take the legacy VPN into {org}, the new gateway is a canary.',
    'avoid anything they patched this week -- that is where the tripwires are.',
  ],
} as const
