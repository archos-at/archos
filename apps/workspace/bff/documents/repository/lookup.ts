import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { withTenant } from '@/lib/db/tenant-context'
import { documents, type Document } from '@/lib/db/schema/documents'
import type { ResourceVisibility } from '@/lib/db/schema/resource-shares'
import { documentVisibleTo, SCREENED_ONLY, type DocumentReader } from '../visibility'
import { outsideHiddenFolders } from './list'

export async function findDocumentTenancy(
  documentId: string,
): Promise<Pick<
  Document,
  'organizationId' | 'projectId' | 'folderId' | 'visibility' | 'createdBy' | 'filename' | 'displayName'
> | null> {
  const db = getDb()
  const [row] = await db
    .select({
      organizationId: documents.organizationId,
      projectId: documents.projectId,
      folderId: documents.folderId,
      visibility: documents.visibility,
      createdBy: documents.createdBy,
      filename: documents.filename,
      displayName: documents.displayName,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), documentVisibleTo(SCREENED_ONLY)))
    .limit(1)
  return row ?? null
}

export async function updateDocumentVisibilityInOrg(
  documentId: string,
  organizationId: string,
  visibility: ResourceVisibility,
  executor?: DbExecutor,
): Promise<Document | null> {
  const write = (handle: DbExecutor) =>
    handle
      .update(documents)
      .set({ visibility, updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
      .returning()
  const [row] = executor ? await write(executor) : await withTenant({ organizationId }, () => write(getDb()))
  return row ?? null
}

export async function listDocumentIdsForProject(
  projectId: string,
  organizationId: string,
  limit = 5_000,
): Promise<string[]> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.projectId, projectId), eq(documents.organizationId, organizationId)))
      .limit(limit),
  )
  return rows.map((row) => row.id)
}

const READ_FAILED_STATUSES = ['failed'] as const

export async function listUnreadableProjectDocuments(
  projectId: string,
  organizationId: string,
  hiddenFolderIds: readonly string[],
  limit: number,
): Promise<{ filename: string; displayName: string | null; folderId: string | null }[]> {
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select({ filename: documents.filename, displayName: documents.displayName, folderId: documents.folderId })
      .from(documents)
      .where(
        and(
          eq(documents.projectId, projectId),
          eq(documents.organizationId, organizationId),
          eq(documents.lifecycle, 'active'),
          inArray(documents.status, [...READ_FAILED_STATUSES]),
          ...outsideHiddenFolders(hiddenFolderIds),
          documentVisibleTo(SCREENED_ONLY),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(limit),
  )
}

export async function documentIdsExisting(ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const db = getDb()
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(inArray(documents.id, [...ids]))
  return new Set(rows.map((row) => row.id))
}

export async function findDocumentInOrg(
  documentId: string,
  organizationId: string,
  reader: DocumentReader,
): Promise<Document | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(documents)
      .where(
        and(eq(documents.id, documentId), eq(documents.organizationId, organizationId), documentVisibleTo(reader)),
      )
      .limit(1),
  )
  return row ?? null
}
