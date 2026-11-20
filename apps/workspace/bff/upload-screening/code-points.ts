export const ASCII_LETTER = /^[A-Za-z]$/

export function codePointAt(text: string, index: number): string {
  if (index < 0 || index >= text.length) return ''
  return String.fromCodePoint(text.codePointAt(index) ?? 0)
}

export function codePointBefore(text: string, index: number): string {
  if (index === 0) return ''
  const low = text.charCodeAt(index - 1)
  const isLowSurrogate = low >= 0xdc00 && low <= 0xdfff
  return isLowSurrogate && index >= 2 ? text.slice(index - 2, index) : text.slice(index - 1, index)
}

export function codePointLength(text: string): number {
  return Array.from(text).length
}

export const isAsciiLetter = (char: string | undefined): boolean => !!char && ASCII_LETTER.test(char)
