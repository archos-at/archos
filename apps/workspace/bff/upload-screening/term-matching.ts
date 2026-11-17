import { codePointAt } from './code-points'
import { foldMapped, type Folded } from './content-folding'
import type { ContentScreenRules, ContentSpan } from './content-types'
import { SPLIT_TERM_MIN, splitTermEnd, TERM_FRAGMENT } from './reading'
import { isWhitespace } from './screen-chars'

const LETTER = /\p{L}/u

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u

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

function wordEnd(text: string, end: number): number {
  let cursor = end
  while (cursor < text.length) {
    const char = codePointAt(text, cursor)
    if (!WORD_CHAR.test(char)) break
    cursor += char.length
  }
  return cursor
}

export function* termSpans(text: string, rules: ContentScreenRules): Generator<ContentSpan> {
  const folded = foldMapped(text)
  for (let i = 0; i < rules.terms.length; i += 1) {
    for (const [matchStart, matchEnd] of termMatches(folded, text, rules.patterns[i])) {
      const start = folded.starts[matchStart]
      const end = wordEnd(text, folded.ends[matchEnd - 1])
      yield { kind: 'term', start, end, term: rules.terms[i] }
    }
  }
}
