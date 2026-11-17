import { formatBoundedDigestWithKept, type DigestLineItem } from '@/lib/knowledge/digest-format'
import { quoted, topicIndexLine as indexLineOf } from '@/lib/knowledge/topic-index'
import type { MemoryTopicCount } from '@/lib/memory-topics/topic'

export const PERSONAL_MEMORY_DIGEST_HEADER = 'PERSONAL_MEMORY v1'
export const PERSONAL_DIGEST_MAX_ITEMS = 20
export const PERSONAL_DIGEST_MAX_CHARS = 1500

export interface PersonalDigestNote {
  kind: string
  pinned: boolean
  content: string
  topic: string | null
}

export interface PersonalDigestShelf {
  topics: readonly MemoryTopicCount[]
  total: number
}

const footer = (omitted: number): string => `(+${omitted} more personal notes, not shown.)`

export function topicIndexLine(shelf: PersonalDigestShelf): string | null {
  return indexLineOf(`topics of the person's ${shelf.total} notes`, shelf.topics)
}

function headingOf(topic: string | null): string {
  return topic === null ? 'No topic:' : `Topic ${quoted(topic)}:`
}

interface TopicGroup {
  topic: string | null
  notes: PersonalDigestNote[]
}

function groupNotesByTopic(notes: readonly PersonalDigestNote[]): TopicGroup[] {
  const groups = new Map<string | null, PersonalDigestNote[]>()
  for (const note of notes) {
    const group = groups.get(note.topic)
    if (group) group.push(note)
    else groups.set(note.topic, [note])
  }
  return [...groups]
    .map(([topic, group]) => ({ topic, notes: group }))
    .sort((a, b) => Number(a.topic === null) - Number(b.topic === null))
}

function itemOf(note: PersonalDigestNote): DigestLineItem {
  return { tags: note.pinned ? ['pinned', note.kind] : [note.kind], content: note.content }
}

export function renderPersonalMemoryDigest(
  notes: readonly PersonalDigestNote[],
  shelf: PersonalDigestShelf
): string | null {
  if (shelf.total === 0) return null
  const shown = notes.filter((note) => note.content.trim() !== '')
  const index = topicIndexLine(shelf)
  const header = index ? `${PERSONAL_MEMORY_DIGEST_HEADER}\n${index}` : PERSONAL_MEMORY_DIGEST_HEADER
  const budget = PERSONAL_DIGEST_MAX_CHARS - (footer(shelf.total).length + 1)
  const { text, kept } = index ? groupedBody(shown, header, budget) : flatBody(shown, budget)
  const omitted = shelf.total - kept
  return omitted > 0 ? `${text}\n${footer(omitted)}` : text
}

function flatBody(notes: readonly PersonalDigestNote[], budget: number): { text: string; kept: number } {
  const { digest, kept } = formatBoundedDigestWithKept(PERSONAL_MEMORY_DIGEST_HEADER, notes.map(itemOf), budget)
  return { text: digest ?? PERSONAL_MEMORY_DIGEST_HEADER, kept: kept.length }
}

function groupedBody(
  notes: readonly PersonalDigestNote[],
  header: string,
  budget: number
): { text: string; kept: number } {
  let kept = 0
  while (kept < notes.length && groupedText(header, notes.slice(0, kept + 1)).length <= budget) {
    kept += 1
  }
  return { text: groupedText(header, notes.slice(0, kept)), kept }
}

function groupedText(header: string, notes: readonly PersonalDigestNote[]): string {
  const pieces = groupNotesByTopic(notes).flatMap((group) => {
    const { digest } = formatBoundedDigestWithKept(
      headingOf(group.topic),
      group.notes.map(itemOf),
      Number.POSITIVE_INFINITY
    )
    return digest ? [digest] : []
  })
  return [header, ...pieces].join('\n')
}
