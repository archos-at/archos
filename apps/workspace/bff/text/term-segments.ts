export interface TextSegment {
  text: string
  match: boolean
}

const MIN_TERM_LENGTH = 2
const MIN_STEM_LENGTH = 4
const INFLECTION_ENDINGS = ['ern', 'en', 'er', 'es', 'em', 'e', 'n', 's'] as const
const SOFT_HYPHEN = '­'

export function stemOf(term: string): string | null {
  const lower = term.toLocaleLowerCase('de')
  for (const ending of INFLECTION_ENDINGS) {
    if (lower.endsWith(ending) && term.length - ending.length >= MIN_STEM_LENGTH) return term.slice(0, term.length - ending.length)
  }
  return null
}

function foldChar(char: string): string {
  const lower = char.toLocaleLowerCase('de')
  return lower.length === char.length ? lower : char
}

function foldText(text: string): { folded: string; from: number[]; to: number[] } {
  let folded = ''
  const from: number[] = []
  const to: number[] = []
  let at = 0
  for (const char of text) {
    const end = at + char.length
    if (char !== SOFT_HYPHEN) {
      const unit = foldChar(char)
      folded += unit
      for (let i = 0; i < unit.length; i += 1) {
        from.push(at)
        to.push(end)
      }
    }
    at = end
  }
  return { folded, from, to }
}

const foldTerm = (term: string): string => [...term].map(foldChar).join('')

function queryTerms(query: string): string[] {
  const words = query
    .normalize('NFC')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= MIN_TERM_LENGTH)
  const stems = words.map(stemOf).filter((stem): stem is string => stem !== null)
  return [...new Set([...words, ...stems])].sort((a, b) => b.length - a.length)
}

function push(segments: TextSegment[], text: string, match: boolean): void {
  const last = segments.at(-1)
  if (last && last.match === match) last.text += text
  else segments.push({ text, match })
}

export function termSegments(text: string, query: string): TextSegment[] {
  const normalized = text.normalize('NFC')
  const terms = queryTerms(query).map(foldTerm)
  if (normalized === '') return []
  if (terms.length === 0) return [{ text: normalized, match: false }]
  const { folded, from, to } = foldText(normalized)
  const segments: TextSegment[] = []
  let last = 0
  let index = 0
  while (index < folded.length) {
    const term = terms.find((candidate) => folded.startsWith(candidate, index))
    if (!term) {
      index += 1
      continue
    }
    const start = from[index]
    const end = to[index + term.length - 1]
    if (start > last) push(segments, normalized.slice(last, start), false)
    push(segments, normalized.slice(start, end), true)
    last = end
    index += term.length
  }
  if (last < normalized.length) push(segments, normalized.slice(last), false)
  return segments
}
