/**
 * Which edition of a work was in force on a day (ADR-0171, design §3.4). Pure.
 *
 * The one answer to "which edition was in force on a day": the time path
 * (`./as-of.ts`) and the chain resolver (`../chain/resolve.ts`) both ask it.
 * An edition is in force on the half-open interval `[inForceFrom, inForceTo)`:
 * `inForceTo` is the first day it no longer holds, the same reading as every
 * other interval in base knowledge (relations, territories, rulesets), so a
 * successor's `inForceFrom` equals its predecessor's `inForceTo`. A source
 * that prints the last day in force (RIS's Außerkrafttretensdatum, ELI's
 * `date_no_longer_in_force`) is entered one day later: the RIS lookup reads
 * its last day inclusive, and KC-3 refuses a proposal whose edition ends the
 * day before its successor begins, the trace of a copied last day. Fail
 * closed at every gap in the data:
 * - a day before the history the platform holds is `history_not_held`, never
 *   the oldest edition it happens to have;
 * - an edition without an in-force date could be the one, so its work answers
 *   `edition_dates_unknown` until somebody dates it;
 * - two editions in force on one day are a data error, `ambiguous_editions`.
 */

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

/**
 * The edition in force on `day`. `historyAvailableFrom` is the first day the
 * work's history is held; null means only the editions present, so a day
 * before the oldest of them is not held either.
 */
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

/**
 * The newest edition on `day` of a work whose editions succeed each other
 * without an end date of their own (a norm, a guideline, a commentary: a new
 * Ausgabe replaces the old one): the latest that started on or before `day`
 * and has not ended (`inForceTo`, exclusive, marks a withdrawal). Undated
 * editions are ignored. Law asks {@link editionInForce}, where two editions
 * in force on one day are a data error.
 */
export function newestInForce(editions: readonly DatedEdition[], day: string): EditionOnDay {
  if (!isIsoDate(day)) throw new RangeError(`day is an ISO date, found ${day}`)
  const [edition] = editions
    .filter((candidate) => candidate.inForceFrom !== null && covers(candidate, day))
    .sort((a, b) => (b.inForceFrom as string).localeCompare(a.inForceFrom as string) || b.id.localeCompare(a.id))
  return edition ? { status: 'determined', edition } : { status: 'undetermined', reason: 'no_edition_in_force' }
}

/** The day after `day`, an ISO date. */
export function dayAfter(day: string): string {
  if (!isIsoDate(day)) throw new RangeError(`day is an ISO date, found ${day}`)
  const next = new Date(`${day}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

/** The editions that come into force after `after` and on or before `until` (null: no end), oldest first. */
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
