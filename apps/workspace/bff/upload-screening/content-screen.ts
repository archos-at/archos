import {
  CARD_CONTEXT_WORDS,
  CARD_PAGE_LABELS,
  cardsIn,
  contextWindow,
  type DigitGroup,
  hasWord,
  maskCard,
  wrappedCardLayout,
} from './card-numbers'
import { foldForScreening } from './name-screen'
import { deSvnrAt, deTaxIdAt, maskDeSvnr, maskDeTaxId, TAX_ID_LABELS } from './de-numbers'
import {
  type Digit,
  decimalDigitValue,
  digitAt,
  digitsAt,
  digitTouches,
  isWhitespace,
  SCREENING_WHITESPACE,
  skipSeparator,
} from './screen-chars'
import { maskSvnr, printedAsSvnr, SVNR_LABELS, SVNR_MARKS, SVNR_START, validAtSvnr } from './svnr-numbers'
import { SCREENING_DETECTORS, type ScreeningDetector, type UploadScreeningPolicy } from './policy'
import { SCREENING_IGNORABLE, SPLIT_TERM_MIN, splitTermEnd, TERM_FRAGMENT } from './reading'

export type ContentScreenKind = ScreeningDetector | 'term'

export { luhnValid } from './card-numbers'
export { validAtSvnr } from './svnr-numbers'
export { decimalDigitValue, SCREENING_WHITESPACE } from './screen-chars'

export const SCREENING_PLACEHOLDERS: Readonly<Record<ContentScreenKind, string>> = {
  iban: '[IBAN entfernt]',
  at_svnr: '[SV-Nummer entfernt]',
  credit_card: '[Kartennummer entfernt]',
  de_svnr: '[RV-Nummer entfernt]',
  de_tax_id: '[Steuer-ID entfernt]',
  term: '[Begriff entfernt]',
}

const MAX_TERMS = 200
const MIN_TERM_CHARS = 2
const MAX_TERM_CHARS = 80
const MASK = '••••'

export interface ContentScreenRules {
  terms: readonly string[]
  detectors: readonly ScreeningDetector[]
  patterns: readonly (readonly string[])[]
}

export interface ContentSpan {
  kind: ContentScreenKind
  start: number
  end: number
  term?: string
  sample?: string
}

export interface ContentFinding {
  kind: ContentScreenKind
  count: number
  term?: string
  sample?: string
}

export interface MaskedText {
  text: string
  findings: ContentFinding[]
}

