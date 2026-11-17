import type { MemoryTopicCount } from '@/lib/memory-topics/topic'

export const TOPIC_INDEX_MAX_TOPICS = 20
export const TOPIC_INDEX_MAX_CHARS = 300

export function quoted(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return `"${line.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

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
