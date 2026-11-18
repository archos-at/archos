const CARD_PREFIXES: ReadonlyArray<readonly [number, number]> = [
  [2200, 2204],
  [2221, 2720],
  [3000, 3099],
  [3400, 3999],
  [4000, 6999],
]
const NETWORK_SPLITS: ReadonlyMap<string, readonly string[]> = new Map([
  ['4,6,5', ['34', '37']],
  ['4,6,4', ['30', '36', '38', '39']],
])
const CARD_MAX_GROUPS = 5

export const CARD_CONTEXT_WORDS: readonly string[] = [
  'karte',
  'kreditkart',
  'debitkart',
  'bankomatkart',
  'bankkart',
  'card',
  'credit',
  'visa',
  'mastercard',
  'maestro',
  'amex',
  'american express',
  'diners',
  'jcb',
  'unionpay',
  'cvc',
  'cvv',
]
export const CARD_CONTEXT_REACH = 48
export const CARD_PAGE_LABELS: readonly string[] = [
  'kartennummer',
  'kartennr',
  'kreditkartennummer',
  'card number',
  'cardnumber',
]

const LETTER = /\p{L}/u

export interface DigitGroup {
  digits: string
  start: number
  end: number
}

export interface CardCandidate extends DigitGroup {
  unbroken: boolean
}

export function luhnValid(digits: string): boolean {
  let total = 0
  const reversed = [...digits].reverse()
  for (let index = 0; index < reversed.length; index += 1) {
    const value = Number(reversed[index]) * (index % 2 ? 2 : 1)
    total += value > 9 ? value - 9 : value
  }
  return total % 10 === 0
}

function validCard(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return false
  const prefix = Number(digits.slice(0, 4))
  return CARD_PREFIXES.some(([low, high]) => low <= prefix && prefix <= high)
}

export function cardLayout(sizes: readonly number[]): boolean {
  if (sizes.length === 1) return sizes[0] >= 13 && sizes[0] <= 19
  if (NETWORK_SPLITS.has(sizes.join(','))) return true
  const last = sizes[sizes.length - 1]
  return (
    sizes.length >= 4 &&
    sizes.slice(0, -1).every((size) => size === 4) &&
    last >= 1 &&
    last <= 4 &&
    sizes.reduce((sum, size) => sum + size, 0) <= 19
  )
}

export const wrappedCardLayout = (sizes: readonly number[]): boolean =>
  sizes.join(',') === '4,4,4,4'

function networkFits(sizes: readonly number[], digits: string): boolean {
  const prefixes = NETWORK_SPLITS.get(sizes.join(','))
  return !prefixes || prefixes.includes(digits.slice(0, 2))
}

function measures(groups: readonly string[]): boolean {
  const fours = groups.filter((group) => group.length === 4)
  return fours.length >= 3 && fours.every((group) => group.endsWith('0') || group.endsWith('5'))
}

function standsAlone(groups: readonly string[], first: number, last: number): boolean {
  const before = first === 0 || groups[first - 1].length !== 4
  const after = last === groups.length || groups[last].length !== 4 || last === groups.length - 1
  return before && after
}

export function* cardsIn(
  groups: readonly DigitGroup[],
  layout: (sizes: readonly number[]) => boolean = cardLayout
): Generator<CardCandidate> {
  const digitsOf = groups.map((group) => group.digits)
  let first = 0
  while (first < groups.length) {
    for (let last = Math.min(groups.length, first + CARD_MAX_GROUPS); last > first; last -= 1) {
      const digits = digitsOf.slice(first, last).join('')
      const sizes = digitsOf.slice(first, last).map((group) => group.length)
      if (
        layout(sizes) &&
        networkFits(sizes, digits) &&
        standsAlone(digitsOf, first, last) &&
        (sizes.length === 1 || !measures(digitsOf.slice(first, last))) &&
        validCard(digits)
      ) {
        yield {
          digits,
          start: groups[first].start,
          end: groups[last - 1].end,
          unbroken: sizes.length === 1,
        }
        first = last - 1
        break
      }
    }
    first += 1
  }
}

export function contextWindow(text: string, start: number, end: number): [number, number] {
  let begin = start
  for (let step = 0; step < CARD_CONTEXT_REACH && begin > 0; step += 1) begin -= charBefore(text, begin).length
  let stop = end
  for (let step = 0; step < CARD_CONTEXT_REACH && stop < text.length; step += 1) stop += charAt(text, stop).length
  if (begin > 0 && LETTER.test(charBefore(text, begin))) {
    while (begin < start && LETTER.test(charAt(text, begin))) begin += charAt(text, begin).length
  }
  while (stop < text.length && LETTER.test(charAt(text, stop))) stop += charAt(text, stop).length
  return [begin, stop]
}

function charAt(text: string, index: number): string {
  return String.fromCodePoint(text.codePointAt(index) ?? 0)
}

export function hasWord(folded: string, words: readonly string[]): boolean {
  return words.some((word) => {
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
      if (at === 0 || !LETTER.test(charBefore(folded, at))) return true
    }
    return false
  })
}

function charBefore(text: string, index: number): string {
  const low = text.charCodeAt(index - 1)
  return low >= 0xdc00 && low <= 0xdfff && index >= 2
    ? text.slice(index - 2, index)
    : text.slice(index - 1, index)
}

export function maskCard(digits: string): string {
  return `•••• ${digits.slice(-4)}`
}
