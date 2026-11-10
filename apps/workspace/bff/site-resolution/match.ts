/**
 * From the register rows a typed line's street and house number found, to the
 * one address it names or the reason it names none (ADR-0172). Pure.
 *
 * Every filter only removes rows; nothing is ranked or guessed.
 * - The house number as typed wins over the number before a `/`: `12/3/4` is
 *   looked up as `12/3/4` and, only when that is not an address, as `12`.
 * - A postcode of the register's country's shape must match. Any other
 *   postcode (Riezlern typed with Germany's 87567, design E30) is not a filter.
 * - A place must be the municipality, the locality or the delivery place,
 *   unless a postcode already matched: then a district written in the place
 *   ("Wien-Innere Stadt") does not undo the match.
 */

import type { RegisterRow } from './store'
import type { ParsedAddress } from './parse'
import { houseKey, placeKey } from './normalize'
import type { UNVERIFIED_REASONS } from './wire'

export type MatchOutcome =
  | { status: 'one'; row: RegisterRow }
  | { status: 'none'; reason: (typeof UNVERIFIED_REASONS)[number]; rows: RegisterRow[] }

/** The house keys a parsed line is looked up by, the typed one first. */
export function houseKeysOf(parsed: ParsedAddress): string[] {
  const keys = [houseKey(parsed.houseNumber)]
  if (parsed.doorless) keys.push(houseKey(parsed.doorless))
  return [...new Set(keys)]
}

/** The line's postcode when it has the register country's shape, else null: then it is no filter. */
export function usablePostcode(parsed: ParsedAddress, postcodeShape: RegExp): string | null {
  return parsed.postcode && postcodeShape.test(parsed.postcode) ? parsed.postcode : null
}

/** The rows a parsed line names, narrowed by postcode and place. */
export function narrow(parsed: ParsedAddress, rows: readonly RegisterRow[], postcodeShape: RegExp): RegisterRow[] {
  const typedKey = houseKey(parsed.houseNumber)
  const exact = rows.filter((row) => row.houseKey === typedKey)
  let candidates = exact.length > 0 ? exact : [...rows]
  const postcode = usablePostcode(parsed, postcodeShape)
  if (postcode) candidates = candidates.filter((row) => row.postcode === postcode)
  if (parsed.place) {
    const key = placeKey(parsed.place)
    const placed = candidates.filter((row) => row.placeKeys.includes(key))
    if (placed.length > 0 || !postcode) candidates = placed
  }
  return candidates
}

/** One row, or why not: no row, several in one municipality, or several municipalities. */
export function outcomeOf(rows: readonly RegisterRow[]): MatchOutcome {
  if (rows.length === 1) return { status: 'one', row: rows[0] }
  if (rows.length === 0) return { status: 'none', reason: 'no_register_hit', rows: [] }
  const municipalities = new Set(rows.map((row) => `${row.release.register}:${row.municipalityCode}`))
  return { status: 'none', reason: municipalities.size > 1 ? 'multi_leaf' : 'ambiguous', rows: [...rows] }
}
