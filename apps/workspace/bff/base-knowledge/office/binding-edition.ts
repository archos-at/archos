import type { DirectoryEdition, DirectoryWork } from '../platform'
import type { StoredEntry } from '../store/repository'
import { newestInForce } from '../time/editions'

export type BindingOnDay =
  | { status: 'held'; entry: StoredEntry }
  | { status: 'missing'; binding: DirectoryEdition; held: StoredEntry[] }
  | { status: 'unknown' }

const ISO_DAY = /\d{4}-\d{2}-\d{2}/g

const labelKey = (label: string) => label.toLocaleLowerCase('de').replace(/\s+/g, ' ').trim()

function daysOf(label: string, ...days: (string | null)[]): Set<string> {
  return new Set([...days.filter((day): day is string => day !== null), ...(label.match(ISO_DAY) ?? [])])
}

export function isSameEdition(entry: StoredEntry, edition: DirectoryEdition): boolean {
  if (labelKey(entry.values.editionLabel) === labelKey(edition.label)) return true
  const ours = daysOf(entry.values.editionLabel, entry.values.issuedOn, entry.values.inForceFrom)
  return [...daysOf(edition.label, edition.issuedOn, edition.inForceFrom)].some((day) => ours.has(day))
}

export function directoryEditionOnDay(work: DirectoryWork, day: string): DirectoryEdition | null {
  const dated = work.editions.map((edition, index) => ({ edition, id: String(index) }))
  const found = newestInForce(
    dated.map(({ edition, id }) => ({ id, label: edition.label, inForceFrom: edition.inForceFrom, inForceTo: edition.inForceTo, transition: null })),
    day,
  )
  return found.status === 'determined' ? (work.editions[Number(found.edition.id)] ?? null) : null
}

export function bindingOnDay(editions: readonly StoredEntry[], work: DirectoryWork | undefined, day: string): BindingOnDay {
  const binding = work ? directoryEditionOnDay(work, day) : null
  if (!binding) return { status: 'unknown' }
  const held = editions.filter((entry) => entry.confirmed)
  const matching = held.filter((entry) => isSameEdition(entry, binding)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const [entry] = matching
  return entry ? { status: 'held', entry } : { status: 'missing', binding, held }
}
