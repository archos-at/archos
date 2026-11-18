const SVNR_WEIGHTS = [3, 7, 9, 0, 5, 8, 4, 2, 1, 6]
export const SVNR_START = /(?<!\p{Nd})\p{Nd}/gu
export const SVNR_MARKS = '-./'

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

export function printedAsSvnr(
  dateSeparators: readonly [string, string],
  timeFollows: boolean
): boolean {
  return dateSeparators[0] === dateSeparators[1] && !timeFollows
}

export function maskSvnr(digits: string): string {
  return `•••• ••••${digits.slice(-2)}`
}
