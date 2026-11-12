/**
 * The topics of a project's memory shelf (ADR-0180, migration 0237): what the
 * shelf's list counts, the names a write resolves a topic against, and the bulk
 * rename. The access checks and the folder clearance are the caller's
 * (`service.ts`); here the clearance arrives as `readable`, the folders the
 * reader may read now, as `memoryVisibleTo` takes them.
 *
 * Restricted notes (ADR-0087) are the subtle part. A topic a restricted note
 * holds is shown only to readers cleared for that note, and a write never
 * offers it to an open note: otherwise an open note would carry the name of a
 * restricted one into the view of everybody the note is open to.
 */

import 'server-only'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { projectMemory } from '@/lib/db/schema/project-memory'
import { resolveTopic, summarizeTopics, type MemoryTopicCount } from '@/lib/memory-topics/topic'
import { listProjectMemory, memoryVisibleTo, resolveProjectOrganization } from './memory-service'

/** The distinct topics of the rows, each once. */
function namesOf(topics: readonly (string | null)[]): string[] {
  return [...new Set(topics.flatMap((topic) => (topic === null ? [] : [topic])))]
}

/**
 * The topic of every project note the reader may see on the shelf: the rows the
 * list shows by default (project scope, active, the folders `readable` clears).
 * Only the topic column is read; the rows are counted in TypeScript.
 */
async function shelfTopicRows(
  projectId: string,
  organizationId: string,
  readable: readonly string[]
): Promise<{ topic: string | null }[]> {
  return getDb()
    .select({ topic: projectMemory.topic })
    .from(projectMemory)
    .where(
      and(
        eq(projectMemory.scope, 'project'),
        eq(projectMemory.projectId, projectId),
        eq(projectMemory.organizationId, organizationId),
        eq(projectMemory.status, 'active'),
        memoryVisibleTo(readable)
      )
    )
}

/** The topics a reader sees on the shelf, with how many of the notes each holds. */
export async function projectTopicsOf(
  projectId: string,
  organizationId: string,
  readable: readonly string[]
): Promise<MemoryTopicCount[]> {
  return summarizeTopics(await shelfTopicRows(projectId, organizationId, readable))
}

/** A topic a write stores, resolved against the open notes' topics (see the file's note on restricted notes). */
export async function resolveProjectTopicForWrite(
  projectId: string,
  organizationId: string,
  raw: unknown
): Promise<string | null> {
  return resolveTopic(raw, namesOf((await shelfTopicRows(projectId, organizationId, [])).map((row) => row.topic)))
}

/**
 * The agent's write (`POST /api/internal/memory`) names its project, not its
 * tenant: the project's own organization resolves the topic.
 */
export async function resolveTopicForAgentProjectWrite(projectId: string, raw: unknown): Promise<string | null> {
  const organizationId = await resolveProjectOrganization(projectId)
  if (!organizationId) return resolveTopic(raw, [])
  return resolveProjectTopicForWrite(projectId, organizationId, raw)
}

/**
 * Move every project note the reader can see and edit on topic `from` to topic
 * `to` (null is no topic on either side). The notes are collected through the
 * shelf's own list path, as the reader sees it, archived ones included, and
 * updated by id under the same visibility rule; organization notes are not on
 * this shelf and are never touched. A `to` the open notes already have (any
 * case) merges into it; a `from` is matched as the reader's view names it.
 * Answers how many notes moved.
 */
export async function renameProjectShelfTopic(input: {
  projectId: string
  organizationId: string
  readable: readonly string[]
  from: string | null
  to: string | null
}): Promise<{ moved: number }> {
  const { projectId, organizationId, readable } = input
  const visible = (
    await listProjectMemory(projectId, { organizationId, includeArchived: true, readableFolderIds: readable })
  ).filter((item) => item.scope === 'project')
  const from = resolveTopic(input.from, namesOf(visible.map((item) => item.topic)))
  const openNames = namesOf(visible.filter((item) => !item.restrictedFolderIds?.length).map((item) => item.topic))
  const to = resolveTopic(input.to, openNames.filter((name) => name !== from))
  const ids = visible.filter((item) => (item.topic ?? null) === from).map((item) => item.id)
  if (ids.length === 0) return { moved: 0 }
  const moved = await getDb()
    .update(projectMemory)
    .set({ topic: to })
    .where(
      and(
        inArray(projectMemory.id, ids),
        eq(projectMemory.scope, 'project'),
        eq(projectMemory.projectId, projectId),
        eq(projectMemory.organizationId, organizationId),
        memoryVisibleTo(readable)
      )
    )
    .returning({ id: projectMemory.id })
  return { moved: moved.length }
}

/**
 * A topic an agent files an organization note under, resolved against the open
 * office notes' topics: the same rule as a project shelf's, on the office shelf.
 */
export async function resolveOfficeTopicForWrite(organizationId: string, raw: unknown): Promise<string | null> {
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
  return resolveTopic(raw, namesOf(rows.map((row) => row.topic)))
}
