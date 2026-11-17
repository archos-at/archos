import { sql, type SQL } from 'drizzle-orm'
import { projectMemory } from '@/lib/db/schema/project-memory'

export function restatedTopicSet(topic: string | null | undefined): { topic?: SQL<string> } {
  return topic ? { topic: sql<string>`coalesce(${projectMemory.topic}, ${topic})` } : {}
}
