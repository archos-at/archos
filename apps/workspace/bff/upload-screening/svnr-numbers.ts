/**
 * What makes ten digits an Austrian social-security number: the content
 * screen's SVNR rules, the twin of `agent.common.svnr_numbers`, whose docstring
 * is the full statement. Both are held to `tests/fixtures/content_screen_cases.json`.
 *
 * One ten-digit number in about 250 passes the checksum and the birth date, so
 * the shape decides as much: the date's parts are joined or all split by the
 * same separator (a timestamp, `2026-09-12 10:17`, mixes them), no `:` follows
 * (a time), and an unbroken number counts only with a social-security label on
 * the page (`SVNR_LABELS`), since customer, receipt and Unix-time numbers are
 * printed unbroken too.
 *
 * Pure and client-safe: the composer runs it.
 */

const SVNR_WEIGHTS = [3, 7, 9, 0, 5, 8, 4, 2, 1, 6]
/** Where a social-security number may start: a digit not right after another. */
export const SVNR_START = /(?<!\p{Nd})\p{Nd}/gu
/** What may separate its parts besides whitespace. */
export const SVNR_MARKS = '-./'

/** Labels of a social-security number, folded (`foldContent`), matched at a word start. */
export const SVNR_LABELS: readonly string[] = [
  'svnr',
  'sv-nr',
  'sv nr',
  'sv-nummer',
  'svnummer',
  'sozialversicherung',
  'versicherungsnummer',
  'versicherungsnr',
  'vsnr',
]

export function validAtSvnr(digits: string): boolean {
  if (!/^[0-9]{10}$/.test(digits) || digits[0] === '0') return false
  let sum = 0
  for (let i = 0; i < 10; i += 1) sum += Number(digits[i]) * SVNR_WEIGHTS[i]
  const check = sum % 11
  if (check === 10 || check !== Number(digits[3])) return false
  const day = Number(digits.slice(4, 6))
  const month = Number(digits.slice(6, 8))
  return day >= 1 && day <= 31 && month >= 1 && month <= 15
}

/**
 * Whether the shape around ten valid digits is a social-security number's, not
 * a timestamp's. `dateSeparators` join the date's day to its month and its month
 * to its year, each `''` (joined), `' '` (any whitespace) or the mark itself.
 */
export function printedAsSvnr(
  dateSeparators: readonly [string, string],
  timeFollows: boolean
): boolean {
  return dateSeparators[0] === dateSeparators[1] && !timeFollows
}

export function maskSvnr(digits: string): string {
  return `•••• ••••${digits.slice(-2)}`
}
