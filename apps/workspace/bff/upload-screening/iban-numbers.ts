import { ASCII_LETTER } from './code-points'
import { digitAt, digitTouches, type Digit, skipSeparator } from './screen-chars'

const MASK = '••••'

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

export interface IbanMatch {
  compact: string
  end: number
}

export function ibanAt(text: string, start: number, soft: ReadonlySet<number>): IbanMatch | null {
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

export function maskIban(compact: string): string {
  const hidden = Math.ceil(Math.max(compact.length - 8, 0) / 4)
  return [compact.slice(0, 4), ...Array<string>(hidden).fill(MASK), compact.slice(-4)].join(' ')
}
