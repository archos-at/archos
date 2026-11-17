import { AGENT_MENTION_ID, type MentionInput } from '@/lib/mentions/types'

export interface DraftMention {
  targetId: string
  display: string
}

export interface MentionQuery {
  query: string
  start: number
  end: number
}

export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; display: string; targetId: string }

const MAX_QUERY_LENGTH = 64

const OPENING_MARKS = new Set(['(', '[', '{', '<', '„', '“', '«', '‚', '‘', '‹'])

function isBoundary(character: string | undefined): boolean {
  return character === undefined || /\s/.test(character) || OPENING_MARKS.has(character)
}

function endsAtBoundary(character: string | undefined): boolean {
  return character === undefined || !/[\p{L}\p{N}_-]/u.test(character)
}

export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const position = Math.max(0, Math.min(caret, text.length))

  for (let index = position - 1; index >= 0; index -= 1) {
    if (position - index > MAX_QUERY_LENGTH + 1) return null
    const character = text[index]
    if (/\s/.test(character)) return null
    if (character !== '@') continue
    if (!isBoundary(text[index - 1])) return null
    return { query: text.slice(index + 1, position), start: index, end: position }
  }

  return null
}

export function insertMention(
  text: string,
  range: MentionQuery,
  display: string,
): { text: string; caret: number } {
  const rest = text.slice(range.end)
  const token = `@${display}${rest.startsWith(' ') ? '' : ' '}`
  return {
    text: `${text.slice(0, range.start)}${token}${rest}`,
    caret: range.start + token.length,
  }
}

interface Occurrence {
  start: number
  end: number
  display: string
}

function scanOccurrences(text: string, displays: readonly string[]): Occurrence[] {
  const ordered = Array.from(new Set(displays))
    .filter((display) => display.length > 0)
    .sort((left, right) => right.length - left.length)
  if (ordered.length === 0) return []

  const found: Occurrence[] = []
  let index = 0
  while (index < text.length) {
    if (text[index] === '@' && isBoundary(text[index - 1])) {
      const match = ordered.find(
        (display) =>
          text.startsWith(display, index + 1) &&
          endsAtBoundary(text[index + 1 + display.length]),
      )
      if (match) {
        found.push({ start: index, end: index + 1 + match.length, display: match })
        index += 1 + match.length
        continue
      }
    }
    index += 1
  }
  return found
}

export function reconcileMentions(
  text: string,
  mentions: readonly DraftMention[],
): DraftMention[] {
  if (mentions.length === 0) return []

  const occurrences = scanOccurrences(text, mentions.map((mention) => mention.display))
  const standing = new Map<string, number>()
  for (const occurrence of occurrences) {
    standing.set(occurrence.display, (standing.get(occurrence.display) ?? 0) + 1)
  }
  const recorded = new Map<string, number>()
  for (const mention of mentions) recorded.set(mention.display, (recorded.get(mention.display) ?? 0) + 1)
  const seen = new Map<string, number>()
  const pool = mentions.map((mention) => {
    const index = seen.get(mention.display) ?? 0
    seen.set(mention.display, index + 1)
    const stale = index < (recorded.get(mention.display) ?? 0) - (standing.get(mention.display) ?? 0)
    return { mention, used: stale }
  })
  const kept: DraftMention[] = []

  for (const occurrence of occurrences) {
    const entry = pool.find((item) => !item.used && item.mention.display === occurrence.display)
    if (!entry) continue
    entry.used = true
    kept.push({ targetId: entry.mention.targetId, display: entry.mention.display })
  }

  return kept
}

export function toMentionInputs(mentions: readonly DraftMention[]): MentionInput[] {
  const seen = new Set<string>()
  const inputs: MentionInput[] = []
  for (const mention of mentions) {
    if (seen.has(mention.targetId)) continue
    seen.add(mention.targetId)
    inputs.push({ targetId: mention.targetId })
  }
  return inputs
}

export function humanMentions(mentions: readonly DraftMention[]): DraftMention[] {
  return mentions.filter((mention) => mention.targetId !== AGENT_MENTION_ID)
}

export function splitMentionSegments(
  text: string,
  mentions: readonly DraftMention[],
): MentionSegment[] {
  if (!text) return []
  if (mentions.length === 0) return [{ kind: 'text', text }]

  const targets = new Map<string, string>()
  for (const mention of mentions) {
    if (!targets.has(mention.display)) targets.set(mention.display, mention.targetId)
  }

  const segments: MentionSegment[] = []
  let cursor = 0
  for (const occurrence of scanOccurrences(text, Array.from(targets.keys()))) {
    if (occurrence.start > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, occurrence.start) })
    }
    segments.push({
      kind: 'mention',
      text: text.slice(occurrence.start, occurrence.end),
      display: occurrence.display,
      targetId: targets.get(occurrence.display) as string,
    })
    cursor = occurrence.end
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })

  return segments
}
