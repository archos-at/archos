import 'server-only'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { projectMemory } from '@/lib/db/schema/project-memory'
import {
  distinctTopicNames,
  requireRenameFrom,
  resolveTopic,
  summarizeTopics,
  type MemoryTopicCount,
} from '@/lib/memory-topics/topic'
import { listProjectMemory, memoryVisibleTo, resolveProjectOrganization } from './memory-service'
import { openOfficeTopicRows } from './office-memory-topics'

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
        or(
          and(eq(projectMemory.scope, 'project'), eq(projectMemory.projectId, projectId)),
          and(eq(projectMemory.scope, 'organization'), isNull(projectMemory.projectId))
        ),
        eq(projectMemory.organizationId, organizationId),
        eq(projectMemory.status, 'active'),
        memoryVisibleTo(readable)
      )
    )
}

export async function projectTopicsOf(
  projectId: string,
  organizationId: string,
  readable: readonly string[]
): Promise<MemoryTopicCount[]> {
  return summarizeTopics(await shelfTopicRows(projectId, organizationId, readable))
}

export async function isRestrictedShelfNote(
  projectId: string,
  organizationId: string,
  itemId: string,
  readable: readonly string[]
): Promise<boolean> {
  const rows = await getDb()
    .select({ restrictedFolderIds: projectMemory.restrictedFolderIds })
    .from(projectMemory)
    .where(
      and(
        eq(projectMemory.id, itemId),
        eq(projectMemory.projectId, projectId),
        eq(projectMemory.organizationId, organizationId),
        memoryVisibleTo(readable)
      )
    )
  return (rows[0]?.restrictedFolderIds?.length ?? 0) > 0
}

export async function resolveProjectTopicForWrite(
  projectId: string,
  organizationId: string,
  raw: unknown,
  readable: readonly string[] = []
): Promise<string | null> {
  const rows = await shelfTopicRows(projectId, organizationId, readable)
  return resolveTopic(raw, distinctTopicNames(rows))
}

export async function resolveTopicForAgentProjectWrite(projectId: string, raw: unknown): Promise<string | null> {
  const organizationId = await resolveProjectOrganization(projectId)
  if (!organizationId) return resolveTopic(raw, [])
  return resolveProjectTopicForWrite(projectId, organizationId, raw)
}

export async function renameProjectShelfTopic(input: {
  projectId: string
  organizationId: string
  readable: readonly string[]
  from: string | null
  to: string | null
}): Promise<{ moved: number }> {
  requireRenameFrom(input.from)
  const { projectId, organizationId, readable } = input
  const visible = (
    await listProjectMemory(projectId, { organizationId, includeArchived: true, readableFolderIds: readable })
  ).filter((item) => item.scope === 'project')
  const from = resolveTopic(input.from, distinctTopicNames(visible))
  const openNames = distinctTopicNames(await shelfTopicRows(projectId, organizationId, []))
  const to = resolveTopic(input.to, openNames.filter((name) => name !== from))
  if (to === from) return { moved: 0 }
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

export async function resolveOfficeTopicForWrite(organizationId: string, raw: unknown): Promise<string | null> {
  return resolveTopic(raw, distinctTopicNames(await openOfficeTopicRows(organizationId)))
}
