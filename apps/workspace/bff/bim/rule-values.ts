import type { BimElement } from './types'

export function quantity(element: BimElement, keys: readonly string[]): number | null {
  for (const set of Object.values(element.quantities)) {
    for (const key of keys) {
      const value = set[key]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
    }
  }
  return null
}

export function property(
  element: BimElement,
  keys: readonly string[]
): string | number | boolean | null {
  for (const set of Object.values(element.properties)) {
    for (const key of keys) {
      const value = set[key]
      if (value !== undefined && value !== null && value !== '') return value
    }
  }
  return null
}

const LEADING_NUMBER = /^[+-]?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?/

export function numericProperty(element: BimElement, keys: readonly string[]): number | null {
  const raw = property(element, keys)
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw !== 'string') return null
  const match = LEADING_NUMBER.exec(raw.trim())
  if (!match) return null
  const parsed = Number(match[0].replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

export function dimensionProperty(element: BimElement, keys: readonly string[]): number | null {
  const value = numericProperty(element, keys)
  return value !== null && value > 0 ? value : null
}

export function externalFlag(element: BimElement): boolean | null {
  const raw = property(element, ['IsExternal'])
  if (typeof raw === 'boolean') return raw
  if (typeof raw !== 'string') return null
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return null
}

export function undecidableWithoutExternalFlag(missing: string) {
  return {
    status: 'undecidable' as const,
    reading: 'Keine auswertbare Angabe, ob das Bauteil außen liegt — Anforderung nicht bestimmbar',
    missing,
  }
}
