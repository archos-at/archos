import type { RegisterRow } from './store'
import type { ParsedAddress } from './parse'
import { houseKey, placeKey } from './normalize'
import type { UNVERIFIED_REASONS } from './wire'

export type MatchOutcome =
  | { status: 'one'; row: RegisterRow }
  | { status: 'none'; reason: (typeof UNVERIFIED_REASONS)[number]; rows: RegisterRow[] }

export function houseKeysOf(parsed: ParsedAddress): string[] {
  const keys = [houseKey(parsed.houseNumber)]
  if (parsed.doorless) keys.push(houseKey(parsed.doorless))
  return [...new Set(keys)]
}

export function usablePostcode(parsed: ParsedAddress, postcodeShape: RegExp): string | null {
  return parsed.postcode && postcodeShape.test(parsed.postcode) ? parsed.postcode : null
}

export function placeKeysOf(place: string): string[] {
  const first = place.split(/[-,/]/)[0]?.trim() ?? ''
  return [...new Set([placeKey(place), placeKey(first)].filter(Boolean))]
}

function inPlace(row: RegisterRow, keys: readonly string[]): boolean {
  return row.placeKeys.some((place) => keys.includes(place))
}

export interface Narrowed {
  rows: RegisterRow[]
  conflict: boolean
}

export function narrow(parsed: ParsedAddress, rows: readonly RegisterRow[], postcodeShape: RegExp): Narrowed {
  const typedKey = houseKey(parsed.houseNumber)
  const exact = rows.filter((row) => row.houseKey === typedKey)
  let candidates = exact.length > 0 ? exact : [...rows]
  const postcode = usablePostcode(parsed, postcodeShape)
  if (postcode) candidates = candidates.filter((row) => row.postcode === postcode)
  if (!parsed.place) return { rows: candidates, conflict: false }
  const keys = placeKeysOf(parsed.place)
  const placed = candidates.filter((row) => inPlace(row, keys))
  if (placed.length === 0 && postcode && candidates.length > 0) return { rows: candidates, conflict: true }
  return { rows: placed, conflict: false }
}

export function outcomeOf(rows: readonly RegisterRow[], conflict = false): MatchOutcome {
  if (conflict) return { status: 'none', reason: 'conflict', rows: [...rows] }
  if (rows.length === 1) return { status: 'one', row: rows[0] }
  if (rows.length === 0) return { status: 'none', reason: 'no_register_hit', rows: [] }
  const municipalities = new Set(rows.map((row) => `${row.release.register}:${row.municipalityCode}`))
  return { status: 'none', reason: municipalities.size > 1 ? 'multi_leaf' : 'ambiguous', rows: [...rows] }
}
