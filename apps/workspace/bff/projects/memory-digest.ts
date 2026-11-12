/**
 * The project memory digest's text, grouped by topic (ADR-0180, topics amendment).
 *
 * Every printed note carries its topic as the first tag of its line, and the
 * digest opens, right after its header, with an index of the topics of the notes
 * it prints. The index is built from the PRINTED notes and never from the recall
 * window: a restricted note the digest leaves out (its folders not admitted for
 * this turn, or past the character budget) names no topic here, so the index
 * cannot show a reader a topic they were not shown a note of.
 *
 * The index is counted against the same character budget as the lines, so the
 * digest stays bounded (`memory-service.ts` keeps the budget and the recall).
 */

import { formatBoundedDigestWithKept } from '@/lib/knowledge/digest-format'
import { summarizeTopics } from '@/lib/memory-topics/topic'
import type { DigestItem } from './memory-service'

const DIGEST_HEADER = 'PROJECT_MEMORY v1'

/** The most topics the index names. The index says so in its text, and says how many it left out. */
export const DIGEST_TOPIC_INDEX_MAX = 20

/**
 * A topic as it may sit inside a digest tag. A stored name cannot close the
 * bracket, open another tag or quote, or it would read as a different line; the
 * same name in the index is cleaned the same way, so the two agree.
 */
function tagSafeTopic(topic: string | null | undefined): string | null {
  const safe = (topic ?? '').replace(/[[\]|"\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return safe === '' ? null : safe
}

/** The index line for these notes (the ones the digest prints); null when none of them has a topic. */
export function topicIndexLine(items: readonly { topic?: string | null }[]): string | null {
  const topics = summarizeTopics(items.map((item) => ({ topic: tagSafeTopic(item.topic) })))
  if (topics.length === 0) return null
  const named = topics.slice(0, DIGEST_TOPIC_INDEX_MAX).map(({ name, count }) => `${name} (${count})`)
  const left = topics.length - named.length
  const tail = left > 0 ? `, … (+${left} weitere)` : ''
  return `Themen im Projektgedächtnis (höchstens ${DIGEST_TOPIC_INDEX_MAX}): ${named.join(', ')}${tail}`
}

/** The header of a digest over these notes: the header, then the index when there is one. */
function headerFor(items: readonly { topic?: string | null }[]): string {
  const index = topicIndexLine(items)
  return index ? `${DIGEST_HEADER}\n${index}` : DIGEST_HEADER
}

/** The tags a line carries: its topic first (when it has one), then the scope, restriction and the note's own tags. */
function tagsOf(item: DigestItem): string[] {
  const topic = tagSafeTopic(item.topic)
  return [
    ...(topic ? [topic] : []),
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
 * The notes that print, in order, under a header that names their topics.
 *
 * Two passes. The index is counted against the budget first, from the notes
 * that fit beside the bare header, so the notes that fit are those that fit with
 * the index in place. Then the index is written from exactly the notes that
 * fit. A prefix of the notes never has more topics or longer counts than the
 * longer prefix the budget was counted for, so the text stays within the budget.
 */
function fitTopicDigest(items: readonly DigestItem[], maxChars: number): string | null {
  const lines = items.map((item) => ({ ...item, tags: tagsOf(item) }))
  const withoutIndex = formatBoundedDigestWithKept(DIGEST_HEADER, lines, maxChars).kept
  const fitted = formatBoundedDigestWithKept(headerFor(withoutIndex), lines, maxChars).kept
  return formatBoundedDigestWithKept(headerFor(fitted), fitted, Number.POSITIVE_INFINITY).digest
}

/**
 * The digest text for `items` (in print order): the header, the topic index,
 * then one line per note, with the omitted-notes notice when `omitted` is set.
 * Null when no note prints.
 */
export function formatTopicDigest(items: readonly DigestItem[], omitted: number, maxChars: number): string | null {
  const digest = fitTopicDigest(items, maxChars)
  if (!digest) return null
  // A cap says so in the text the MODEL reads, not only in the operator's log
  // (gotchas.md): the notice is German for the people whose notes these are.
  return omitted > 0
    ? `${digest}\n(+${omitted} weitere Notizen zu diesem Projekt, hier nicht gezeigt — frag nach, wenn eine davon zählen könnte.)`
    : digest
}
