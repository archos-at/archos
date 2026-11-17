import 'server-only'
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { DbExecutor } from '@/lib/db/executor'
import { conversationRestrictedFolders } from '@/lib/db/schema/conversation-restricted-folders'
import { conversationSourceProjects } from '@/lib/db/schema/conversation-source-projects'
import { conversations } from '@/lib/db/schema/conversations'
import { documents } from '@/lib/db/schema/documents'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { projects } from '@/lib/db/schema/projects'
import { resourceShares, type ResourceVisibility } from '@/lib/db/schema/resource-shares'
import { taskRuns } from '@/lib/db/schema/task-model'

export const RECORDED_FOLDERS_LIMIT = 200

const RECORDED_FOLDERS_BATCH_LIMIT = 5_000

const AUDIENCE_GRANT_LIMIT = 500

export async function lockConversationAudience(
  tx: DbExecutor,
  organizationId: string,
  conversationId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`conversation_audience:${organizationId}:${conversationId}`}, 0))`,
  )
}

function subjectDocumentId() {
  return sql`case
  when ${taskRuns.plan}->'subject'->>'documentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then (${taskRuns.plan}->'subject'->>'documentId')::uuid
end`
}

async function listRevisionSubjectFolders(
  executor: DbExecutor,
  organizationId: string,
  conversationIds: readonly string[],
): Promise<{ conversationId: string; folderId: string }[]> {
  if (conversationIds.length === 0) return []
  const rows = await executor
    .select({ conversationId: taskRuns.conversationId, folderId: documents.folderId })
    .from(taskRuns)
    .innerJoin(
      documents,
      and(eq(documents.organizationId, taskRuns.organizationId), sql`${documents.id} = ${subjectDocumentId()}`),
    )
    .where(
      and(
        eq(taskRuns.organizationId, organizationId),
        eq(taskRuns.kind, 'revision'),
        inArray(taskRuns.conversationId, [...conversationIds]),
        isNotNull(documents.folderId),
      ),
    )
    .limit(RECORDED_FOLDERS_BATCH_LIMIT)
  return rows.flatMap((row) =>
    row.conversationId && row.folderId ? [{ conversationId: String(row.conversationId), folderId: String(row.folderId) }] : [],
  )
}

export async function listRecordedSourceFolders(
  executor: DbExecutor,
  organizationId: string,
  conversationId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ folderId: conversationRestrictedFolders.folderId })
    .from(conversationRestrictedFolders)
    .where(
      and(
        eq(conversationRestrictedFolders.organizationId, organizationId),
        eq(conversationRestrictedFolders.conversationId, conversationId),
      ),
    )
    .orderBy(conversationRestrictedFolders.folderId)
    .limit(RECORDED_FOLDERS_LIMIT)
  const subjects = await listRevisionSubjectFolders(executor, organizationId, [conversationId])
  return [...new Set([...rows.map((row) => String(row.folderId)), ...subjects.map((row) => row.folderId)])]
    .sort()
    .slice(0, RECORDED_FOLDERS_LIMIT)
}

export async function listRecordedSourceFoldersFor(
  executor: DbExecutor,
  organizationId: string,
  conversationIds: readonly string[],
): Promise<Map<string, string[]>> {
  const recorded = new Map<string, string[]>()
  if (conversationIds.length === 0) return recorded
  const rows = await executor
    .select({
      conversationId: conversationRestrictedFolders.conversationId,
      folderId: conversationRestrictedFolders.folderId,
    })
    .from(conversationRestrictedFolders)
    .where(
      and(
        eq(conversationRestrictedFolders.organizationId, organizationId),
        inArray(conversationRestrictedFolders.conversationId, [...conversationIds]),
      ),
    )
    .limit(RECORDED_FOLDERS_BATCH_LIMIT)
  const subjects = await listRevisionSubjectFolders(executor, organizationId, conversationIds)
  for (const row of [...rows, ...subjects]) {
    const folders = recorded.get(String(row.conversationId)) ?? []
    if (!folders.includes(String(row.folderId))) folders.push(String(row.folderId))
    recorded.set(String(row.conversationId), folders)
  }
  return recorded
}

export async function recordSourceFolders(
  executor: DbExecutor,
  organizationId: string,
  conversationId: string,
  folderIds: readonly string[],
): Promise<void> {
  if (folderIds.length === 0) return
  await executor
    .insert(conversationRestrictedFolders)
    .values(folderIds.map((folderId) => ({ organizationId, conversationId, folderId })))
    .onConflictDoUpdate({
      target: [
        conversationRestrictedFolders.organizationId,
        conversationRestrictedFolders.conversationId,
        conversationRestrictedFolders.folderId,
      ],
      set: { lastAt: sql`now()` },
    })
}

export async function markAnswerRestrictedUse(
  executor: DbExecutor,
  organizationId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  await executor.execute(sql`
    INSERT INTO message_restricted_use (organization_id, message_id, conversation_id)
    SELECT ${organizationId}, ${messageId}, ${conversationId}
    WHERE conversation_restricted_use(${organizationId}, ${conversationId})
    ON CONFLICT DO NOTHING`)
}

export async function deleteRecordedSourceFolders(
  executor: DbExecutor,
  organizationId: string,
  conversationId: string,
): Promise<void> {
  await executor
    .delete(conversationRestrictedFolders)
    .where(
      and(
        eq(conversationRestrictedFolders.organizationId, organizationId),
        eq(conversationRestrictedFolders.conversationId, conversationId),
      ),
    )
}

export const RECORDED_PROJECTS_LIMIT = 200

function stillRestricts() {
  return sql<boolean>`NOT EXISTS (
    SELECT 1 FROM ${projects}
    WHERE ${projects.id} = ${conversationSourceProjects.projectId}
      AND ${projects.organizationId} = ${conversationSourceProjects.organizationId}
      AND ${projects.status} = 'closed'
      AND ${projects.deletedAt} IS NULL
  )`
}

export async function listRestrictingSourceProjects(
  executor: DbExecutor,
  organizationId: string,
  conversationId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ projectId: conversationSourceProjects.projectId })
    .from(conversationSourceProjects)
    .where(
      and(
        eq(conversationSourceProjects.organizationId, organizationId),
        eq(conversationSourceProjects.conversationId, conversationId),
        stillRestricts(),
      ),
    )
    .orderBy(conversationSourceProjects.projectId)
    .limit(RECORDED_PROJECTS_LIMIT)
  return rows.map((row) => String(row.projectId))
}

export async function listProjectNames(
  executor: DbExecutor,
  organizationId: string,
  projectIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (projectIds.length === 0) return names
  const rows = await executor
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        inArray(projects.id, [...projectIds]),
        isNull(projects.deletedAt),
      ),
    )
    .limit(RECORDED_PROJECTS_LIMIT)
  for (const row of rows) names.set(String(row.id), String(row.name))
  return names
}

export async function listRestrictingSourceProjectsFor(
  executor: DbExecutor,
  organizationId: string,
  conversationIds: readonly string[],
): Promise<Map<string, string[]>> {
  const recorded = new Map<string, string[]>()
  if (conversationIds.length === 0) return recorded
  const rows = await executor
    .select({
      conversationId: conversationSourceProjects.conversationId,
      projectId: conversationSourceProjects.projectId,
    })
    .from(conversationSourceProjects)
    .where(
      and(
        eq(conversationSourceProjects.organizationId, organizationId),
        inArray(conversationSourceProjects.conversationId, [...conversationIds]),
        stillRestricts(),
      ),
    )
    .limit(RECORDED_FOLDERS_BATCH_LIMIT)
  for (const row of rows) {
    const found = recorded.get(String(row.conversationId)) ?? []
    found.push(String(row.projectId))
    recorded.set(String(row.conversationId), found)
  }
  return recorded
}

export async function recordSourceProjects(
  executor: DbExecutor,
  organizationId: string,
  conversationId: string,
  projectIds: readonly string[],
): Promise<void> {
  if (projectIds.length === 0) return
  await executor
    .insert(conversationSourceProjects)
    .values(projectIds.map((projectId) => ({ organizationId, conversationId, projectId })))
    .onConflictDoUpdate({
      target: [
        conversationSourceProjects.organizationId,
        conversationSourceProjects.conversationId,
        conversationSourceProjects.projectId,
      ],
      set: { lastAt: sql`now()` },
    })
}

export async function projectsOfFolders(
  executor: DbExecutor,
  organizationId: string,
  folderIds: readonly string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  if (folderIds.length === 0) return found
  const rows = await executor
    .select({ id: projectFolders.id, projectId: projectFolders.projectId })
    .from(projectFolders)
    .where(and(eq(projectFolders.organizationId, organizationId), inArray(projectFolders.id, [...folderIds])))
    .limit(RECORDED_FOLDERS_BATCH_LIMIT)
  for (const row of rows) if (row.projectId) found.set(String(row.id), String(row.projectId))
  return found
}

export interface ConversationAudienceRow {
  exists: boolean
  projectId: string | null
  createdBy: string | null
  visibility: ResourceVisibility
  grantees: string[]
}

export async function readConversationAudience(
  executor: DbExecutor,
  organizationId: string,
  conversationId: string,
): Promise<ConversationAudienceRow> {
  const [row] = await executor
    .select({
      projectId: conversations.projectId,
      createdBy: conversations.createdBy,
      visibility: conversations.visibility,
    })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1)
  const grants = await executor
    .select({ subjectUserId: resourceShares.subjectUserId })
    .from(resourceShares)
    .where(
      and(
        eq(resourceShares.organizationId, organizationId),
        eq(resourceShares.resourceType, 'conversation'),
        eq(resourceShares.resourceId, conversationId),
      ),
    )
    .limit(AUDIENCE_GRANT_LIMIT)
  return {
    exists: row !== undefined,
    projectId: row?.projectId ?? null,
    createdBy: row?.createdBy ?? null,
    visibility: row?.visibility ?? 'private',
    grantees: [...new Set(grants.map((grant) => String(grant.subjectUserId)))],
  }
}
