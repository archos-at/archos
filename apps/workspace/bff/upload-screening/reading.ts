export const SCREENING_IGNORABLE = '\u00ad\u200b\u200c\u200d\u2060\ufeff'

const IGNORABLE_RUN = new RegExp(`[${SCREENING_IGNORABLE}]+`, 'g')

export function withoutIgnorables(text: string): string {
  return text.replace(IGNORABLE_RUN, '')
}

export const SPLIT_TERM_MIN = 8
export const TERM_FRAGMENT = 3

export function splitTermEnd(text: string, start: number, word: string, joiners: string): number {
  let cursor = start
  let split = false
  for (let position = 0; position < word.length; position += 1) {
    const char = word[position]
    if (cursor < text.length && text[cursor] === char) {
      cursor += 1
      continue
    }
    const joined =
      cursor + 1 < text.length && joiners.includes(text[cursor]) && text[cursor + 1] === char
    const fits = position >= TERM_FRAGMENT && position <= word.length - TERM_FRAGMENT
    if (split || !joined || !fits) return -1
    split = true
    cursor += 2
  }
  return cursor
}
