/**
 * The topics of the office shelf (organization-scope project memory, ADR-0180):
 * what the office list counts, and the topic a write stores on an office note.
 * The shelf's names are the open office notes' topics. Office notes are never
 * restricted (migration 0112), so every active note of the shelf is one a member
 * may see and the count is the whole shelf.
 *
 * `openOfficeTopicRows` is the one query both readers of the shelf's topics share:
 * the list's count here and a write's resolution (`memory-topics.ts` calls it too).
 */

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

/** The topic of every active, unrestricted office note: the rows the office shelf's topics come from. */
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

/**
 * The topics of the office shelf with how many active notes each holds, over
 * the whole shelf and not the page the list returns (the list's `topics`).
 */
export async function officeTopicsOf(organizationId: string): Promise<MemoryTopicCount[]> {
  return summarizeTopics(await openOfficeTopicRows(organizationId))
}

/**
 * A write's body with its `topic` resolved against the office shelf's topics
 * (so "brandschutz" lands in "Brandschutz"). A body that names no topic passes
 * unchanged; `null` takes the note out of its topic.
 */
export async function withOfficeTopic<T extends { topic?: string | null }>(
  organizationId: string,
  input: T
): Promise<T> {
  if (input.topic === undefined) return input
  const names = distinctTopicNames(await openOfficeTopicRows(organizationId))
  return { ...input, topic: resolveTopic(input.topic, names) }
}