const SPACE_RUN = /[\t-\r \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u

const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u
const LETTER = /\p{L}/u
const UPPERCASE_LETTER = /\p{Lu}/u
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u
const MARK = /\p{M}/u
const ASCII_LETTER = /^[A-Za-z]$/
const FINAL_SIGMA = /ς/g

function codePointAt(text: string, index: number): string {
  if (index < 0 || index >= text.length) return ''
  return String.fromCodePoint(text.codePointAt(index) ?? 0)
}

function codePointBefore(text: string, index: number): string {
  if (index === 0) return ''
  const low = text.charCodeAt(index - 1)
  const isLowSurrogate = low >= 0xdc00 && low <= 0xdfff
  return isLowSurrogate && index >= 2 ? text.slice(index - 2, index) : text.slice(index - 1, index)
}

function wordCharAt(text: string, index: number): boolean {
  return LETTER_OR_NUMBER.test(codePointAt(text, index))
}

function asciiDigits(text: string): string {
  return digitsAt(text, 0, Array.from(text).length)?.digits ?? ''
}

function splitWords(text: string): string[] {
  return text.split(SPACE_RUN).filter(Boolean)
}

const BREAK_HYPHENS = '-\u2010\u2011'
const LINE_BREAKS = '\n\v\f\r\x85\u2028\u2029'
const HORIZONTAL_SPACE = [...SCREENING_WHITESPACE]
  .filter((char) => !LINE_BREAKS.includes(char))
  .join('')

const DROP_SITE = new RegExp(`[${BREAK_HYPHENS}${SCREENING_IGNORABLE}]`, 'g')

interface Reading {
  text: string
  starts: number[] | null
  soft: ReadonlySet<number>
}

function originalSpan(reading: Reading, start: number, end: number): [number, number] {
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

function read(text: string): Reading {
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

function clusters(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let index = 0
  for (const char of text) {
    const last = out[out.length - 1]
    if (last && MARK.test(char)) last[1] = index + char.length
    else out.push([index, index + char.length])
    index += char.length
  }
  return out
}

function foldCluster(cluster: string): string {
  return foldForScreening(cluster).replace(FINAL_SIGMA, 'σ')
}

export function foldContent(text: string): string {
  return clusters(text)
    .map(([start, end]) => foldCluster(text.slice(start, end)))
    .join('')
}

interface Folded {
  text: string
  starts: number[]
  ends: number[]
}

function foldMapped(text: string): Folded {
  const parts: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  for (const [start, end] of clusters(text)) {
    const folded = foldCluster(text.slice(start, end))
    parts.push(folded)
    for (let i = 0; i < folded.length; i += 1) {
      starts.push(start)
      ends.push(end)
    }
  }
  return { text: parts.join(''), starts, ends }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

function termPattern(term: string): string[] {
  return splitWords(foldContent(term))
}

function startsAWord(folded: Folded, text: string, index: number): boolean {
  if (index === 0) return true
  const previous = folded.starts[index - 1]
  return previous !== folded.starts[index] && !LETTER.test(codePointAt(text, previous))
}

function matchWordsAt(text: string, start: number, words: readonly string[]): number {
  let cursor = start
  for (let w = 0; w < words.length; w += 1) {
    if (w > 0) {
      const gap = cursor
      while (cursor < text.length && isWhitespace(text[cursor])) cursor += 1
      if (cursor === gap) return -1
    }
    if (!text.startsWith(words[w], cursor)) return -1
    cursor += words[w].length
  }
  return cursor
}

const TERM_JOINERS = ' -\u2010\u2011'

function* longTermMatches(folded: Folded, text: string, word: string): Generator<[number, number]> {
  const anchor = word.slice(0, TERM_FRAGMENT)
  let index = folded.text.indexOf(anchor)
  while (index !== -1) {
    const end = startsAWord(folded, text, index)
      ? splitTermEnd(folded.text, index, word, TERM_JOINERS)
      : -1
    if (end > index) {
      yield [index, end]
      index = folded.text.indexOf(anchor, end)
    } else {
      index = folded.text.indexOf(anchor, index + 1)
    }
  }
}

function* termMatches(
  folded: Folded,
  text: string,
  words: readonly string[]
): Generator<[number, number]> {
  if (words.length === 0) return
  if (words.length === 1 && words[0].length >= SPLIT_TERM_MIN) {
    yield* longTermMatches(folded, text, words[0])
    return
  }
  let index = folded.text.indexOf(words[0])
  while (index !== -1) {
    const end = startsAWord(folded, text, index) ? matchWordsAt(folded.text, index, words) : -1
    if (end > index) {
      yield [index, end]
      index = folded.text.indexOf(words[0], end)
    } else {
      index = folded.text.indexOf(words[0], index + 1)
    }
  }
}

function codePointLength(text: string): number {
  return Array.from(text).length
}

function normalisedTerms(terms: readonly string[]): string[] {
  const kept = new Map<string, string>()
  for (const term of terms) {
    const stripped = splitWords(term).join(' ')
    const length = codePointLength(stripped)
    if (length < MIN_TERM_CHARS || length > MAX_TERM_CHARS) continue
    const key = foldContent(stripped)
    if (!kept.has(key)) kept.set(key, stripped)
  }
  return [...kept.values()].slice(0, MAX_TERMS)
}

export function buildContentRules(
  terms: readonly string[],
  detectors: readonly string[]
): ContentScreenRules | null {
  const keptTerms = normalisedTerms(terms)
  const wanted = new Set(detectors)
  const keptDetectors = SCREENING_DETECTORS.filter((name) => wanted.has(name))
  if (keptTerms.length === 0 && keptDetectors.length === 0) return null
  return { terms: keptTerms, detectors: keptDetectors, patterns: keptTerms.map(termPattern) }
}

export function chatScreeningRules(policy: UploadScreeningPolicy): ContentScreenRules | null {
  if (!policy.enabled) return null
  return buildContentRules(policy.contentTerms, policy.detectors)
}

// prettier-ignore
export const IBAN_LENGTHS: ReadonlyMap<string, number> = new Map(
  Object.entries({
    AD: 24, AE: 23, AL: 28, AO: 25, AT: 20, AX: 18, AZ: 28, BA: 20, BE: 16, BF: 28,
    BG: 22, BH: 22, BI: 27, BJ: 28, BL: 27, BR: 29, BY: 28, CF: 27, CG: 27, CH: 21,
    CI: 28, CM: 27, CR: 22, CV: 25, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28,
    DZ: 26, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GA: 27, GB: 22,
    GE: 22, GF: 27, GG: 22, GI: 23, GL: 18, GP: 27, GQ: 27, GR: 27, GT: 28, GW: 25,
    HN: 28, HR: 21, HU: 28, IE: 22, IL: 23, IM: 22, IQ: 23, IR: 26, IS: 26, IT: 27,
    JE: 22, JO: 30, KM: 27, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
    LV: 21, LY: 25, MA: 28, MC: 27, MD: 24, ME: 22, MF: 27, MG: 27, MK: 19, ML: 28,
    MN: 20, MQ: 27, MR: 27, MT: 31, MU: 30, MZ: 25, NC: 27, NE: 28, NI: 28, NL: 18,
    NO: 15, OM: 23, PF: 27, PK: 24, PL: 28, PM: 27, PS: 29, PT: 25, QA: 29, RE: 27,
    RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27,
    SN: 28, SO: 23, ST: 25, SV: 28, TD: 27, TF: 27, TG: 28, TL: 23, TN: 24, TR: 26,
    UA: 29, VA: 22, VG: 24, WF: 27, XK: 20, YE: 30, YT: 27,
  })
)

const IBAN_START = /(?<!\p{Nd})[A-Za-z](?=[A-Za-z])/gu
const CARD_RUN = /\p{Nd}(?:(?:[ \xa0\u1680\u2000-\u200a\u202f\u205f\u3000]+|[-.])?\p{Nd})*/gu
const WRAPPED_CARD_RUN =
  /\p{Nd}(?:(?:[ \xa0\u1680\u2000-\u200a\u202f\u205f\u3000]+|[-.]|[ \xa0\u1680\u2000-\u200a\u202f\u205f\u3000]*(?:\r\n|[\n\v\f\r\x85\u2028\u2029])[ \xa0\u1680\u2000-\u200a\u202f\u205f\u3000]*)?\p{Nd})*/gu
const DIGIT_GROUP = /\p{Nd}+/gu
const IBAN_CHARS = /^[0-9A-Za-z]+$/

export function validIban(compact: string): boolean {
  if (IBAN_LENGTHS.get(compact.slice(0, 2)) !== compact.length || !IBAN_CHARS.test(compact))
    return false
  let remainder = 0
  for (const char of compact.slice(4) + compact.slice(0, 4)) {
    for (const digit of String(parseInt(char, 36)))
      remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

function ibanChar(text: string, index: number, digitsOnly: boolean): Digit | null {
  const digit = digitAt(text, index)
  if (digit || digitsOnly || index >= text.length) return digit
  const char = text[index]
  return ASCII_LETTER.test(char) ? { value: char.toUpperCase(), width: 1 } : null
}

interface IbanMatch {
  compact: string
  end: number
}

function ibanAt(text: string, start: number, soft: ReadonlySet<number>): IbanMatch | null {
  return ibanInGroups(text, start, soft, 4) ?? ibanInGroups(text, start, soft, 2)
}

function ibanInGroups(
  text: string,
  start: number,
  soft: ReadonlySet<number>,
  width: number
): IbanMatch | null {
  const country = text.slice(start, start + 2).toUpperCase()
  const length = IBAN_LENGTHS.get(country)
  if (length === undefined) return null
  let compact = country
  let index = start + 2
  for (let position = 2; position < length; position += 1) {
    if (position === 2 || position % width === 0) index = skipSeparator(text, index, '-.')
    const char = ibanChar(text, index, position < 4)
    if (!char) return null
    compact += char.value
    index += char.width
  }
  if (digitTouches(text, index, soft) || !validIban(compact)) return null
  return { compact, end: index }
}

function maskIban(compact: string): string {
  const hidden = Math.ceil(Math.max(compact.length - 8, 0) / 4)
  return [compact.slice(0, 4), ...Array<string>(hidden).fill(MASK), compact.slice(-4)].join(' ')
}

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

function pageSays(text: string, labels: readonly string[]): boolean {
  return hasWord(foldContent(text), labels)
}

function digitGroups(run: string): DigitGroup[] {
  return [...run.matchAll(DIGIT_GROUP)].map((match) => ({
    digits: asciiDigits(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }))
}

function cutRuns(run: string, cuts: readonly number[]): DigitGroup[][] {
  const bounds = [0, ...cuts, run.length]
  return bounds.slice(1).map((end, i) =>
    digitGroups(run.slice(bounds[i], end)).map((group) => ({
      ...group,
      start: group.start + bounds[i],
      end: group.end + bounds[i],
    }))
  )
}

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

const isAsciiLetter = (char: string | undefined): boolean => !!char && ASCII_LETTER.test(char)

function* ibanSpans(text: string, soft: ReadonlySet<number>): Generator<ContentSpan> {
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

function* svnrSpans(text: string, soft: ReadonlySet<number>): Generator<ContentSpan> {
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

const hasLineBreak = (text: string): boolean => [...text].some((char) => LINE_BREAKS.includes(char))

const overlapsCard = (card: DigitGroup, others: readonly DigitGroup[]): boolean =>
  others.some((other) => card.start < other.end && other.start < card.end)

function* cardSpans(text: string, soft: ReadonlySet<number>): Generator<ContentSpan> {
  const found = [...unwrappedCards(text, soft)].sort((a, b) => a.start - b.start)
  found.push(...[...wrappedCards(text)].filter((card) => !overlapsCard(card, found)))
  for (const card of found.sort((a, b) => a.start - b.start)) {
    yield {
      kind: 'credit_card',
      start: card.start,
      end: card.end,
      sample: maskCard(card.digits),
    }
  }
}

function* unwrappedCards(text: string, soft: ReadonlySet<number>): Generator<DigitGroup> {
  const cuts = [...soft].sort((a, b) => a - b)
  for (const match of text.matchAll(CARD_RUN)) {
    const run = match[0]
    const runEnd = match.index + run.length
    const inside = cuts
      .filter((cut) => cut > match.index && cut < runEnd)
      .map((cut) => cut - match.index)
    const found = [...cardsSaid(text, match.index, digitGroups(run))]
    if (inside.length > 0) {
      const joined = [...found]
      for (const groups of cutRuns(run, inside)) {
        for (const card of cardsSaid(text, match.index, groups)) if (!overlapsCard(card, joined)) found.push(card)
      }
    }
    for (const card of found) {
      yield { digits: card.digits, start: match.index + card.start, end: match.index + card.end }
    }
  }
}

function* cardsSaid(text: string, offset: number, groups: readonly DigitGroup[]): Generator<DigitGroup> {
  for (const card of cardsIn(groups)) {
    if (!card.unbroken || hasCardContext(text, offset + card.start, offset + card.end)) yield card
  }
}

function hasCardContext(text: string, start: number, end: number): boolean {
  const [begin, stop] = contextWindow(text, start, end)
  return hasWord(foldContent(text.slice(begin, stop)), CARD_CONTEXT_WORDS) || pageSays(text, CARD_PAGE_LABELS)
}

function* wrappedCards(text: string): Generator<DigitGroup> {
  for (const match of text.matchAll(WRAPPED_CARD_RUN)) {
    const run = match[0]
    if (!hasLineBreak(run)) continue
    for (const card of cardsIn(digitGroups(run), wrappedCardLayout)) {
      if (hasLineBreak(run.slice(card.start, card.end))) {
        yield { digits: card.digits, start: match.index + card.start, end: match.index + card.end }
      }
    }
  }
}

function* deSvnrSpans(text: string, soft: ReadonlySet<number>): Generator<ContentSpan> {
  let resume = 0
  for (const start of startsOf(text, soft, SVNR_START, (i) => digitAt(text, i) !== null)) {
    if (start < resume) continue
    const found = deSvnrAt(text, start, soft)
    if (!found) continue
    resume = found.end
    yield { kind: 'de_svnr', start, end: found.end, sample: maskDeSvnr(found.compact) }
  }
}

function* deTaxIdSpans(text: string, soft: ReadonlySet<number>): Generator<ContentSpan> {
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

const DETECTOR_SPANS: Readonly<
  Record<ScreeningDetector, (text: string, soft: ReadonlySet<number>) => Iterable<ContentSpan>>
> =
  {
    iban: ibanSpans,
    at_svnr: svnrSpans,
    credit_card: cardSpans,
    de_svnr: deSvnrSpans,
    de_tax_id: deTaxIdSpans,
  }

function wordEnd(text: string, end: number): number {
  let cursor = end
  while (cursor < text.length) {
    const char = codePointAt(text, cursor)
    if (!WORD_CHAR.test(char)) break
    cursor += char.length
  }
  return cursor
}

function* termSpans(text: string, rules: ContentScreenRules): Generator<ContentSpan> {
  const folded = foldMapped(text)
  for (let i = 0; i < rules.terms.length; i += 1) {
    for (const [matchStart, matchEnd] of termMatches(folded, text, rules.patterns[i])) {
      const start = folded.starts[matchStart]
      const end = wordEnd(text, folded.ends[matchEnd - 1])
      yield { kind: 'term', start, end, term: rules.terms[i] }
    }
  }
}

const PLACEHOLDER_RE = new RegExp(
  Object.values(SCREENING_PLACEHOLDERS).map(escapeRegExp).join('|'),
  'g'
)

const NUMBER_KINDS: ReadonlySet<ContentScreenKind> = new Set(['at_svnr', 'credit_card', 'de_svnr', 'de_tax_id'])

function outsideIbans(spans: readonly ContentSpan[]): ContentSpan[] {
  const ibans = spans.filter((span) => span.kind === 'iban')
  return spans.filter(
    (span) =>
      !NUMBER_KINDS.has(span.kind) ||
      !ibans.some((iban) => iban.start <= span.start && span.end <= iban.end)
  )
}

export function findSpans(text: string, rules: ContentScreenRules): ContentSpan[] {
  if (!text) return []
  const protectedRegions = [...text.matchAll(PLACEHOLDER_RE)].map(
    (match) => [match.index, match.index + match[0].length] as const
  )
  const reading = read(text)
  const spans = [...termSpans(reading.text, rules)]
  for (const name of rules.detectors) spans.push(...DETECTOR_SPANS[name](reading.text, reading.soft))
  return outsideIbans(spans)
    .map((span) => {
      const [start, end] = originalSpan(reading, span.start, span.end)
      return { ...span, start, end }
    })
    .filter((span) => !protectedRegions.some(([start, end]) => span.start < end && start < span.end))
}

function merged(spans: readonly ContentSpan[]): ContentSpan[] {
  const out: ContentSpan[] = []
  const ordered = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
  for (const span of ordered) {
    const last = out[out.length - 1]
    if (last && span.start < last.end)
      out[out.length - 1] = { ...last, end: Math.max(last.end, span.end) }
    else out.push(span)
  }
  return out
}

function replaced(text: string, spans: readonly ContentSpan[]): string {
  let out = ''
  let cursor = 0
  for (const span of merged(spans)) {
    out += text.slice(cursor, span.start) + SCREENING_PLACEHOLDERS[span.kind]
    cursor = span.end
  }
  return out + text.slice(cursor)
}

function findingsOf(spans: readonly ContentSpan[], rules: ContentScreenRules): ContentFinding[] {
  const order: Array<{ kind: ContentScreenKind; term?: string }> = [
    ...rules.terms.map((term) => ({ kind: 'term' as const, term })),
    ...rules.detectors.map((kind) => ({ kind })),
  ]
  const findings: ContentFinding[] = []
  for (const rule of order) {
    const matched = spans.filter((span) => span.kind === rule.kind && span.term === rule.term)
    if (matched.length === 0) continue
    const finding: ContentFinding = { kind: rule.kind, count: matched.length }
    if (rule.term !== undefined) finding.term = rule.term
    if (matched[0].sample !== undefined) finding.sample = matched[0].sample
    findings.push(finding)
  }
  return findings
}

export function maskText(text: string, rules: ContentScreenRules | null): MaskedText {
  if (!rules || !text) return { text, findings: [] }
  const found: ContentSpan[] = []
  let current = text
  let spans = findSpans(current, rules)
  while (spans.length > 0) {
    found.push(...spans)
    current = replaced(current, spans)
    spans = findSpans(current, rules)
  }
  return { text: current, findings: findingsOf(found, rules) }
}
