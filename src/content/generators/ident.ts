import { int, pick, type Rng } from '@/core/rng'

/** People, orgs, badge IDs — the "world facts" layer that makes generated text feel like it belongs to one coherent target instead of random noise. */

const GIVEN_NAMES = [
  'Alex', 'Priya', 'Marcus', 'Elena', 'Jae', 'Fatima', 'Dmitri', 'Nora',
  'Kwame', 'Yuki', 'Sofia', 'Omar', 'Ingrid', 'Tomas', 'Aisha', 'Viktor',
  'Lena', 'Ravi', 'Chidi', 'Mei', 'Sana', 'Bjorn', 'Ana', 'Kenji',
] as const

const SURNAMES = [
  'Voss', 'Achebe', 'Kowalski', 'Rousseau', 'Tanaka', 'Okafor', 'Ibrahim',
  'Sorensen', 'Castillo', 'Petrov', 'Lindqvist', 'Adeyemi', 'Nakamura',
  'Fischer', 'Haddad', 'Moreau', 'Novak', 'Singh', 'Dubois', 'Berg',
] as const

const TITLES = [
  'Systems Administrator', 'Network Engineer', 'Site Reliability Lead',
  'Security Analyst', 'Facilities Manager', 'Database Administrator',
  'IT Director', 'DevOps Engineer', 'Compliance Officer', 'Night Supervisor',
] as const

const ORG_ROOTS = [
  'Halcyon', 'Meridian', 'Ironclad', 'Vantage', 'Obsidian', 'Northgate',
  'Silverline', 'Ashford', 'Continuum', 'Blackwell', 'Sterling', 'Redshift',
] as const

const ORG_SUFFIXES = [
  'Dynamics', 'Systems', 'Holdings', 'Industries', 'Group', 'Networks',
  'Logistics', 'Biotech', 'Financial', 'Energy',
] as const

export interface Person {
  given: string
  surname: string
  title: string
  username: string
  badge: string
}

export function person(rng: Rng): Person {
  const given = pick(rng, GIVEN_NAMES)
  const surname = pick(rng, SURNAMES)
  return {
    given,
    surname,
    title: pick(rng, TITLES),
    username: `${given[0]!.toLowerCase()}.${surname.toLowerCase()}`,
    badge: `B-${int(rng, 1000, 9999)}`,
  }
}

export function orgName(rng: Rng): string {
  return `${pick(rng, ORG_ROOTS)} ${pick(rng, ORG_SUFFIXES)}`
}
