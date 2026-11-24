import { codePointAt, codePointBefore } from './code-points'
import { SCREENING_IGNORABLE } from './reading'
import { SCREENING_WHITESPACE } from './screen-chars'

const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u

const UPPERCASE_LETTER = /\p{Lu}/u

function wordCharAt(text: string, index: number): boolean {
  return LETTER_OR_NUMBER.test(codePointAt(text, index))
}

const BREAK_HYPHENS = '-\u2010\u2011'
export const LINE_BREAKS = '\n\v\f\r\x85\u2028\u2029'
const HORIZONTAL_SPACE = [...SCREENING_WHITESPACE]
  .filter((char) => !LINE_BREAKS.includes(char))
  .join('')

const DROP_SITE = new RegExp(`[${BREAK_HYPHENS}${SCREENING_IGNORABLE}]`, 'g')

export interface Reading {
  text: string
  starts: number[] | null
  soft: ReadonlySet<number>
}

export function originalSpan(reading: Reading, start: number, end: number): [number, number] {
  if (!reading.starts) return [start, end]
  return [reading.starts[start], reading.starts[end - 1] + 1]
}

function lineBreakAt(text: string, index: number): number {
  if (text.startsWith('\r\n', index)) return index + 2
  return index < text.length && LINE_BREAKS.includes(text[index]) ? index + 1 : index
}

function skipChars(text: string, index: number, chars: string): number {
  let cursor = index
  while (cursor < text.length && chars.includes(text[cursor])) cursor += 1
  return cursor
}

function hyphenationEnd(text: string, index: number, before: string): number {
  if (!LETTER_OR_NUMBER.test(before)) return index
  const cursor = skipChars(text, index + 1, HORIZONTAL_SPACE + SCREENING_IGNORABLE)
  let broken = lineBreakAt(text, cursor)
  if (broken === cursor) return index
  broken = skipChars(text, broken, HORIZONTAL_SPACE + SCREENING_IGNORABLE)
  return broken < text.length && wordCharAt(text, broken) ? broken : index
}

export function read(text: string): Reading {
  if (text.search(DROP_SITE) === -1) return { text, starts: null, soft: new Set() }
  const parts: string[] = []
  const starts: number[] = []
  const soft = new Set<number>()
  let cursor = 0
  let before = ''
  for (const match of text.matchAll(DROP_SITE)) {
    const index = match.index
    if (index < cursor) continue
    if (index > cursor) {
      parts.push(text.slice(cursor, index))
      for (let i = cursor; i < index; i += 1) starts.push(i)
      before = codePointBefore(text, index)
    }
    cursor = index + 1
    if (SCREENING_IGNORABLE.includes(text[index])) {
      soft.add(starts.length)
      continue
    }
    const end = hyphenationEnd(text, index, before)
    if (end > index && !UPPERCASE_LETTER.test(codePointAt(text, end))) {
      cursor = end
      continue
    }
    parts.push(text[index])
    starts.push(index)
    before = text[index]
    if (end > index) cursor = end
  }
  parts.push(text.slice(cursor))
  for (let i = cursor; i < text.length; i += 1) starts.push(i)
  return { text: parts.join(''), starts, soft }
}
