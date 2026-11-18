import type { DatedEdition, EditionRef } from '@/lib/base-knowledge/wire/time'

export type EditionOnDay =
  | { status: 'determined'; edition: DatedEdition }
  | { status: 'undetermined'; reason: 'history_not_held'; historyAvailableFrom: string | null }
  | { status: 'undetermined'; reason: 'edition_dates_unknown'; editionIds: string[] }
  | { status: 'undetermined'; reason: 'ambiguous_editions'; editionIds: string[] }
  | { status: 'undetermined'; reason: 'no_edition_in_force' }

export function editionRef(edition: DatedEdition): EditionRef {
  const { id, label, inForceFrom, inForceTo } = edition
  return { id, label, inForceFrom, inForceTo }
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function covers(edition: DatedEdition, day: string): boolean {
  const from = edition.inForceFrom as string
  return from <= day && (edition.inForceTo === null || day < edition.inForceTo)
}

export function editionInForce(
  editions: readonly DatedEdition[],
  day: string,
  historyAvailableFrom: string | null
): EditionOnDay {
  if (!isIsoDate(day)) throw new RangeError(`day is an ISO date, found ${day}`)
  if (historyAvailableFrom !== null && day < historyAvailableFrom)
    return { status: 'undetermined', reason: 'history_not_held', historyAvailableFrom }
  const undated = editions.filter((edition) => edition.inForceFrom === null)
  if (undated.length > 0)
    return {
      status: 'undetermined',
      reason: 'edition_dates_unknown',
      editionIds: undated.map((edition) => edition.id).sort(),
    }
  const found = editions.filter((edition) => covers(edition, day))
  if (found.length > 1)
    return {
      status: 'undetermined',
      reason: 'ambiguous_editions',
      editionIds: found.map((edition) => edition.id).sort(),
    }
  const [edition] = found
  if (edition) return { status: 'determined', edition }
  const oldest = editions.map((candidate) => candidate.inForceFrom as string).sort()[0]
  if (historyAvailableFrom === null && (oldest === undefined || day < oldest))
    return { status: 'undetermined', reason: 'history_not_held', historyAvailableFrom }
  return { status: 'undetermined', reason: 'no_edition_in_force' }
}

export function newestInForce(editions: readonly DatedEdition[], day: string): EditionOnDay {
  if (!isIsoDate(day)) throw new RangeError(`day is an ISO date, found ${day}`)
  const [edition] = editions
    .filter((candidate) => candidate.inForceFrom !== null && covers(candidate, day))
    .sort((a, b) => (b.inForceFrom as string).localeCompare(a.inForceFrom as string) || b.id.localeCompare(a.id))
  return edition ? { status: 'determined', edition } : { status: 'undetermined', reason: 'no_edition_in_force' }
}

export function dayAfter(day: string): string {
  if (!isIsoDate(day)) throw new RangeError(`day is an ISO date, found ${day}`)
  const next = new Date(`${day}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

export function boundariesBetween(
  editions: readonly DatedEdition[],
  after: string,
  until: string | null
): DatedEdition[] {
  return editions
    .filter((edition) => {
      const from = edition.inForceFrom
      return from !== null && from > after && (until === null || from <= until)
    })
    .sort((a, b) => (a.inForceFrom as string).localeCompare(b.inForceFrom as string))
}
