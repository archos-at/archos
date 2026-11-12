/**
 * The project memory digest's text, grouped by topic (ADR-0180, topics amendment).
 *
 * Every printed note carries its topic as the first tag of its line, and the
 * digest opens, right after its header, with a bounded index of the topics the
 * agent may file under: the shelf's OPEN topics (the caller passes them, the
 * project's notes and the office's open notes), plus the topics of the restricted
 * notes the caller admitted and printed this turn. A restricted note that is left
 * out (its folders not admitted for this turn, or past the character budget)
 * names no topic here, and an open topic is named even when none of its notes
 * prints. Without the shelf's topics the index counts the printed notes.
 *
 * English, because the agent reads it; topic names are the office's own words,
 * quoted the way `bff/knowledge/digest-format.ts` quotes text, and quoted the
 * same way in the index and in the tags, as the personal block does
 * (`bff/personal-memory/digest.ts`). A shelf with no topic at all renders exactly
 * as it did before topics: no index, no tag.
 */

import { formatBoundedDigestWithKept } from '@/lib/knowledge/digest-format'
import {
  quoted,
  TOPIC_INDEX_MAX_CHARS,
  TOPIC_INDEX_MAX_TOPICS,
  topicIndexLine as indexLineOf,
} from '@/lib/knowledge/topic-index'
import type { MemoryTopicCount } from '@/lib/memory-topics/topic'
import type { DigestItem } from './memory-service'

const DIGEST_HEADER = 'PROJECT_MEMORY v1'

/** The most topics the index names (the bound `topic-index.ts` shares with the personal block). */
export const DIGEST_TOPIC_INDEX_MAX = TOPIC_INDEX_MAX_TOPICS
/** The index line's own budget, so long topic names cannot take the room of the notes. */
export const DIGEST_TOPIC_INDEX_MAX_CHARS = TOPIC_INDEX_MAX_CHARS

/**
 * A topic as the digest holds it: one line, and none of the brackets or bar a
 * tag is built from, so the name cannot close its tag or start another one. The
 * index and the tags clean a name the same way, so they agree.
 */
function cleanTopic(topic: string | null | undefined): string | null {
  const clean = (topic ?? '').replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean === '' ? null : clean
}

/**
 * The topics the index names, most notes first. With the shelf's open topics,
 * the count is those plus the printed restricted notes (already admitted by the
 * caller); without them, every printed note counts.
 */
function indexedTopics(
  items: readonly DigestItem[],
  shelf: readonly MemoryTopicCount[] | undefined
): MemoryTopicCount[] {
  const counts = new Map<string, number>()
  const add = (topic: string | null | undefined, count: number) => {
    const name = cleanTopic(topic)
    if (name) counts.set(name, (counts.get(name) ?? 0) + count)
  }
  for (const { name, count } of shelf ?? []) add(name, count)
  for (const item of items) {
    if (!shelf || (item.restrictedFolderIds?.length ?? 0) > 0) add(item.topic, 1)
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'))
}

/** The index line for these notes and the shelf's open topics; null when neither has a topic. */
export function topicIndexLine(items: readonly DigestItem[], shelf?: readonly MemoryTopicCount[]): string | null {
  return indexLineOf("topics of the project's memory, bounded", indexedTopics(items, shelf))
}

/** The header of a digest over these notes: the header, then the index when there is one. */
function headerFor(items: readonly DigestItem[], shelf: readonly MemoryTopicCount[] | undefined): string {
  const index = topicIndexLine(items, shelf)
  return index ? `${DIGEST_HEADER}\n${index}` : DIGEST_HEADER
}

/** The tags a line carries: its topic first (when it has one), then the scope, restriction and the note's own tags. */
function tagsOf(item: DigestItem): string[] {
  const topic = cleanTopic(item.topic)
  return [
    ...(topic ? [quoted(topic)] : []),
    ...(item.scope === 'organization' ? ['org-wide'] : []),
    // Only ever reaches a turn cleared for it; the tag tells the model the
    // note is confidential, so it is not written into anything shared.
    ...(item.restrictedFolderIds && item.restrictedFolderIds.length > 0 ? ['restricted'] : []),
    item.kind,
    item.confidence,
    item.verification,
  ]
}

/**
 * The digest text over `lines` (in print order), the index counted in the budget.
 *
 * The notes that fit without the index are the first candidates. The index is
 * then written from the notes kept, and when it does not fit beside them the
 * last note is dropped and the index written again, until the text is within
 * the budget. The restricted part of the index is always written from exactly
 * the notes that print, so a restricted note the budget left out names no topic.
 */
function fitTopicDigest<T extends DigestItem & { tags: string[] }>(
  lines: T[],
  maxChars: number,
  shelf: readonly MemoryTopicCount[] | undefined
): string | null {
  let kept = formatBoundedDigestWithKept(DIGEST_HEADER, lines, maxChars).kept
  while (kept.length > 0) {
    const digest = formatBoundedDigestWithKept(headerFor(kept, shelf), kept, Number.POSITIVE_INFINITY).digest
    if (digest && digest.length <= maxChars) return digest
    kept = kept.slice(0, -1)
  }
  return null
}

/**
 * The digest text for `items` (in print order): the header, the topic index,
 * then one line per note, with the omitted-notes notice when `omitted` is set.
 * `shelf` is the shelf's open topics (`projectTopicsOf` with no clearance); the
 * caller passes only the restricted notes it admitted. Null when no note prints.
 */
export function formatTopicDigest(
  items: readonly DigestItem[],
  omitted: number,
  maxChars: number,
  shelf?: readonly MemoryTopicCount[]
): string | null {
  const digest = fitTopicDigest(
    items.map((item) => ({ ...item, tags: tagsOf(item) })),
    maxChars,
    shelf
  )
  if (!digest) return null
  // A cap says so in the text the MODEL reads, not only in the operator's log
  // (gotchas.md). The notice is the one the digest has always carried, so a
  // shelf with no topic reads exactly as it did.
  return omitted > 0
    ? `${digest}\n(+${omitted} weitere Notizen zu diesem Projekt, hier nicht gezeigt — frag nach, wenn eine davon zählen könnte.)`
    : digest
}
