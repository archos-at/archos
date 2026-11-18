import { parseNumber } from './quantities'
import type { ProjectKey } from '@/lib/text/answer-directives'

export interface CaseRange {
  kind: 'range'
  min: number | null
  max: number | null
  minStrict: boolean
  maxStrict: boolean
}

export type CaseDescriptor = { kind: 'class'; value: number } | CaseRange | { kind: 'text'; value: string }

export type CaseKind = CaseDescriptor['kind']

export const caseKindFor = (key: ProjectKey): CaseKind =>
  key === 'building_class' ? 'class' : key === 'use' || key === 'state' ? 'text' : 'range'

const CLASS = /(?:\bgk|geb(?:ä|ae)udeklasse)\s*([1-5])\b/i

export function parseCaseClass(text: string): number | null {
  const match = CLASS.exec(text)
  return match ? Number(match[1]) : null
}

const NUMBER = String.raw`\d[\d.,]*`
const BELOW = String.raw`bis|≤|<=|<|max\.?|maximal|höchstens|up to|under`
const ABOVE = String.raw`über|mehr als|>=|≥|>|ab|mind\.?|mindestens|over|above|from`
const BETWEEN = new RegExp(
  String.raw`(?:(${ABOVE})\s*)?(${NUMBER})\s*[^\d\s–-]{0,3}\s*(?:–|-|bis|to)\s*(?:(≤|<=|<)\s*)?(${NUMBER})`,
  'i'
)
const ONE = new RegExp(String.raw`(${BELOW}|${ABOVE})\s*(${NUMBER})`, 'i')

const isStrictAbove = (word: string | undefined): boolean => /^(über|mehr als|>|over|above)$/i.test(word ?? '')

export function parseCaseRange(text: string): CaseRange | null {
  const between = BETWEEN.exec(text)
  if (between) {
    const min = parseNumber(between[2])
    const max = parseNumber(between[4])
    if (min !== null && max !== null && min < max) {
      return { kind: 'range', min, max, minStrict: isStrictAbove(between[1]), maxStrict: between[3] === '<' }
    }
  }
  const one = ONE.exec(text)
  if (!one) return null
  const value = parseNumber(one[2])
  if (value === null) return null
  const word = one[1].toLowerCase()
  if (new RegExp(`^(?:${BELOW})$`, 'i').test(word)) {
    return { kind: 'range', min: null, max: value, minStrict: false, maxStrict: word === '<' || word === 'under' }
  }
  return { kind: 'range', min: value, max: null, minStrict: isStrictAbove(word), maxStrict: false }
}

function chainRanges(ranges: CaseRange[]): CaseRange[] {
  return ranges.map((range, index) => {
    const before = ranges[index - 1]
    if (range.min !== null || !before || before.max === null) return range
    if (range.max !== null && range.max <= before.max) return range
    return { ...range, min: before.max, minStrict: !before.maxStrict }
  })
}

export function parseCases(kind: CaseKind, texts: readonly string[]): CaseDescriptor[] | null {
  if (texts.length < 2) return null
  if (kind === 'class') {
    const values = texts.map(parseCaseClass)
    return values.every((value) => value !== null) ? values.map((value) => ({ kind: 'class', value: value as number })) : null
  }
  if (kind === 'range') {
    const ranges = texts.map(parseCaseRange)
    return ranges.every((range) => range !== null) ? chainRanges(ranges as CaseRange[]) : null
  }
  const words = texts.map((text) => text.trim()).filter(Boolean)
  return words.length === texts.length ? words.map((value) => ({ kind: 'text', value })) : null
}

const inRange = (range: CaseRange, value: number): boolean =>
  (range.min === null || (range.minStrict ? value > range.min : value >= range.min)) &&
  (range.max === null || (range.maxStrict ? value < range.max : value <= range.max))

const fold = (text: string) => text.toLocaleLowerCase('de').replace(/\s+/g, ' ').trim()

export function matchCase(cases: readonly CaseDescriptor[], value: { number: number | null; text: string | null }): number {
  return cases.findIndex((entry) => {
    if (entry.kind === 'class') return value.number === entry.value
    if (entry.kind === 'range') return value.number !== null && inRange(entry, value.number)
    if (!value.text) return false
    const have = fold(value.text)
    const want = fold(entry.value)
    return have === want || have.split(/,\s*/).includes(want) || want.includes(have)
  })
}

export interface RulerTick {
  at: number
  value: number
}

export interface RulerSegment {
  from: number
  to: number
  label: string
  holds: boolean
}

export interface Ruler {
  ticks: RulerTick[]
  segments: RulerSegment[]
  pin: number
  nearest: { delta: number; direction: 'below' | 'above'; label: string } | null
}

export function rulerOf(cases: readonly CaseDescriptor[], labels: readonly string[], value: number): Ruler | null {
  const ranges = cases.filter((entry): entry is CaseRange => entry.kind === 'range')
  if (ranges.length !== cases.length || ranges.length < 2) return null
  const bounds = [...new Set(ranges.flatMap((range) => [range.min, range.max]).filter((bound): bound is number => bound !== null))].sort(
    (a, b) => a - b
  )
  if (bounds.length < 1) return null
  const lowest = Math.min(0, bounds[0], value)
  const highest = Math.max(bounds[bounds.length - 1], value)
  const top = highest + Math.max((highest - lowest) * 0.18, 1)
  const at = (x: number) => ((x - lowest) / (top - lowest)) * 100
  const holds = matchCase(cases, { number: value, text: null })
  const segments = ranges.map((range, index) => ({
    from: at(range.min ?? lowest),
    to: at(range.max ?? top),
    label: labels[index] ?? '',
    holds: index === holds,
  }))
  const next = ranges
    .map((range, index) => ({ min: range.min, index }))
    .filter((entry): entry is { min: number; index: number } => entry.min !== null && entry.min >= value && entry.index !== holds)
    .sort((a, b) => a.min - b.min)[0]
  let nearest: Ruler['nearest'] = null
  if (next) nearest = { delta: next.min - value, direction: 'below', label: labels[next.index] ?? '' }
  else if (holds >= 0 && ranges[holds].min !== null) {
    nearest = { delta: value - (ranges[holds].min as number), direction: 'above', label: labels[holds] ?? '' }
  }
  return { ticks: bounds.map((bound) => ({ at: at(bound), value: bound })), segments, pin: at(value), nearest }
}
