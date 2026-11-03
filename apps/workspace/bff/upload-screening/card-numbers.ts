/**
 * What makes a run of digits a payment-card number: the content screen's card
 * rules, the twin of `agent.common.card_numbers`, whose docstring is the full
 * statement. Both are held to `tests/fixtures/content_screen_cases.json`.
 *
 * A card is printed in a few layouts (one unbroken number of 13-19 digits,
 * 4-4-4-4 with a last group of 1-4, 4-6-5 for American Express, 4-6-4 for
 * Diners), starts in a card network's issuer range and passes Luhn. One number
 * in ten passes Luhn and the ranges cover a third of all prefixes, so about one
 * long number in thirty looks like a card. A number printed in a card's groups
 * is rare enough elsewhere for that to hold; an UNBROKEN one is not (article,
 * order, meter and file numbers, table cells a PDF glued together). So an
 * unbroken number is a card only with a card's word within `CARD_CONTEXT_REACH`
 * code points of it, and 4-6-5 and 4-6-4 count only in their network's range.
 *
 * Pure and client-safe: the composer runs it.
 */

/**
 * The card networks' issuer ranges, on a number's first four digits: Mir,
 * Mastercard, Diners, Amex, JCB, Visa, Maestro, Discover, UnionPay. No card
 * begins 2000-2199, the years a table prints in rows.
 */
const CARD_PREFIXES: ReadonlyArray<readonly [number, number]> = [
  [2200, 2204],
  [2221, 2720],
  [3000, 3099],
  [3400, 3999],
  [4000, 6999],
]
/** The layouts one network prints in, and the first two digits that network's numbers carry. */
const NETWORK_SPLITS: ReadonlyMap<string, readonly string[]> = new Map([
  ['4,6,5', ['34', '37']],
  ['4,6,4', ['30', '36', '38', '39']],
])
const CARD_MAX_GROUPS = 5

/**
 * Words that say a card is meant, folded (`foldContent`): lower case, umlauts
 * spelt out. `karte` also finds `Kartennummer` and `Kartenprüfnummer`; it finds
 * a map too, which costs little, since the number beside it must still be a
 * Luhn-valid card number in a network's range.
 */
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
/** How many code points of the reading before and after an unbroken number are searched for a card's word. */
export const CARD_CONTEXT_REACH = 48

const LETTER = /\p{L}/u

export interface DigitGroup {
  digits: string
  start: number
  end: number
}

export interface CardCandidate extends DigitGroup {
  /** Printed as one number, with no separator between its digits. */
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

/** Whether groups of these sizes are how a card number is printed: unbroken, 4-4-4-4 (the last group 1-4), 4-6-5 or 4-6-4. */
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

/** A card wrapped at a line end counts in one layout only, four groups of four: table rows are not cards. */
export const wrappedCardLayout = (sizes: readonly number[]): boolean =>
  sizes.join(',') === '4,4,4,4'

/** Whether a network's own layout carries that network's digits (4-6-5 is Amex, 4-6-4 Diners). */
function networkFits(sizes: readonly number[], digits: string): boolean {
  const prefixes = NETWORK_SPLITS.get(sizes.join(','))
  return !prefixes || prefixes.includes(digits.slice(0, 2))
}

/** Whether the groups `first` to `last` are not cut out of a longer number printed in fours. */
function standsAlone(groups: readonly string[], first: number, last: number): boolean {
  const before = first === 0 || groups[first - 1].length !== 4
  const after = last === groups.length || groups[last].length !== 4 || last === groups.length - 1
  return before && after
}

/**
 * Each card among a run's digit groups: its digits, where it starts and ends in
 * the run, and whether it is unbroken. The leftmost start wins and takes the
 * longest stretch with a card's layout and checksum. What stands before it (a
 * position) or after it (an expiry, a security code) is not part of it; a group
 * of four beside it makes it a piece of a longer number printed in fours, judged
 * as a whole, except that the last group may be the security code.
 */
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

/** Whether a card's word (`CARD_CONTEXT_WORDS`) starts a word somewhere in `folded`, which begins at a word start. */
export function hasCardWord(folded: string): boolean {
  return CARD_CONTEXT_WORDS.some((word) => {
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
      if (at === 0 || !LETTER.test(charBefore(folded, at))) return true
    }
    return false
  })
}

/** The code point that ends just before `index`. */
function charBefore(text: string, index: number): string {
  const low = text.charCodeAt(index - 1)
  return low >= 0xdc00 && low <= 0xdfff && index >= 2
    ? text.slice(index - 2, index)
    : text.slice(index - 1, index)
}

export function maskCard(digits: string): string {
  return `•••• ${digits.slice(-4)}`
}
