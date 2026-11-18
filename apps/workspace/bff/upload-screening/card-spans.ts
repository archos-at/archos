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
import { foldContent, pageSays } from './content-folding'
import { LINE_BREAKS } from './hyphenation'
import type { ContentSpan } from './content-types'
import { digitsAt } from './screen-chars'

function asciiDigits(text: string): string {
  return digitsAt(text, 0, Array.from(text).length)?.digits ?? ''
}

const CARD_RUN = /\p{Nd}(?:(?:[ \xa0\u1680\u2000-\u200a\u202f\u205f\u3000]+|[-.])?\p{Nd})*/gu
const WRAPPED_CARD_RUN =
  /\p{Nd}(?:(?:[ \xa0\u1680\u2000-\u200a\u202f\u205f\u3000]+|[-.]|[ \xa0\u1680\u2000-\u200a\u202f\u205f\u3000]*(?:\r\n|[\n\v\f\r\x85\u2028\u2029])[ \xa0\u1680\u2000-\u200a\u202f\u205f\u3000]*)?\p{Nd})*/gu
const DIGIT_GROUP = /\p{Nd}+/gu

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

const hasLineBreak = (text: string): boolean => [...text].some((char) => LINE_BREAKS.includes(char))

const overlapsCard = (card: DigitGroup, others: readonly DigitGroup[]): boolean =>
  others.some((other) => card.start < other.end && other.start < card.end)

export function* cardSpans(text: string, soft: ReadonlySet<number>): Generator<ContentSpan> {
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
