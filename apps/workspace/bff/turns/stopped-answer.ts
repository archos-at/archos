const PENDING_MARKER = /[ \t\n\r\f\v]*\[[0-9]+\]/g
const NUMBERED_CARD_MARKER = /[ \t\n\r\f\v]*\[\[card:([0-9]+)\]\]/g
const OPEN_MARKER_TAIL = /[ \t\n\r\f\v]*(?:\[\[?[^[\] \t\n\r\f\v]*|\[\[card:[0-9]+\])$/
const EDGE_WHITESPACE = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g

export const trimStopped = (text: string): string => text.replace(EDGE_WHITESPACE, '')

export interface AnswerStretch<Card, Source> {
  text: string
  settled?: string | null
  sources: Source[]
  cards: readonly (Card | null | undefined)[]
}

export interface StoppedAnswer<Card, Source> {
  text: string
  sources: Source[]
  cards: Card[]
}

export const sharedPrefixChars = (a: string, b: string): number => {
  const left = Array.from(a)
  const right = Array.from(b)
  let shared = 0
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared += 1
  return shared
}

const withoutMarkers = (text: string): string =>
  trimStopped(text.replace(PENDING_MARKER, '').replace(NUMBERED_CARD_MARKER, ''))

export const holdsNoMoreThan = (stored: string, shown: string): boolean =>
  withoutMarkers(shown).startsWith(withoutMarkers(stored))

const placedCards = <Card>(cards: readonly (Card | null | undefined)[], text: string): Card[] => {
  const placed = new Set(Array.from(text.matchAll(NUMBERED_CARD_MARKER), (match) => Number(match[1])))
  const kept: Card[] = []
  for (const [index, card] of cards.entries()) {
    if (card === null || card === undefined || !placed.has(index + 1)) break
    kept.push(card)
  }
  return kept
}

export const stoppedAnswer = <Card, Source>(
  stretch: AnswerStretch<Card, Source>,
  chars: number
): StoppedAnswer<Card, Source> => {
  const all = Array.from(stretch.text)
  let text = all.slice(0, chars).join('')
  if (chars < all.length) text = text.replace(OPEN_MARKER_TAIL, '')
  const resolved = typeof stretch.settled === 'string' && stretch.settled.startsWith(text)
  if (!resolved) text = text.replace(PENDING_MARKER, '')
  const sources = resolved && trimStopped(text) ? stretch.sources : []
  const cards = placedCards(stretch.cards, text)
  text = text.replace(NUMBERED_CARD_MARKER, (marker, number: string) => (Number(number) <= cards.length ? marker : ''))
  return { text: trimStopped(text), sources, cards }
}
