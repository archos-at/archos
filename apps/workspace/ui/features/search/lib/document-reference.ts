export interface DocumentReferenceQuery {
  query: string
  start: number
  end: number
}

const MAX_QUERY_LENGTH = 60

const OPENING_MARKS = new Set(['(', '[', '{', '<', '„', '“', '«', '‚', '‘', '‹'])

const isBoundary = (character: string | undefined): boolean =>
  character === undefined || /\s/.test(character) || OPENING_MARKS.has(character)

export function findDocumentReferenceQuery(text: string, caret: number): DocumentReferenceQuery | null {
  const position = Math.max(0, Math.min(caret, text.length))
  for (let index = position - 1; index >= 0; index -= 1) {
    if (position - index > MAX_QUERY_LENGTH + 1) return null
    const character = text[index]
    if (/\s/.test(character)) return null
    if (character !== '#') continue
    if (!isBoundary(text[index - 1])) return null
    return { query: text.slice(index + 1, position), start: index, end: position }
  }
  return null
}

export function insertDocumentReference(text: string, range: DocumentReferenceQuery, name: string): { text: string; caret: number } {
  const rest = text.slice(range.end)
  const token = `„${name}“${rest.startsWith(' ') ? '' : ' '}`
  return { text: `${text.slice(0, range.start)}${token}${rest}`, caret: range.start + token.length }
}
