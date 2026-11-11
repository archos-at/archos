/**
 * What makes a German social-insurance number or tax identification number:
 * the content screen's German rules, the twin of `agent.common.de_numbers`,
 * whose docstring is the full statement. Both are held to
 * `tests/fixtures/content_screen_cases.json`.
 *
 * `de_svnr`, the Rentenversicherungsnummer (`15 070649 C 103`): area, birth
 * date DDMMYY, the birth name's initial, a serial and a check digit over the
 * twelve digits the letter makes (weights `2 1 2 5 7 1 2 1 2 1 2 1`, digit sums,
 * mod 10). `de_tax_id`, the steuerliche Identifikationsnummer
 * (`36 574 261 809`): eleven digits, no leading zero, exactly one digit
 * repeated (two or three times) in the first ten, ISO 7064 MOD 11,10; counted
 * only with a tax-ID label on the page (`TAX_ID_LABELS`).
 *
 * Pure and client-safe: the composer runs it.
 */

import { digitsAt, digitTouches, skipSeparator } from './screen-chars'

const RVNR_WEIGHTS = [2, 1, 2, 5, 7, 1, 2, 1, 2, 1, 2, 1]

/** Labels of a German tax identification number, folded (`foldContent`), matched at a word start. */
export const TAX_ID_LABELS: readonly string[] = [
  'steuer-id',
  'steuer id',
  'steuerid',
  'steuer-idnr',
  'steueridentifikationsnummer',
  'steuerliche identifikationsnummer',
  'identifikationsnummer',
  'idnr',
]

const digitSum = (value: number): number =>
  String(value)
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0)

export function validDeSvnr(compact: string): boolean {
  if (!/^[0-9]{8}[A-Z][0-9]{3}$/.test(compact)) return false
  const area = Number(compact.slice(0, 2))
  const day = Number(compact.slice(2, 4))
  const month = Number(compact.slice(4, 6))
  if (area < 2 || area > 89 || day < 1 || day > 31 || month < 1 || month > 12) return false
  const letter = String(compact.charCodeAt(8) - 64).padStart(2, '0')
  const digits = compact.slice(0, 8) + letter + compact.slice(9, 11)
  let total = 0
  for (let i = 0; i < 12; i += 1) total += digitSum(Number(digits[i]) * RVNR_WEIGHTS[i])
  return total % 10 === Number(compact[11])
}

export function validDeTaxId(digits: string): boolean {
  if (!/^[0-9]{11}$/.test(digits) || digits[0] === '0') return false
  const counts = new Map<string, number>()
  for (const digit of digits.slice(0, 10)) counts.set(digit, (counts.get(digit) ?? 0) + 1)
  const repeated = [...counts.values()].filter((count) => count > 1)
  if (repeated.length !== 1 || (repeated[0] !== 2 && repeated[0] !== 3)) return false
  let product = 10
  for (const digit of digits.slice(0, 10)) {
    const total = (Number(digit) + product) % 10 || 10
    product = (2 * total) % 11
  }
  return (11 - product) % 10 === Number(digits[10])
}

export function maskDeSvnr(compact: string): string {
  return `•• •••••• • •${compact.slice(-2)}`
}

export function maskDeTaxId(digits: string): string {
  return `•• ••• ••• •${digits.slice(-2)}`
}

// ------------------------------------------------------------------ parsers

/**
 * The Rentenversicherungsnummer printed at `start`: `AA DDMMYY L SS C`, whitespace
 * allowed after the area, the date, the letter and before the check digit.
 */
export function deSvnrAt(text: string, start: number, soft: ReadonlySet<number>): { compact: string; end: number } | null {
  const area = digitsAt(text, start, 2)
  if (!area) return null
  const date = digitsAt(text, skipSeparator(text, area.end, ''), 6)
  if (!date) return null
  const letterAt = skipSeparator(text, date.end, '')
  const letter = text[letterAt]
  if (!letter || letter < 'A' || letter > 'Z') return null
  const serial = digitsAt(text, skipSeparator(text, letterAt + 1, ''), 2)
  if (!serial) return null
  const check = digitsAt(text, skipSeparator(text, serial.end, ''), 1)
  if (!check) return null
  const compact = area.digits + date.digits + letter + serial.digits + check.digits
  if (digitTouches(text, check.end, soft) || !validDeSvnr(compact)) return null
  return { compact, end: check.end }
}

/** The tax identification number printed at `start`: unbroken, or 2-3-3-3 joined by whitespace. */
export function deTaxIdAt(text: string, start: number, soft: ReadonlySet<number>): { digits: string; end: number } | null {
  const first = digitsAt(text, start, 2)
  if (!first) return null
  let found = digitsAt(text, start, 11)
  if (!found) {
    let digits = first.digits
    let index = first.end
    for (const width of [3, 3, 3]) {
      const groupAt = skipSeparator(text, index, '')
      const group = groupAt > index ? digitsAt(text, groupAt, width) : null
      if (!group) return null
      digits += group.digits
      index = group.end
    }
    found = { digits, end: index }
  }
  if (digitTouches(text, found.end, soft) || !validDeTaxId(found.digits)) return null
  return found
}
