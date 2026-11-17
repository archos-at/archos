import type { BimComplianceSummary, BimRuleResult } from './rules'

export interface CachedCompliance {
  compliance: BimRuleResult[]
  complianceSummary: BimComplianceSummary
  complianceShoppingList: Array<{ path: string; elements: number; rules: string[] }>
  truncated: boolean
}

interface Entry {
  value: CachedCompliance
  storedAt: number
}

const MAX_ENTRIES = 64
const TTL_MS = 60 * 60 * 1000

const cache = new Map<string, Entry>()

export interface ComplianceCacheModel {
  id: string
  updatedAt: Date
}

function key(
  model: ComplianceCacheModel,
  buildingClass: number | null,
  mainUse: string | null,
  basis: string
): string {
  return `${model.id}|${model.updatedAt.getTime()}|${buildingClass ?? ''}|${mainUse ?? ''}|${basis}`
}

export function readComplianceCache(
  model: ComplianceCacheModel,
  buildingClass: number | null,
  mainUse: string | null,
  basis: string,
  now: number = Date.now()
): CachedCompliance | null {
  const id = key(model, buildingClass, mainUse, basis)
  const entry = cache.get(id)
  if (!entry) return null
  if (now - entry.storedAt > TTL_MS) {
    cache.delete(id)
    return null
  }
  cache.delete(id)
  cache.set(id, entry)
  return entry.value
}

export function writeComplianceCache(
  model: ComplianceCacheModel,
  buildingClass: number | null,
  mainUse: string | null,
  basis: string,
  value: CachedCompliance,
  now: number = Date.now()
): void {
  const id = key(model, buildingClass, mainUse, basis)
  cache.delete(id)
  cache.set(id, { value, storedAt: now })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

export function clearComplianceCache(): void {
  cache.clear()
}
