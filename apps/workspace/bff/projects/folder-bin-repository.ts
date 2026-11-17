import 'server-only'
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { executeRows } from '@/lib/db/execute-rows'
import { withTenant } from '@/lib/db/tenant-context'
import { DELETION_LIFECYCLE } from '@/lib/db/schema/deletion-queue'
import { documents, type Document } from '@/lib/db/schema/documents'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { projects } from '@/lib/db/schema/projects'
import { statusesAccepting } from '@/lib/documents/reading-lifecycle'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'

export * from './folder-bin-queue'

export async function listDocumentIdsInFolders(tx: DbExecutor, projectId: string, folderIds: readonly string[]): Promise<string[]> {
  if (folderIds.length === 0) return []
  const rows = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), inArray(documents.folderId, [...folderIds])))
  return rows.map((row) => row.id)
}

export async function takeBinLock(tx: DbExecutor, projectId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(folder_bin_lock_key(${projectId}::uuid))`)
}

export type BinFolderRow = Pick<
  typeof projectFolders.$inferSelect,
  'id' | 'parentId' | 'name' | 'path' | 'accessMode' | 'deletedAt' | 'deletedBy' | 'binRootId' | 'purgedAt'
> & { projectId: string }

type StoredBinFolderRow = Omit<BinFolderRow, 'projectId'> & { projectId: string | null }

function asProjectFolder(row: StoredBinFolderRow | undefined): BinFolderRow | null {
  if (!row || row.projectId === null) return null
  return { ...row, projectId: row.projectId }
}

const binFolderColumns = {
  id: projectFolders.id,
  projectId: projectFolders.projectId,
  parentId: projectFolders.parentId,
  name: projectFolders.name,
  path: projectFolders.path,
  accessMode: projectFolders.accessMode,
  deletedAt: projectFolders.deletedAt,
  deletedBy: projectFolders.deletedBy,
  binRootId: projectFolders.binRootId,
  purgedAt: projectFolders.purgedAt,
}

export async function findFolderInOrg(
  executor: DbExecutor,
  organizationId: string,
  projectId: string,
  folderId: string
): Promise<BinFolderRow | null> {
  const [row] = await executor
    .select(binFolderColumns)
    .from(projectFolders)
    .innerJoin(projects, eq(projects.id, projectFolders.projectId))
    .where(
      and(
        eq(projectFolders.id, folderId),
        eq(projectFolders.projectId, projectId),
        eq(projectFolders.organizationId, organizationId),
        eq(projectFolders.scope, 'project'),
        eq(projects.organizationId, organizationId)
      )
    )
    .limit(1)
  return asProjectFolder(row)
}

export async function findFolderByIdInOrg(
  executor: DbExecutor,
  organizationId: string,
  folderId: string
): Promise<BinFolderRow | null> {
  const [row] = await executor
    .select(binFolderColumns)
    .from(projectFolders)
    .innerJoin(projects, eq(projects.id, projectFolders.projectId))
    .where(
      and(
        eq(projectFolders.id, folderId),
        eq(projectFolders.organizationId, organizationId),
        eq(projectFolders.scope, 'project'),
        eq(projects.organizationId, organizationId)
      )
    )
    .limit(1)
  return asProjectFolder(row)
}

export async function listEntryFolderIds(executor: DbExecutor, root: BinFolderRow): Promise<string[]> {
  if (root.binRootId !== root.id) return [root.id]
  const rows = await executor
    .select({ id: projectFolders.id })
    .from(projectFolders)
    .where(and(eq(projectFolders.projectId, root.projectId), eq(projectFolders.binRootId, root.id)))
    .limit(10_000)
  return rows.map((row) => row.id)
}

export async function listLivingSubtree(executor: DbExecutor, projectId: string, rootId: string): Promise<string[]> {
  const rows = executeRows<{ id: string }>(
    await executor.execute(sql`
      WITH RECURSIVE subtree AS (
        SELECT f.id FROM project_folders f
        WHERE f.id = ${rootId}::uuid AND f.project_id = ${projectId}::uuid AND f.deleted_at IS NULL
        UNION
        SELECT c.id FROM project_folders c JOIN subtree s ON c.parent_id = s.id
        WHERE c.deleted_at IS NULL
      )
      SELECT id FROM subtree
    `)
  )
  return rows.map((row) => String(row.id))
}

export async function markFoldersBinned(
  tx: DbExecutor,
  projectId: string,
  folderIds: readonly string[],
  rootId: string,
  deletedBy: string,
  at: Date
): Promise<void> {
  if (folderIds.length === 0) return
  await tx
    .update(projectFolders)
    .set({ deletedAt: at, deletedBy, binRootId: rootId, updatedAt: at })
    .where(
      and(eq(projectFolders.projectId, projectId), inArray(projectFolders.id, [...folderIds]), isNull(projectFolders.deletedAt))
    )
}

export async function unbinFolders(tx: DbExecutor, projectId: string, rootId: string, at: Date): Promise<string[]> {
  const rows = await tx
    .update(projectFolders)
    .set({ deletedAt: null, deletedBy: null, binRootId: null, updatedAt: at })
    .where(and(eq(projectFolders.projectId, projectId), eq(projectFolders.binRootId, rootId), isNull(projectFolders.purgedAt)))
    .returning({ id: projectFolders.id })
  return rows.map((row) => row.id)
}

export async function markDocumentsRestoring(
  tx: DbExecutor,
  organizationId: string,
  projectId: string,
  folderIds: readonly string[],
  jobId: string,
  at: Date
): Promise<number> {
  if (folderIds.length === 0) return 0
  const rows = await tx
    .update(documents)
    .set({
      status: 'processing',
      errorMessage: null,
      metadata: sql`(coalesce(${documents.metadata}, '{}'::jsonb) - 'ingestJobId') || ${JSON.stringify({ bffJobId: jobId })}::text::jsonb`,
      updatedAt: at,
    })
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.projectId, projectId),
        inArray(documents.folderId, [...folderIds]),
        inArray(documents.status, statusesAccepting('process')),
        or(eq(documents.authoredBy, 'user'), isNotNull(documents.publishedVersionId))
      )
    )
    .returning({ id: documents.id })
  return rows.length
}

export async function listRestoringDocumentPage(
  organizationId: string,
  projectId: string,
  jobId: string,
  afterId: string | null,
  limit: number
): Promise<Document[]> {
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select({ document: documents })
      .from(documents)
      .innerJoin(projectFolders, eq(projectFolders.id, documents.folderId))
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.projectId, projectId),
          eq(documents.status, 'processing'),
          sql`${documents.metadata}->>'bffJobId' = ${jobId}`,
          isNull(projectFolders.deletedAt),
          ...(afterId ? [gt(documents.id, afterId)] : [])
        )
      )
      .orderBy(asc(documents.id))
      .limit(limit)
  ).then((rows) => rows.map((row) => row.document))
}

export async function rehomeFolder(
  tx: DbExecutor,
  projectId: string,
  folderId: string,
  parentId: string | null,
  oldPath: string,
  newPath: string,
  at: Date
): Promise<void> {
  await tx
    .update(projectFolders)
    .set({ parentId, path: newPath, updatedAt: at })
    .where(and(eq(projectFolders.id, folderId), eq(projectFolders.projectId, projectId)))
  if (oldPath === newPath) return
  const escaped = oldPath.replace(/([\\%_])/g, '\\$1')
  await tx.execute(sql`
    UPDATE project_folders
    SET path = ${newPath} || substring(path from ${oldPath.length + 1}), updated_at = ${at.toISOString()}::timestamptz
    WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL AND path LIKE ${`${escaped}/%`}
  `)
}

export async function markFoldersPurged(
  executor: DbExecutor,
  projectId: string,
  rootId: string,
  at: Date
): Promise<number> {
  const rows = await executor
    .update(projectFolders)
    .set({ purgedAt: at, updatedAt: at })
    .where(and(eq(projectFolders.projectId, projectId), eq(projectFolders.binRootId, rootId), isNull(projectFolders.purgedAt)))
    .returning({ id: projectFolders.id })
  return rows.length
}

const DOCUMENT_PAGE = 500

export async function listDocumentsInFolders(
  organizationId: string,
  projectId: string,
  folderIds: readonly string[]
): Promise<Document[]> {
  const found: Document[] = []
  let afterId: string | null = null
  for (;;) {
    const page: Document[] = await listDocumentPageInFolders(organizationId, projectId, folderIds, afterId, DOCUMENT_PAGE)
    found.push(...page)
    if (page.length < DOCUMENT_PAGE) return found
    afterId = page[page.length - 1].id
  }
}

export async function listDocumentPageInFolders(
  organizationId: string,
  projectId: string,
  folderIds: readonly string[],
  afterId: string | null,
  limit: number
): Promise<Document[]> {
  if (folderIds.length === 0) return []
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.projectId, projectId),
          inArray(documents.folderId, [...folderIds]),
          ...(afterId ? [gt(documents.id, afterId)] : [])
        )
      )
      .orderBy(asc(documents.id))
      .limit(limit)
  )
}

export async function setDocumentCollection(organizationId: string, documentId: string, collectionName: string): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({ collectionName, updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
  )
}

export interface BinEntryRow {
  folderId: string
  name: string
  path: string
  deletedAt: Date
  deletedBy: string | null
  purgeAfter: Date
  status: string
  documents: number
  folders: number
  document: { id: string; name: string } | null
}

const LIVE_STATUS_LIST = `(${DELETION_LIFECYCLE.liveStates.map((status) => `'${status}'`).join(', ')})`

const BIN_CURSOR_TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US'

export interface BinEntryCursor {
  deletedAt: string
  folderId: string
}

export interface BinEntryPage {
  rows: BinEntryRow[]
  nextCursor: BinEntryCursor | null
}

export async function listBinEntries(
  organizationId: string,
  projectId: string,
  reader: DocumentReader,
  page: { limit: number; cursor?: BinEntryCursor }
): Promise<BinEntryPage> {
  const db = getDb()
  const visible = documentVisibleTo(reader) ?? sql`true`
  const after = page.cursor
    ? sql`AND (f.deleted_at, f.id) < ((${page.cursor.deletedAt}::timestamp AT TIME ZONE 'UTC'), ${page.cursor.folderId}::uuid)`
    : sql``
  const rows = await withTenant({ organizationId }, () =>
    db.execute(sql`
      SELECT f.id AS folder_id, f.name, f.path, f.deleted_at, f.deleted_by,
             to_char(f.deleted_at AT TIME ZONE 'UTC', ${BIN_CURSOR_TIMESTAMP_FORMAT}) AS deleted_cursor,
             q.purge_after, q.status, q.payload->>'documentId' AS document_id,
             (SELECT coalesce(${documents.displayName}, ${documents.filename}) FROM ${documents}
               WHERE ${documents.organizationId} = ${organizationId}
                 AND ${documents.id}::text = q.payload->>'documentId'
                 AND ${visible}) AS document_name,
             (SELECT count(*) FROM project_folders s
               WHERE s.bin_root_id = f.id AND s.purged_at IS NULL) AS folders,
             (SELECT count(*) FROM ${documents}
               WHERE ${documents.organizationId} = ${organizationId}
                 AND ${documents.folderId} IN (SELECT s.id FROM project_folders s WHERE s.bin_root_id = f.id)
                 AND ${visible}) AS documents
      FROM project_folders f
      JOIN projects p ON p.id = f.project_id AND p.organization_id = ${organizationId}
      JOIN deletion_queue q
        ON q.entity_type = 'folder' AND q.entity_id = f.id::text
       AND q.organization_id = ${organizationId}
       AND q.status IN ${sql.raw(LIVE_STATUS_LIST)}
      WHERE f.project_id = ${projectId}::uuid
        AND f.bin_root_id = f.id
        AND f.deleted_at IS NOT NULL
        AND f.purged_at IS NULL
        ${after}
      ORDER BY f.deleted_at DESC, f.id DESC
      LIMIT ${page.limit + 1}
    `)
  )
  const all = executeRows<Record<string, unknown>>(rows)
  const more = all.length > page.limit
  const kept = more ? all.slice(0, page.limit) : all
  const last = kept.at(-1)
  return {
    rows: kept.map((row) => ({
      folderId: String(row.folder_id),
      name: String(row.name),
      path: String(row.path),
      deletedAt: new Date(String(row.deleted_at)),
      deletedBy: row.deleted_by === null ? null : String(row.deleted_by),
      purgeAfter: new Date(String(row.purge_after)),
      status: String(row.status),
      documents: Number(row.documents),
      folders: Number(row.folders),
      document:
        row.document_id && row.document_name !== null && row.document_name !== undefined
          ? { id: String(row.document_id), name: String(row.document_name) }
          : null,
    })),
    nextCursor: more && last ? { deletedAt: String(last.deleted_cursor), folderId: String(last.folder_id) } : null,
  }
}

export async function findLivingFolder(tx: DbExecutor, projectId: string, folderId: string): Promise<BinFolderRow | null> {
  const [row] = await tx
    .select(binFolderColumns)
    .from(projectFolders)
    .where(and(eq(projectFolders.id, folderId), eq(projectFolders.projectId, projectId), isNull(projectFolders.deletedAt)))
    .limit(1)
  return asProjectFolder(row)
}
