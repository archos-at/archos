import { pageSays } from './content-folding'
import { codePointBefore, isAsciiLetter } from './code-points'
import { deSvnrAt, deTaxIdAt, maskDeSvnr, maskDeTaxId, TAX_ID_LABELS } from './de-numbers'
import { ibanAt, maskIban } from './iban-numbers'
import { maskSvnr, printedAsSvnr, SVNR_LABELS, SVNR_MARKS, SVNR_START, validAtSvnr } from './svnr-numbers'
import type { ContentSpan } from './content-types'
import { decimalDigitValue, digitAt, digitsAt, digitTouches, isWhitespace, skipSeparator } from './screen-chars'

const IBAN_START = /(?<!\p{Nd})[A-Za-z](?=[A-Za-z])/gu

function svnrAt(
  text: string,
  start: number,
  soft: ReadonlySet<number>
): { digits: string; end: number } | null {
  const serial = digitsAt(text, start, 4)
  if (!serial) return null
  const dayAt = skipSeparator(text, serial.end, SVNR_MARKS)
  const day = digitsAt(text, dayAt, 2)
  if (!day) return null
  const monthAt = skipSeparator(text, day.end, SVNR_MARKS)
  const split = monthAt !== day.end
  const month = digitsAt(text, monthAt, 2)
  if (!month) return null
  const yearAt = split ? skipSeparator(text, month.end, SVNR_MARKS) : month.end
  if (split && yearAt === month.end) return null
  const year = digitsAt(text, yearAt, 2)
  if (!year || digitTouches(text, year.end, soft)) return null
  const digits = serial.digits + day.digits + month.digits + year.digits
  const separators = [separatorKind(text, day.end, monthAt), separatorKind(text, month.end, yearAt)] as const
  const timeFollows = text[year.end] === ':' && digitAt(text, year.end + 1) !== null
  if (!validAtSvnr(digits) || !printedAsSvnr(separators, timeFollows)) return null
  const unbroken = dayAt === serial.end && !split
  return unbroken && !pageSays(text, SVNR_LABELS) ? null : { digits, end: year.end }
}

const separatorKind = (text: string, start: number, end: number): string =>
  start === end ? '' : isWhitespace(text[start]) ? ' ' : text[start]

function startsOf(
  text: string,
  soft: ReadonlySet<number>,
  pattern: RegExp,
  fits: (index: number) => boolean
): number[] {
  const found = [...text.matchAll(pattern)].map((match) => match.index)
  const extra = [...soft].filter(
    (i) => i > 0 && i < text.length && digitBefore(text, i) && fits(i)
  )
  return extra.length > 0 ? [...new Set([...found, ...extra])].sort((a, b) => a - b) : found
}

function digitBefore(text: string, index: number): boolean {
  const char = codePointBefore(text, index)
  return char !== '' && decimalDigitValue(char.codePointAt(0) ?? -1) !== null
}

export function* ibanSpans(text: string, soft: ReadonlySet<number>): Generator<ContentSpan> {
  let resume = 0
  const fits = (i: number) => isAsciiLetter(text[i]) && isAsciiLetter(text[i + 1])
  for (const start of startsOf(text, soft, IBAN_START, fits)) {
    if (start < resume) continue
    const found = ibanAt(text, start, soft)
    if (!found) continue
    resume = found.end
    yield { kind: 'iban', start, end: found.end, sample: maskIban(found.compact) }
  }
}

export function* svnrSpans(text: string, soft: ReadonlySet<number>): Generator<ContentSpan> {
  let resume = 0
  for (const start of startsOf(text, soft, SVNR_START, (i) => digitAt(text, i) !== null)) {
    if (start < resume) continue
    const found = svnrAt(text, start, soft)
    if (!found) continue
    resume = found.end
    yield {
      kind: 'at_svnr',
      start,
      end: found.end,
      sample: maskSvnr(found.digits),
    }
  }
}

export function* deSvnrSpans(text: string, soft: ReadonlySet<number>): Generator<ContentSpan> {
  let resume = 0
  for (const start of startsOf(text, soft, SVNR_START, (i) => digitAt(text, i) !== null)) {
    if (start < resume) continue
    const found = deSvnrAt(text, start, soft)
    if (!found) continue
    resume = found.end
    yield { kind: 'de_svnr', start, end: found.end, sample: maskDeSvnr(found.compact) }
  }
}

export function* deTaxIdSpans(text: string, soft: ReadonlySet<number>): Generator<ContentSpan> {
  if (!pageSays(text, TAX_ID_LABELS)) return
  let resume = 0
  for (const start of startsOf(text, soft, SVNR_START, (i) => digitAt(text, i) !== null)) {
    if (start < resume) continue
    const found = deTaxIdAt(text, start, soft)
    if (!found) continue
    resume = found.end
    yield { kind: 'de_tax_id', start, end: found.end, sample: maskDeTaxId(found.digits) }
  }
}
