/**
 * The topics of the office shelf (organization-scope project memory, ADR-0180):
 * what the office list counts, and the topic a write stores on an office note.
 * The shelf's names are the open office notes' topics, as `memory-topics.ts`
 * resolves them. Office notes are never restricted (migration 0112), so every
 * active note of the shelf is one a member may see and the count is the whole shelf.
 */

import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { projectMemory } from '@/lib/db/schema/project-memory'
import { summarizeTopics, type MemoryTopicCount } from '@/lib/memory-topics/topic'
import { resolveOfficeTopicForWrite } from './memory-topics'

/**
 * The topics of the office shelf with how many active notes each holds, over
 * the whole shelf and not the page the list returns (the list's `topics`).
 */
export async function officeTopicsOf(organizationId: string): Promise<MemoryTopicCount[]> {
  const rows = await getDb()
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
  return summarizeTopics(rows)
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
  return { ...input, topic: await resolveOfficeTopicForWrite(organizationId, input.topic) }
}
