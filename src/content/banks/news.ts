import type { Bank } from '../grammar'

/**
 * Faux press coverage of the target.
 *
 * A content bank rather than a local array inside intelWindow.ts, for two
 * reasons that both matter: the grammar engine's recent-use suppression
 * comes for free (a local array would visibly repeat within one run), and
 * `scripts/contentAudit.ts` can see it, so the collision rate of these
 * lines is measurable like every other bank's.
 *
 * Registration is three lines in content/index.ts and touches no engine
 * code.
 */
export const news: Bank = {
  headline: [
    { t: '{org} confirms leadership shake-up ahead of Q3', w: 2 },
    { t: 'Regulators open informal review into {org}', w: 2 },
    { t: '{org} shares slip on supply chain warning', w: 2 },
    { t: 'Inside {org}: the quiet giant nobody can name', w: 1 },
    { t: '{org} awarded framework contract worth {int:40-900}m', w: 2 },
    { t: 'Union talks stall at {org} as shift patterns change', w: 1 },
    { t: '{org} to close {int:2-9} sites in restructuring', w: 2 },
    { t: 'Former {org} engineer alleges safety shortcuts', w: 1 },
    { t: '{org} names new head of information security', w: 2 },
    { t: 'Analysts cool on {org} after guidance revision', w: 1 },
  ],
  dek: [
    { t: 'Executives declined to comment on the timing.', w: 2 },
    { t: 'The company said operations were unaffected.', w: 3 },
    { t: 'Two people familiar with the matter described a tense week.', w: 2 },
    { t: 'It is the third such announcement this year.', w: 2 },
    { t: 'Staff were told by email shortly before markets opened.', w: 2 },
    { t: 'The filing gave no figure for the expected cost.', w: 1 },
  ],
  byline: [
    { t: '{person}', w: 3 },
  ],
  outlet: [
    { t: 'THE MERIDIAN POST', w: 2 },
    { t: 'CHANNEL 9 BUSINESS', w: 2 },
    { t: 'WIRE & LEDGER', w: 2 },
    { t: 'THE DAILY RECORD', w: 2 },
    { t: 'NORTHGATE TRIBUNE', w: 1 },
  ],
  /** Fires once the run is deep -- the break becomes the story. */
  breaking: [
    { t: 'BREAKING: {org} reports "network disruption" at multiple sites', w: 3 },
    { t: 'BREAKING: Outage hits {org} systems, cause unclear', w: 3 },
    { t: 'BREAKING: {org} takes services offline "as a precaution"', w: 2 },
    { t: 'BREAKING: Emergency crews attend {org} facility', w: 2 },
  ],
}
