import type { StoredEntry } from '../store/repository'
import { UNKNOWN_EDITION } from '../wire'
import { workDesignation } from './work-designation'

const workKey = (designation: string | null): string | null =>
  workDesignation(designation)?.replace(/\s+/g, ' ').trim().toUpperCase() || null

export const editionKey = (label: string | null): string | null => {
  const key = label?.trim().toLowerCase() ?? ''
  return key && key !== UNKNOWN_EDITION ? key : null
}

const startOf = (entry: StoredEntry): string => entry.values.inForceFrom ?? entry.values.issuedOn ?? entry.values.editionLabel

export function confirmedWorkOf(entries: readonly StoredEntry[], designation: string | null): StoredEntry | undefined {
  const key = workKey(designation)
  if (!key) return undefined
  return entries
    .filter((entry) => entry.confirmed && workKey(entry.values.designation) === key)
    .sort((a, b) => startOf(b).localeCompare(startOf(a)))[0]
}

export function heldEditionsOf(entry: StoredEntry, entries: readonly StoredEntry[]): StoredEntry[] {
  return entries
    .filter((other) => other.workId === entry.workId && other.editionId !== entry.editionId && other.confirmed)
    .sort((a, b) => startOf(b).localeCompare(startOf(a)))
}

export function isDuplicateEdition(editionLabel: string | null, held: readonly StoredEntry[]): boolean {
  const key = editionKey(editionLabel)
  return key !== null && held.some((other) => editionKey(other.values.editionLabel) === key)
}
