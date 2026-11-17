import { BadRequestError } from '@/lib/api/errors'
import { MEMORY_TOPIC_MAX_LENGTH } from './wire'

export * from './wire'

export function normalizeTopic(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') throw new BadRequestError('A topic is text.')
  const text = raw.normalize('NFC').trim().replace(/\s+/g, ' ')
  if (text === '') return null
  if ([...text].length > MEMORY_TOPIC_MAX_LENGTH) {
    throw new BadRequestError(`A topic is at most ${MEMORY_TOPIC_MAX_LENGTH} characters.`)
  }
  return text
}

export function resolveTopic(raw: unknown, existing: readonly string[]): string | null {
  const text = normalizeTopic(raw)
  if (text === null) return null
  if (existing.includes(text)) return text
  const folded = text.toLocaleLowerCase('de')
  return existing.find((name) => name.toLocaleLowerCase('de') === folded) ?? text
}

export interface MemoryTopicCount {
  name: string
  count: number
}

export function summarizeTopics(items: readonly { topic: string | null }[]): MemoryTopicCount[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (item.topic === null) continue
    counts.set(item.topic, (counts.get(item.topic) ?? 0) + 1)
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'))
}

export function distinctTopicNames(items: readonly { topic: string | null }[]): string[] {
  return [...new Set(items.flatMap((item) => (item.topic === null ? [] : [item.topic])))]
}


export function requireRenameFrom(from: string | null): void {
  if (from !== null && normalizeTopic(from) === null) {
    throw new BadRequestError('The topic to rename is named by its text, or null for the notes with no topic.')
  }
}
