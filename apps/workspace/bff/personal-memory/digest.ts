/**
 * The `PERSONAL_MEMORY v1` block a turn carries (ADR-0180): the person's notes,
 * grouped by topic, under a bounded topic index. Pure: `service.ts` loads the
 * rows, this renders them, and the block's tests read this function directly.
 *
 * A shelf with no topic at all renders exactly as it did before topics: one line
 * per note under the header. Once any note has a topic, the block opens with the
 * index (every topic of the person's notes and how many each holds, at most
 * `TOPIC_INDEX_MAX_TOPICS` (`bff/knowledge/topic-index.ts`) named), then one group per topic, in the
 * order each topic's first note appears in the repository's order (pinned first),
 * and the notes with no topic last.
 *
 * English, because the agent reads it. Topic names and note texts are the
 * person's own words, quoted the way `bff/knowledge/digest-format.ts` quotes
 * them, so text cannot forge a line or a heading.
 */

import { formatBoundedDigestWithKept, type DigestLineItem } from '@/lib/knowledge/digest-format'
import { quoted, topicIndexLine as indexLineOf } from '@/lib/knowledge/topic-index'
import type { MemoryTopicCount } from '@/lib/memory-topics/topic'

/** The header the agent's prompt names; the version moves when the line format does. */
export const PERSONAL_MEMORY_DIGEST_HEADER = 'PERSONAL_MEMORY v1'
/** The most notes one turn is given. */
export const PERSONAL_DIGEST_MAX_ITEMS = 20
/** The block's character budget, footer included. */
export const PERSONAL_DIGEST_MAX_CHARS = 1500
/** The most topics the index names (the bound `topic-index.ts` shares with the project digest). */

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
 *
 * The notes KEPT are chosen first, in the repository's order (pinned first, then
 * newest): the longest run of them whose whole block (header, index, headings and
 * lines) fits the budget. A note that does not fit ends the run, as it always has.
 * Only then are the kept notes grouped by topic for printing, so a topic's heading
 * can never take the room of a pinned note that came earlier. The footer counts
 * every note the block leaves out.
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
 * The longest run of notes, in repository order, whose grouped block fits the
 * budget. Grouping only ever adds text (a heading per topic), so a shorter run
 * that fits never becomes a longer one that does not.
 */
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

/** The header, then one group per topic in the order of its first note, the notes with no topic last. */
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
