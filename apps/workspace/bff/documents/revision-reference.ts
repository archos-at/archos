import { isUuid } from '@/lib/ids'
import { documentNameKey } from './name-match'

export const revisionReferenceKey = (reference: string): string => (isUuid(reference) ? reference : documentNameKey(reference))

export function revisionCounterpartOf<T extends { id: string; filename: string }>(rows: readonly T[], reference: string): T | null {
  const byId = rows.find((row) => row.id === reference)
  if (byId) return byId
  const key = documentNameKey(reference)
  const named = rows.filter((row) => documentNameKey(row.filename) === key)
  return named.length === 1 ? named[0] : null
}
