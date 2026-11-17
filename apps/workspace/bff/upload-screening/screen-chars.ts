const DECIMAL_DIGIT = /\p{Nd}/u

export const SCREENING_WHITESPACE =
  '\t\n\v\f\r \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000'
export function isWhitespace(char: string): boolean {
  return char.length === 1 && SCREENING_WHITESPACE.includes(char)
}

export function isDecimalDigit(codePoint: number): boolean {
  return codePoint >= 0 && DECIMAL_DIGIT.test(String.fromCodePoint(codePoint))
}

export function decimalDigitValue(codePoint: number): number | null {
  if (codePoint >= 0x30 && codePoint <= 0x39) return codePoint - 0x30
  if (!isDecimalDigit(codePoint)) return null
  let zero = codePoint
  while (isDecimalDigit(zero - 1)) zero -= 1
  return (codePoint - zero) % 10
}

export interface Digit {
  value: string
  width: number
}

export function digitAt(text: string, index: number): Digit | null {
  if (index >= text.length) return null
  const codePoint = text.codePointAt(index) ?? 0
  const value = decimalDigitValue(codePoint)
  return value === null ? null : { value: String(value), width: codePoint > 0xffff ? 2 : 1 }
}

export function digitsAt(
  text: string,
  index: number,
  count: number
): { digits: string; end: number } | null {
  let digits = ''
  let cursor = index
  for (let i = 0; i < count; i += 1) {
    const digit = digitAt(text, cursor)
    if (!digit) return null
    digits += digit.value
    cursor += digit.width
  }
  return { digits, end: cursor }
}

export function skipSeparator(text: string, index: number, marks: string): number {
  let cursor = index
  if (cursor < text.length && isWhitespace(text[cursor])) {
    while (cursor < text.length && isWhitespace(text[cursor])) cursor += 1
  } else if (cursor < text.length && marks.includes(text[cursor])) {
    cursor += 1
  }
  return cursor
}

export function digitTouches(text: string, index: number, soft: ReadonlySet<number>): boolean {
  return digitAt(text, index) !== null && !soft.has(index)
}
