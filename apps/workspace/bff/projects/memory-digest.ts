/**
 * The project memory digest's text, grouped by topic (ADR-0180, topics amendment).
 *
 * Every printed note carries its topic as the first tag of its line, and the
 * digest opens, right after its header, with an index of the topics of the notes
 * it prints. The index is built from the PRINTED notes and never from the recall
 * window: a restricted note the digest leaves out (its folders not admitted for
 * this turn, or past the character budget) names no topic here.
 *
 * English, because the agent reads it; topic names are the office's own words,
 * quoted the way `bff/knowledge/digest-format.ts` quotes text, and quoted the
 * same way in the index and in the tags, as the personal block does
 * (`bff/personal-memory/digest.ts`). A shelf with no topic at all renders exactly
 * as it did before topics: no index, no tag.
 */

import { formatBoundedDigestWithKept } from '@/lib/knowledge/digest-format'
import { summarizeTopics } from '@/lib/memory-topics/topic'
import type { DigestItem } from './memory-service'

const DIGEST_HEADER = 'PROJECT_MEMORY v1'

/** The most topics the index names; any further topic is counted in the index, not named. */
export const DIGEST_TOPIC_INDEX_MAX = 20
/** The index line's own budget, so long topic names cannot take the room of the notes. */
export const DIGEST_TOPIC_INDEX_MAX_CHARS = 300

/** A text as the digest quotes it: one line, quotes and backslashes escaped (the rule of `digest-format.ts`). */
function quoted(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * A topic as the digest holds it: one line, and none of the brackets or bar a
 * tag is built from, so the name cannot close its tag or start another one. The
 * index and the tags clean a name the same way, so they agree.
 */
function cleanTopic(topic: string | null | undefined): string | null {
  const clean = (topic ?? '').replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean === '' ? null : clean
}

/** The index line for these notes (the ones the digest prints); null when none of them has a topic. */
export function topicIndexLine(items: readonly { topic?: string | null }[]): string | null {
  const topics = summarizeTopics(items.map((item) => ({ topic: cleanTopic(item.topic) })))
  if (topics.length === 0) return null
  const head = `topics of the project's notes shown here (at most ${DIGEST_TOPIC_INDEX_MAX} named):`
  const parts: string[] = []
  let used = head.length
  for (const { name, count } of topics.slice(0, DIGEST_TOPIC_INDEX_MAX)) {
    const part = `${quoted(name)} (${count})`
    if (used + part.length + 1 > DIGEST_TOPIC_INDEX_MAX_CHARS) break
    parts.push(part)
    used += part.length + 1
  }
  const more = topics.length - parts.length
  if (more > 0) parts.push(`(+${more} more topics, not named)`)
  return `${head} ${parts.join(', ')}`
}

/** The header of a digest over these notes: the header, then the index when there is one. */
function headerFor(items: readonly { topic?: string | null }[]): string {
  const index = topicIndexLine(items)
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
 * the budget. The index is always written from exactly the notes that print,
 * so a restricted note the budget left out names no topic.
 */
function fitTopicDigest<T extends DigestItem & { tags: string[] }>(lines: T[], maxChars: number): string | null {
  let kept = formatBoundedDigestWithKept(DIGEST_HEADER, lines, maxChars).kept
  while (kept.length > 0) {
    const digest = formatBoundedDigestWithKept(headerFor(kept), kept, Number.POSITIVE_INFINITY).digest
    if (digest && digest.length <= maxChars) return digest
    kept = kept.slice(0, -1)
  }
  return null
}

/**
 * The digest text for `items` (in print order): the header, the topic index,
 * then one line per note, with the omitted-notes notice when `omitted` is set.
 * Null when no note prints.
 */
export function formatTopicDigest(items: readonly DigestItem[], omitted: number, maxChars: number): string | null {
  const digest = fitTopicDigest(
    items.map((item) => ({ ...item, tags: tagsOf(item) })),
    maxChars
  )
  if (!digest) return null
  // A cap says so in the text the MODEL reads, not only in the operator's log
  // (gotchas.md). The notice is the one the digest has always carried, so a
  // shelf with no topic reads exactly as it did.
  return omitted > 0
    ? `${digest}\n(+${omitted} weitere Notizen zu diesem Projekt, hier nicht gezeigt — frag nach, wenn eine davon zählen könnte.)`
    : digest
}
