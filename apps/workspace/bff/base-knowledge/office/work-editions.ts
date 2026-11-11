/**
 * Which of the office's editions of a standard is in force on a day: the
 * platform's own rule for a standard, guideline or commentary
 * (`time/editions.ts` `newestInForce`, as `chain/resolve.ts` asks it), over the
 * office's editions of one work (`store/office-editions.ts`). An edition starts
 * on its in-force date, else the day it was issued, as the platform counts a
 * non-law edition (`datedEdition` in `chain/resolve.ts`). Pure.
 *
 * One office edition without a usable date (a commentary that names only its
 * year) is still the office's edition: when the rule determines none, the
 * newest confirmed edition answers, and the answer names which one it is.
 */

import { newestInForce } from '../time/editions'
import type { StoredEntry } from '../store/repository'
import type { EntryEdition } from '../wire'

const startOf = (entry: StoredEntry) => entry.values.inForceFrom ?? entry.values.issuedOn

/** The confirmed editions of each work, by work id. */
export function editionsByWork(entries: readonly StoredEntry[]): Map<string, StoredEntry[]> {
  const works = new Map<string, StoredEntry[]>()
  for (const entry of entries) works.set(entry.workId, [...(works.get(entry.workId) ?? []), entry])
  return works
}

/** The edition of a work in force on `day` (YYYY-MM-DD), among its confirmed editions; null when none is confirmed. */
export function editionOnDay(editions: readonly StoredEntry[], day: string): StoredEntry | null {
  const confirmed = editions.filter((entry) => entry.confirmed)
  const found = newestInForce(
    confirmed.map((entry) => ({ id: entry.editionId, label: entry.values.editionLabel, inForceFrom: startOf(entry), inForceTo: entry.values.inForceTo, transition: null })),
    day,
  )
  if (found.status === 'determined') return confirmed.find((entry) => entry.editionId === found.edition.id) ?? null
  return [...confirmed].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
}

/** Every edition of `entry`'s work the office holds, newest start first, with the one in force on `day` marked. */
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
