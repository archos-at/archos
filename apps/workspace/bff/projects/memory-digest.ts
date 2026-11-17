import { formatBoundedDigestWithKept } from '@/lib/knowledge/digest-format'
import { quoted, topicIndexLine as indexLineOf } from '@/lib/knowledge/topic-index'
import type { MemoryTopicCount } from '@/lib/memory-topics/topic'
import type { DigestItem } from './memory-service'

const DIGEST_HEADER = 'PROJECT_MEMORY v1'

function cleanTopic(topic: string | null | undefined): string | null {
  const clean = (topic ?? '').replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean === '' ? null : clean
}

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

export function topicIndexLine(items: readonly DigestItem[], shelf?: readonly MemoryTopicCount[]): string | null {
  return indexLineOf("topics of the project's memory, bounded", indexedTopics(items, shelf))
}

function headerFor(items: readonly DigestItem[], shelf: readonly MemoryTopicCount[] | undefined): string {
  const index = topicIndexLine(items, shelf)
  return index ? `${DIGEST_HEADER}\n${index}` : DIGEST_HEADER
}

function tagsOf(item: DigestItem): string[] {
  const topic = cleanTopic(item.topic)
  return [
    ...(topic ? [quoted(topic)] : []),
    ...(item.scope === 'organization' ? ['org-wide'] : []),
    ...(item.restrictedFolderIds && item.restrictedFolderIds.length > 0 ? ['restricted'] : []),
    item.kind,
    item.confidence,
    item.verification,
  ]
}

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
  return omitted > 0
    ? `${digest}\n(+${omitted} weitere Notizen zu diesem Projekt, hier nicht gezeigt — frag nach, wenn eine davon zählen könnte.)`
    : digest
}
