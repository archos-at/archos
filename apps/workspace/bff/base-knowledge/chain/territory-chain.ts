/**
 * Every territory a place lies in on a day (design §3.2): the one walk over
 * territory parents. Pure. The chain resolver walks the graph with it, the
 * time path and the site resolution walk the parents they read with it, so
 * `AT` lies in `EU` from 1995-01-01 on every path.
 *
 * A parent holds on the day its half-open interval covers (an absent date is
 * open), and an ISO 3166-2 code lies in its country whether or not its record
 * says so.
 */

/** A territory's parent, for an interval when it states one (design §3.2 `parents`); the column's own type. */
export type { TerritoryParent } from '@/lib/db/schema/knowledge-platform'
import type { TerritoryParent } from '@/lib/db/schema/knowledge-platform'

/**
 * Where a walk over the stored parents starts: the place, and the country an
 * ISO 3166-2 code lies in whether or not its record says so. Both SQL loaders
 * (`chain/load.ts`, `platform/territories.ts`) seed with it, so a Land that
 * states no parent, or has no record, reaches its country's parents (`EU`) on
 * every path.
 */
export function walkSeeds(leafId: string): string[] {
  const iso = /^([A-Z]{2})-/.exec(leafId)?.[1]
  return iso ? [leafId, iso] : [leafId]
}

/** Most territories one chain holds: a guard against a cycle the records should never have. */
const MAX_CHAIN = 32

/** Half-open: from inclusive, to exclusive; a missing end is open. */
export function inInterval(date: string, from: string | null | undefined, to: string | null | undefined): boolean {
  return (!from || from <= date) && (!to || date < to)
}

/** The place `leafId` first, then every territory it lies in on `date`, nearest first. */
export function chainAt(leafId: string, date: string, parentsOf: (id: string) => readonly TerritoryParent[] | undefined): string[] {
  const chain: string[] = []
  const queue = [leafId]
  while (queue.length > 0 && chain.length < MAX_CHAIN) {
    const next = queue.shift() as string
    if (chain.includes(next)) continue
    chain.push(next)
    const parents = parentsOf(next) ?? []
    queue.push(...parents.filter((parent) => inInterval(date, parent.validFrom, parent.validTo)).map((parent) => parent.id))
    const iso = /^([A-Z]{2})-/.exec(next)
    if (iso) queue.push(iso[1])
  }
  return chain
}
