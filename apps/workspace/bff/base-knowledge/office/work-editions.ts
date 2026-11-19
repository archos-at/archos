import { newestInForce } from '../time/editions'
import type { StoredEntry } from '../store/repository'
import type { EntryEdition } from '../wire'
import { designationKey, type DirectoryWork } from '../platform'
import { bindingOnDay } from './binding-edition'
import type { MissingEdition } from './turn-block'
import { workDesignation } from './work-designation'

const startOf = (entry: StoredEntry) => entry.values.inForceFrom ?? entry.values.issuedOn

export function editionsByWork(entries: readonly StoredEntry[]): Map<string, StoredEntry[]> {
  const works = new Map<string, StoredEntry[]>()
  for (const entry of entries) works.set(entry.workId, [...(works.get(entry.workId) ?? []), entry])
  return works
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

export interface EditionsForDay {
  stored: StoredEntry[]
  missing: MissingEdition[]
}

function designationOf(editions: readonly StoredEntry[]): string | null {
  return editions.find((entry) => entry.confirmed && entry.values.designation)?.values.designation ?? null
}

function missingEdition(designation: string, binding: string, held: readonly StoredEntry[], files: ReadonlyMap<string, { fileName: string }>): MissingEdition {
  return {
    designation: workDesignation(designation) ?? designation,
    title: held[0]?.values.title ?? '',
    binding,
    held: held.map((entry) => ({ editionLabel: entry.values.editionLabel, fileName: files.get(entry.documentId)?.fileName ?? '' })),
  }
}

export function editionsForDay(
  readable: readonly StoredEntry[],
  directory: readonly DirectoryWork[],
  day: string,
  files: ReadonlyMap<string, { fileName: string }>,
): EditionsForDay {
  const byKey = new Map(directory.map((work) => [designationKey(work.designation), work]))
  const missing: MissingEdition[] = []
  const chosen = new Set<StoredEntry>()
  for (const editions of editionsByWork(readable).values()) {
    const designation = designationOf(editions)
    const verdict = bindingOnDay(editions, designation ? byKey.get(designationKey(designation)) : undefined, day)
    if (verdict.status === 'missing' && designation) missing.push(missingEdition(designation, verdict.binding.label, verdict.held, files))
    const current = verdict.status === 'held' ? verdict.entry : verdict.status === 'unknown' ? editionOnDay(editions, day) : null
    if (current) chosen.add(current)
  }
  const stored = readable.filter((entry) => (entry.confirmed ? chosen.has(entry) : entry.values.licenceClass === 'licensed'))
  return { stored, missing }
}
