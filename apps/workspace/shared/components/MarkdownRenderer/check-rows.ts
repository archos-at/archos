import { meetsLimit, parseLimit, parseQuantity, trailingLimit, isPlaceholder, type Limit, type Quantity } from './quantities'
import { isActiveStatus, isOpenStatus, statusTone } from './status-marks'

export const OUTCOME_PASS = '@pass'
export const OUTCOME_FAIL = '@fail'
export const OUTCOME_CONFLICT = '@conflict'

export interface RowLimit {
  limit: Limit
  at: number
  text: string
}

export function rowLimit(texts: readonly string[]): RowLimit | null {
  for (let at = 1; at < texts.length; at++) {
    const limit = parseLimit(texts[at])
    if (limit) return { limit, at, text: texts[at] }
  }
  const embedded = texts[0] ? trailingLimit(texts[0]) : null
  return embedded ? { limit: embedded.limit, at: 0, text: embedded.text } : null
}

export interface RowMeasure {
  value: number
  limit: RowLimit
  quantity: Quantity
}

export function valueAndLimit(texts: readonly string[]): RowMeasure | null {
  const limit = rowLimit(texts)
  if (!limit) return null
  const order = [
    ...Array.from({ length: Math.max(0, limit.at - 1) }, (_, index) => limit.at - 1 - index),
    ...Array.from({ length: Math.max(0, texts.length - limit.at - 1) }, (_, index) => limit.at + 1 + index),
  ]
  for (const at of order) {
    const quantity = parseQuantity(texts[at])
    if (quantity) return { value: at, limit, quantity }
  }
  return null
}

export function rowOutcome(written: string, computed: boolean | null): { word: string; replaced: boolean } | null {
  const tone = statusTone(written)
  if (computed === null) return tone ? { word: written, replaced: false } : null
  const expected = computed ? 'success' : 'destructive'
  if (tone === expected) return { word: written, replaced: false }
  if (tone === 'muted') return { word: written, replaced: false }
  if (!tone || isOpenStatus(written)) return { word: computed ? OUTCOME_PASS : OUTCOME_FAIL, replaced: true }
  return { word: OUTCOME_CONFLICT, replaced: true }
}

export function tallyWord(word: string): string {
  if (word === OUTCOME_PASS || word === OUTCOME_FAIL || word === OUTCOME_CONFLICT) return word
  const tone = statusTone(word)
  if (tone === 'success' && !isActiveStatus(word)) return OUTCOME_PASS
  if (tone === 'destructive' && !isOpenStatus(word)) return OUTCOME_FAIL
  return word
}

export function statusColumnOf(rows: readonly (readonly string[])[], columns: number): number {
  for (let column = columns - 1; column >= 0; column--) {
    if (rows.some((texts) => texts.length <= column)) continue
    const words = rows.map((texts) => texts[column]).filter((word) => !isPlaceholder(word))
    if (words.length > 0 && words.every((word) => statusTone(word))) return column
  }
  return -1
}

export function figureOutcome(texts: readonly string[]): { outcome: ReturnType<typeof rowOutcome>; statusAt: number } {
  const limitAt = texts.findIndex((value, index) => index > 1 && parseLimit(value))
  const statusAt = texts.findIndex((value, index) => index > 1 && statusTone(value))
  const quantity = parseQuantity(texts[1] ?? '')
  const limit = limitAt >= 0 ? parseLimit(texts[limitAt]) : null
  const computed = quantity && limit ? meetsLimit(quantity, limit) : null
  return { outcome: rowOutcome(statusAt >= 0 ? texts[statusAt] : '', computed), statusAt }
}
