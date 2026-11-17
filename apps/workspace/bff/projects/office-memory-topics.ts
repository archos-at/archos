import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { projectMemory } from '@/lib/db/schema/project-memory'
import {
  distinctTopicNames,
  resolveTopic,
  summarizeTopics,
  type MemoryTopicCount,
} from '@/lib/memory-topics/topic'

export async function openOfficeTopicRows(organizationId: string): Promise<{ topic: string | null }[]> {
  return getDb()
    .select({ topic: projectMemory.topic })
    .from(projectMemory)
    .where(
      and(
        eq(projectMemory.scope, 'organization'),
        isNull(projectMemory.projectId),
        eq(projectMemory.organizationId, organizationId),
        eq(projectMemory.status, 'active'),
        isNull(projectMemory.restrictedFolderIds)
      )
    )
}

export async function officeTopicsOf(organizationId: string): Promise<MemoryTopicCount[]> {
  return summarizeTopics(await openOfficeTopicRows(organizationId))
}

export async function withOfficeTopic<T extends { topic?: string | null }>(
  organizationId: string,
  input: T
): Promise<T> {
  if (input.topic === undefined) return input
  const names = distinctTopicNames(await openOfficeTopicRows(organizationId))
  return { ...input, topic: resolveTopic(input.topic, names) }
}
