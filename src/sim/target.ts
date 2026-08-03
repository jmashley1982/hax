import { int, type Rng } from '@/core/rng'
import { orgName } from '@/content/generators/ident'
import type { MissionFacts } from '@/content/grammar'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

/**
 * A persistent fictional target, generated once per run.
 *
 * Without this, every generated line and panel title is anonymous, and
 * the whole thing reads as "a sci-fi computer terminal" rather than
 * breaking into a specific organization. Threading one org/domain/subnet
 * through the content engine AND the panel titles/threat alerts is what
 * makes it read as *this* company's network, not a puzzle-game skin.
 */
export function generateTarget(rng: Rng): MissionFacts {
  const org = orgName(rng)
  const domain = `${slugify(org)}.net`
  const subnet = `10.${int(rng, 10, 250)}.0.0/16`
  return { org, domain, subnet }
}
