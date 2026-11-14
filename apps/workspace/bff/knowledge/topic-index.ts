/**
 * The topic index and the quoting both memory digests share (ADR-0180): the
 * personal block (`bff/personal-memory/digest.ts`) and the project digest
 * (`bff/projects/memory-digest.ts`) open with the same bounded index, and quote
 * a topic name the same way in the index, the headings and the tags.
 *
 * Pure. English, because the agent reads it; topic names are the person's or
 * the office's own words, quoted so a name cannot forge a line or a tag.
 */

import type { MemoryTopicCount } from '@/lib/memory-topics/topic'

/** The most topics the index names; any further topic is counted in the index, not named. */
export const TOPIC_INDEX_MAX_TOPICS = 20
/** The index line's own budget, so long topic names cannot take the room of the notes. */
export const TOPIC_INDEX_MAX_CHARS = 300

/** A text as a digest quotes it: one line, quotes and backslashes escaped (the rule of `digest-format.ts`). */
export function quoted(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return `"${line.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The index line: `lead` (what the topics are of), then the bounds, then each
 * topic with its count, most notes first. Null when there is no topic. Bounded in
 * topics and in characters, and the line says so.
 */
export function topicIndexLine(lead: string, topics: readonly MemoryTopicCount[]): string | null {
  if (topics.length === 0) return null
  const head = `${lead} (at most ${TOPIC_INDEX_MAX_TOPICS} named):`
  const parts: string[] = []
  let used = head.length
  for (const topic of topics.slice(0, TOPIC_INDEX_MAX_TOPICS)) {
    const part = `${quoted(topic.name)} (${topic.count})`
    if (used + part.length + 1 > TOPIC_INDEX_MAX_CHARS) break
    parts.push(part)
    used += part.length + 1
  }
  const more = topics.length - parts.length
  if (more > 0) parts.push(`(+${more} more topics, not named)`)
  return `${head} ${parts.join(', ')}`
}
