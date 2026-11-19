import { newestInForce } from '../time/editions'
import type { StoredEntry } from '../store/repository'
import { ASK_FOR_LICENCE, type EntryEdition } from '../wire'
import { designationKey } from '../platform'
import { bindingOf, type BindingNorms } from './binding-edition'

const startOf = (entry: StoredEntry) => entry.values.inForceFrom ?? entry.values.issuedOn

export function editionsByWork(entries: readonly StoredEntry[]): Map<string, StoredEntry[]> {
  const works = new Map<string, StoredEntry[]>()
  for (const entry of entries) works.set(entry.workId, [...(works.get(entry.workId) ?? []), entry])
  return works
}

export function newestOf(editions: readonly StoredEntry[]): StoredEntry {
  return [...editions].sort((a, b) => (startOf(b) ?? '').localeCompare(startOf(a) ?? '') || b.createdAt.getTime() - a.createdAt.getTime())[0]
}

export function editionOnDay(editions: readonly StoredEntry[], day: string): StoredEntry | null {
  const confirmed = editions.filter((entry) => entry.confirmed)
  const found = newestInForce(
    confirmed.map((entry) => ({ id: entry.editionId, label: entry.values.editionLabel, inForceFrom: startOf(entry), inForceTo: entry.values.inForceTo, transition: null })),
    day,
  )
  if (found.status === 'determined') return confirmed.find((entry) => entry.editionId === found.edition.id) ?? null
  const undated = confirmed.filter((entry) => startOf(entry) === null && (entry.values.inForceTo === null || entry.values.inForceTo > day))
  return undated.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
}

export function editionsOf(entry: StoredEntry, works: ReadonlyMap<string, StoredEntry[]>, day: string): EntryEdition[] {
  const editions = works.get(entry.workId) ?? [entry]
  const current = editionOnDay(editions, day)
  return [...editions]
    .sort((a, b) => (startOf(b) ?? '').localeCompare(startOf(a) ?? '') || b.createdAt.getTime() - a.createdAt.getTime())
    .map((edition) => ({
      id: edition.editionId,
      editionLabel: edition.values.editionLabel,
      startsOn: startOf(edition),
      status: edition.confirmed ? 'confirmed' : 'proposed',
      inForceToday: edition === current,
    }))
}

function designationOf(editions: readonly StoredEntry[]): string | null {
  return editions.find((entry) => entry.confirmed && entry.values.designation)?.values.designation ?? null
}

export function editionsForDay(readable: readonly StoredEntry[], bindings: BindingNorms, day: string): StoredEntry[] {
  const chosen = new Set<StoredEntry>()
  for (const editions of editionsByWork(readable).values()) {
    const designation = designationOf(editions)
    const verdict = bindingOf(editions, designation ? bindings.get(designationKey(designation)) : undefined)
    const current = verdict.status === 'held' ? verdict.entry : editionOnDay(editions, day)
    if (current) chosen.add(current)
  }
  return readable.filter((entry) => (entry.confirmed ? chosen.has(entry) : ASK_FOR_LICENCE && entry.values.licenceClass === 'licensed'))
}
