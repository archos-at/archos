import 'server-only'
import type { ProjectStatus } from '@/lib/projects/project-status'
import { and, desc, eq, gte, ilike, lt, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { modernizeDocumentScope } from '@/lib/db/schema/documents'
import { ACCESS_LOG_MAX_LIMIT } from './kinds'
import { documentAccessLog, type DownloadLogKind, type DownloadLogScope, type NewDocumentAccessLogRow } from '@/lib/db/schema/document-access-log'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { projects } from '@/lib/db/schema/projects'

export type NewAccessLogEntry = Omit<NewDocumentAccessLogRow, 'id' | 'occurredAt'>

export async function insertAccessLogEntry(entry: NewAccessLogEntry): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId: entry.organizationId, userId: entry.userId }, () =>
    db.insert(documentAccessLog).values(entry)
  )
}

export interface AccessLogFilter {
  organizationId: string
  userId?: string
  documentId?: string
  documentName?: string
  from?: Date
  to?: Date
  kind?: DownloadLogKind
  readable?: ReadableFolders
}

export interface ReadableFolders {
  folderIds: readonly string[]
  recordedListReadable: boolean
}

const projectHidesSomething = (): SQL => sql`EXISTS (
  SELECT 1 FROM project_folders hiding
  JOIN projects owner ON owner.id = hiding.project_id
  WHERE hiding.project_id = ${documentAccessLog.projectId}
    AND owner.organization_id = ${documentAccessLog.organizationId}
    AND (hiding.access_mode = 'custom' OR (hiding.deleted_at IS NOT NULL AND hiding.purged_at IS NULL))
)`

function readableCondition(readable: ReadableFolders): SQL {
  const unfiled = sql`(${documentAccessLog.scope} <> 'project' OR ${documentAccessLog.projectId} IS NULL OR ${documentAccessLog.folderId} IS NULL)`
  const inReadableFolder =
    readable.folderIds.length > 0
      ? sql`${documentAccessLog.folderId} = ANY(string_to_array(${readable.folderIds.join(',')}, ',')::uuid[])`
      : sql`false`
  const goneUnderOwnList = sql`(${documentAccessLog.ownList} AND ${projectFolders.path} IS NULL)`
  const elsewhere = readable.recordedListReadable
    ? sql`NOT ${projectHidesSomething()}`
    : sql`(NOT ${projectHidesSomething()} AND NOT ${goneUnderOwnList})`
  return sql`(${unfiled} OR ${inReadableFolder} OR ${elsewhere})`
}

export interface AccessLogCursor {
  occurredAt: string
  id: string
}

export interface AccessLogRow {
  id: string
  occurredAt: Date
  cursor: AccessLogCursor
  userId: string
  kind: DownloadLogKind
  scope: DownloadLogScope
  projectId: string | null
  projectName: string | null
  projectStatus: ProjectStatus | null
  documentId: string
  documentName: string
  versionId: string | null
  folderId: string | null
  folderPath: string | null
  ownList: boolean
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

function conditions(filter: AccessLogFilter, cursor: AccessLogCursor | null): SQL[] {
  const found: SQL[] = [eq(documentAccessLog.organizationId, filter.organizationId)]
  if (filter.userId) found.push(eq(documentAccessLog.userId, filter.userId))
  if (filter.documentId) found.push(eq(documentAccessLog.documentId, filter.documentId))
  if (filter.documentName) found.push(ilike(documentAccessLog.documentName, likePattern(filter.documentName)))
  if (filter.from) found.push(gte(documentAccessLog.occurredAt, filter.from))
  if (filter.to) found.push(lt(documentAccessLog.occurredAt, filter.to))
  if (filter.kind) found.push(eq(documentAccessLog.kind, filter.kind))
  if (filter.readable) found.push(readableCondition(filter.readable))
  if (cursor) {
    found.push(sql`(${documentAccessLog.occurredAt}, ${documentAccessLog.id}) < (${cursor.occurredAt}::timestamptz, ${cursor.id}::uuid)`)
  }
  return found
}

export async function listAccessLog(
  filter: AccessLogFilter,
  cursor: AccessLogCursor | null,
  limit: number
): Promise<AccessLogRow[]> {
  const db = getDb()
  const bounded = Math.min(Math.max(1, Math.floor(limit)), ACCESS_LOG_MAX_LIMIT + 1)
  const rows = await withTenant({ organizationId: filter.organizationId }, () =>
    db
      .select({
        id: documentAccessLog.id,
        occurredAt: documentAccessLog.occurredAt,
        cursorAt: sql<string>`to_char(${documentAccessLog.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        userId: documentAccessLog.userId,
        kind: documentAccessLog.kind,
        scope: documentAccessLog.scope,
        projectId: documentAccessLog.projectId,
        projectName: projects.name,
        projectStatus: projects.status,
        documentId: documentAccessLog.documentId,
        documentName: documentAccessLog.documentName,
        versionId: documentAccessLog.versionId,
        folderId: documentAccessLog.folderId,
        folderPath: projectFolders.path,
        ownList: documentAccessLog.ownList,
      })
      .from(documentAccessLog)
      .leftJoin(
        projects,
        and(eq(projects.id, documentAccessLog.projectId), eq(projects.organizationId, documentAccessLog.organizationId))
      )
      .leftJoin(
        projectFolders,
        and(eq(projectFolders.id, documentAccessLog.folderId), eq(projectFolders.projectId, documentAccessLog.projectId))
      )
      .where(and(...conditions(filter, cursor)))
      .orderBy(desc(documentAccessLog.occurredAt), desc(documentAccessLog.id))
      .limit(bounded)
  )
  return rows.map((row) => ({
    id: row.id,
    occurredAt: new Date(row.occurredAt),
    cursor: { occurredAt: String(row.cursorAt), id: row.id },
    userId: row.userId,
    kind: row.kind,
    scope: modernizeDocumentScope(row.scope),
    projectId: row.projectId,
    projectName: row.projectName,
    projectStatus: row.projectStatus ?? null,
    documentId: row.documentId,
    documentName: row.documentName,
    versionId: row.versionId,
    folderId: row.folderId,
    folderPath: row.folderPath,
    ownList: row.ownList,
  }))
}
