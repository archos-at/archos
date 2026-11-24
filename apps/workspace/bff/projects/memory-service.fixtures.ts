import type { DigestItem } from './memory-service'

export const eq = (col: unknown, val: unknown) => ({ op: 'eq', col, val })
export const and = (...conditions: unknown[]) => ({ op: 'and', conditions })
export const inArray = (col: unknown, values: unknown[]) => ({ op: 'inArray', col, values })
export const supersedable = inArray('pm.status', ['active'])
export const or = (...conditions: unknown[]) => ({ op: 'or', conditions })
export const isNull = (col: unknown) => ({ op: 'isNull', col })
export const openOnly = isNull('pm.restrictedFolderIds')

export const digestItem = (overrides: Partial<DigestItem> = {}): DigestItem => ({
  scope: 'project',
  kind: 'derived_fact',
  content: 'the roof load is 2 kN/m2',
  confidence: 'medium',
  verification: 'unverified',
  ...overrides,
})
