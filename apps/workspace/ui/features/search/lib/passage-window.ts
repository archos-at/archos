import type { TextSegment } from '@/lib/text/term-segments'

const PASSAGE_LEAD_CHARS = 32

export function leadUpToMatch(segments: readonly TextSegment[]): readonly TextSegment[] {
  const first = segments.findIndex((segment) => segment.match)
  if (first <= 0) return segments
  const before = segments.slice(0, first).map((segment) => segment.text).join('')
  if (before.length <= PASSAGE_LEAD_CHARS) return segments
  const tail = before.slice(before.length - PASSAGE_LEAD_CHARS)
  const wordStart = tail.indexOf(' ')
  const lead = (wordStart === -1 ? tail : tail.slice(wordStart + 1)).trimStart()
  return [{ text: lead, match: false }, ...segments.slice(first)]
}
