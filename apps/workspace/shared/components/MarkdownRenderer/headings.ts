import { headingAnchorId } from './utils'

export type MarkdownHeadingLevel = 1 | 2 | 3 | 4

export interface MarkdownHeading {
  level: MarkdownHeadingLevel
  text: string
  id: string
  line: number
}

const HEADING_RE = /^ {0,3}(#{1,4})(?:[ \t]+(.*))?$/

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/

const CLOSING_SEQUENCE_RE = /(?:^|[ \t])#+[ \t]*$/

const INLINE_LINK_RE = /!?\[([^\]]*)\]\([^)]*\)/g

const HTML_TAG_RE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/][^>]*)?>/g

const UNDERSCORE_EMPHASIS_RE = /(^|[\s([{"'])__?(\S(?:[^_]*\S)?)__?(?=[\s)\]}"'.,;:!?]|$)/g

const STAR_EMPHASIS_RE = /\*{1,3}([^*]+)\*{1,3}/g
const STRIKE_RE = /~~([^~]+)~~/g
const CODE_SPAN_RE = /`+([^`]+)`+/g

const ESCAPE_RE = /\\([\\`*_{}[\]()#+\-.!~<>|])/g

const MAX_TAG_PASSES = 8

const stripHtmlTags = (text: string): string => {
  let current = text
  for (let pass = 0; pass < MAX_TAG_PASSES; pass += 1) {
    const next = current.replace(HTML_TAG_RE, '')
    if (next === current) return next
    current = next
  }
  return current.replace(/</g, '')
}

const headingDisplayText = (raw: string): string =>
  stripHtmlTags(raw.replace(INLINE_LINK_RE, '$1'))
    .replace(CODE_SPAN_RE, '$1')
    .replace(STRIKE_RE, '$1')
    .replace(STAR_EMPHASIS_RE, '$1')
    .replace(UNDERSCORE_EMPHASIS_RE, '$1$2')
    .replace(ESCAPE_RE, '$1')
    .replace(/\s+/g, ' ')
    .trim()

const claimHeadingId = (base: string, taken: Set<string>, counts: Map<string, number>): string => {
  const occurrence = (counts.get(base) ?? 0) + 1
  counts.set(base, occurrence)
  if (occurrence === 1 && !taken.has(base)) {
    taken.add(base)
    return base
  }
  let suffix = Math.max(occurrence, 2)
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  counts.set(base, suffix)
  taken.add(`${base}-${suffix}`)
  return `${base}-${suffix}`
}

export const markdownHeadings = (markdown: string): MarkdownHeading[] => {
  if (!markdown) return []

  const headings: MarkdownHeading[] = []
  const taken = new Set<string>()
  const counts = new Map<string, number>()
  let fence: { char: string; length: number } | null = null
  let line = 0

  for (const raw of markdown.split('\n')) {
    line += 1

    const fenceMatch = FENCE_RE.exec(raw)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      const char = marker[0]
      if (!fence) {
        fence = { char, length: marker.length }
        continue
      }
      if (char === fence.char && marker.length >= fence.length && fenceMatch[2].trim() === '') {
        fence = null
      }
      continue
    }
    if (fence) continue

    const headingMatch = HEADING_RE.exec(raw)
    if (!headingMatch) continue

    const text = headingDisplayText((headingMatch[2] ?? '').trimEnd().replace(CLOSING_SEQUENCE_RE, ''))
    if (!text) continue

    const base = headingAnchorId(text)
    if (!base) continue

    headings.push({
      level: headingMatch[1].length as MarkdownHeadingLevel,
      text,
      id: claimHeadingId(base, taken, counts),
      line,
    })
  }

  return headings
}
