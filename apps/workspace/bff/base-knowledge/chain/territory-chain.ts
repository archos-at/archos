export type { TerritoryParent } from '@/lib/db/schema/knowledge-platform'
import type { TerritoryParent } from '@/lib/db/schema/knowledge-platform'

export function walkSeeds(leafId: string): string[] {
  const iso = /^([A-Z]{2})-/.exec(leafId)?.[1]
  return iso ? [leafId, iso] : [leafId]
}

const MAX_CHAIN = 32

export function inInterval(date: string, from: string | null | undefined, to: string | null | undefined): boolean {
  return (!from || from <= date) && (!to || date < to)
}

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
