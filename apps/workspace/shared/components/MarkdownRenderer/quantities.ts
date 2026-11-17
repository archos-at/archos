export interface Quantity {
  value: number
  unit: string
}

export interface Limit extends Quantity {
  bound: 'min' | 'max'
  strict: boolean
}

const NUMBER = '[+\\-\u2212]?\\d(?:[\\d.,\'\u2019\\u00a0\\u202f ]*\\d)?'
const UNIT = String.raw`(?![-\u2013\u2212]\d)[^\d\s|][^\s|]{0,11}`
const QUANTITY = new RegExp(String.raw`^(?:ca\.\s*|~\s*|≈\s*)?(${NUMBER})\s*(${UNIT})?$`)

const MAX_VALUE_CHARS = 48

const LIMIT_WORDS: ReadonlyArray<readonly [RegExp, Limit['bound'], boolean]> = [
  [/^(?:≥|>=|min\.|mind\.|mindestens|minimal|min)\s*/i, 'min', false],
  [/^(?:≤|<=|max\.|höchstens|maximal|max)\s*/i, 'max', false],
  [/^>\s*/, 'min', true],
  [/^<\s*/, 'max', true],
]

export function parseNumber(raw: string): number | null {
  const text = raw.replace(/[\s  '’]/g, '').replace('−', '-')
  if (!/^[+-]?\d[\d.,]*$/.test(text)) return null
  const dot = text.lastIndexOf('.')
  const comma = text.lastIndexOf(',')
  let normal: string
  if (dot >= 0 && comma >= 0) {
    normal = dot > comma ? text.replace(/,/g, '') : text.replace(/\./g, '').replace(',', '.')
  } else if (comma >= 0) {
    if ((text.match(/,/g) ?? []).length > 1) return null
    normal = text.replace(',', '.')
  } else if (dot >= 0) {
    normal = /^[+-]?\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, '') : text
    if ((normal.match(/\./g) ?? []).length > 1) return null
  } else {
    normal = text
  }
  const value = Number(normal)
  return Number.isFinite(value) ? value : null
}

export function parseQuantity(text: string): Quantity | null {
  if (text.length > MAX_VALUE_CHARS) return null
  const match = QUANTITY.exec(text.trim())
  if (!match) return null
  const value = parseNumber(match[1])
  return value === null ? null : { value, unit: (match[2] ?? '').trim() }
}

export function parseLimit(text: string): Limit | null {
  if (text.length > MAX_VALUE_CHARS) return null
  const trimmed = text.trim()
  for (const [pattern, bound, strict] of LIMIT_WORDS) {
    const match = pattern.exec(trimmed)
    if (!match) continue
    const quantity = parseQuantity(trimmed.slice(match[0].length))
    return quantity ? { ...quantity, bound, strict } : null
  }
  return null
}

const EMBEDDED_LIMIT_TOKENS = ['≥', '>=', '≤', '<=', 'max.', 'mind.', 'min.', 'mindestens', 'höchstens', 'maximal', 'minimal']

const MAX_LABEL_CHARS = 120

export function trailingLimit(text: string): { limit: Limit; text: string } | null {
  const trimmed = text.trim()
  if (trimmed.length > MAX_LABEL_CHARS) return null
  const lower = trimmed.toLocaleLowerCase('de')
  let at = -1
  for (const token of EMBEDDED_LIMIT_TOKENS) {
    const index = lower.lastIndexOf(` ${token}`)
    if (index > at) at = index
  }
  if (at < 0) return null
  const tail = trimmed.slice(at + 1)
  const limit = parseLimit(tail)
  return limit ? { limit, text: tail } : null
}

export function meetsLimit(value: Quantity, limit: Limit): boolean | null {
  if (value.unit && limit.unit && value.unit !== limit.unit) return null
  if (value.unit && !limit.unit) return null
  if (limit.bound === 'min') return limit.strict ? value.value > limit.value : value.value >= limit.value
  return limit.strict ? value.value < limit.value : value.value <= limit.value
}

export const isPlaceholder = (text: string): boolean => /^[\s—–-]*$/.test(text)
