/**
 * The `PERSONAL_MEMORY v1` block a turn carries (ADR-0180): the person's notes,
 * grouped by topic, under a bounded topic index. Pure: `service.ts` loads the
 * rows, this renders them, and the block's tests read this function directly.
 *
 * A shelf with no topic at all renders exactly as it did before topics: one line
 * per note under the header. Once any note has a topic, the block opens with the
 * index (every topic of the person's notes and how many each holds, at most
 * {@link PERSONAL_DIGEST_MAX_TOPICS} named), then one group per topic, in the
 * order each topic's first note appears in the repository's order (pinned first),
 * and the notes with no topic last.
 *
 * English, because the agent reads it. Topic names and note texts are the
 * person's own words, quoted the way `bff/knowledge/digest-format.ts` quotes
 * them, so text cannot forge a line or a heading.
 */

import { formatBoundedDigestWithKept, type DigestLineItem } from '@/lib/knowledge/digest-format'
import {
  quoted,
  TOPIC_INDEX_MAX_CHARS,
  TOPIC_INDEX_MAX_TOPICS,
  topicIndexLine as indexLineOf,
} from '@/lib/knowledge/topic-index'
import type { MemoryTopicCount } from '@/lib/memory-topics/topic'

/** The header the agent's prompt names; the version moves when the line format does. */
export const PERSONAL_MEMORY_DIGEST_HEADER = 'PERSONAL_MEMORY v1'
/** The most notes one turn is given. */
export const PERSONAL_DIGEST_MAX_ITEMS = 20
/** The block's character budget, footer included. */
export const PERSONAL_DIGEST_MAX_CHARS = 1500
/** The most topics the index names (the bound `topic-index.ts` shares with the project digest). */
export const PERSONAL_DIGEST_MAX_TOPICS = TOPIC_INDEX_MAX_TOPICS
/** The index line's own budget, so long topic names cannot take the room of the notes. */
export const PERSONAL_DIGEST_INDEX_MAX_CHARS = TOPIC_INDEX_MAX_CHARS

/** A note as the block needs it: what it says, its kind, whether it is pinned, and its topic. */
export interface PersonalDigestNote {
  kind: string
  pinned: boolean
  content: string
  topic: string | null
}

/** The whole shelf, not only the notes the block shows: its topics and how many notes it holds. */
export interface PersonalDigestShelf {
  /** Each topic of the person's notes with its count, most notes first (`summarizeTopics`). */
  topics: readonly MemoryTopicCount[]
  /** How many notes the person holds in all, the shown ones included. */
  total: number
}

const footer = (omitted: number): string => `(+${omitted} more personal notes, not shown.)`

/** The topic index line, or null when the shelf has no topic. Bounded in topics and in characters, and says so. */
export function topicIndexLine(shelf: PersonalDigestShelf): string | null {
  return indexLineOf(`topics of the person's ${shelf.total} notes`, shelf.topics)
}

/** The heading of one topic's group; the notes with no topic are the last group. */
function headingOf(topic: string | null): string {
  return topic === null ? 'No topic:' : `Topic ${quoted(topic)}:`
}

interface TopicGroup {
  topic: string | null
  notes: PersonalDigestNote[]
}

/** The notes grouped by topic, the groups in order of their first note, the notes with no topic last. */
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

/**
 * The block as the agent reads it, or null when the shelf has no note to show.
 * Notes are given in the repository's order (pinned first, then newest); a cut
 * stops at the first note that does not fit, as it always has, and the footer
 * counts every note the block leaves out.
 */
export function renderPersonalMemoryDigest(
  notes: readonly PersonalDigestNote[],
  shelf: PersonalDigestShelf
): string | null {
  if (shelf.total === 0) return null
  const shown = notes.filter((note) => note.content.trim() !== '')
  const index = topicIndexLine(shelf)
  const header = index ? `${PERSONAL_MEMORY_DIGEST_HEADER}\n${index}` : PERSONAL_MEMORY_DIGEST_HEADER
  // Reserve the footer's room up front, so adding it never breaks the budget.
  const budget = PERSONAL_DIGEST_MAX_CHARS - (footer(shelf.total).length + 1)
  const { text, kept } = index ? groupedBody(shown, header, budget) : flatBody(shown, budget)
  const omitted = shelf.total - kept
  return omitted > 0 ? `${text}\n${footer(omitted)}` : text
}

/** One line per note under the header, as the block read before topics. */
function flatBody(notes: readonly PersonalDigestNote[], budget: number): { text: string; kept: number } {
  const { digest, kept } = formatBoundedDigestWithKept(PERSONAL_MEMORY_DIGEST_HEADER, notes.map(itemOf), budget)
  return { text: digest ?? PERSONAL_MEMORY_DIGEST_HEADER, kept: kept.length }
}

/**
 * The index, then one group per topic. A group is rendered by the shared
 * formatter under its heading; the first group that loses a note ends the block,
 * so the cut keeps the same priority as the flat block.
 */
function groupedBody(
  notes: readonly PersonalDigestNote[],
  header: string,
  budget: number
): { text: string; kept: number } {
  let text = header
  let kept = 0
  for (const group of groupNotesByTopic(notes)) {
    const room = budget - text.length - 1
    const piece = formatBoundedDigestWithKept(headingOf(group.topic), group.notes.map(itemOf), room)
    if (!piece.digest) break
    text = `${text}\n${piece.digest}`
    kept += piece.kept.length
    if (piece.kept.length < group.notes.length) break
  }
  return { text, kept }
}
