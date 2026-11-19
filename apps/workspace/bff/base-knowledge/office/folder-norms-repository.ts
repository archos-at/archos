import 'server-only'
import { and, asc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { knowledgeRecords } from '@/lib/db/schema/knowledge-records'
import { officeShelfNormKeeps } from '@/lib/db/schema/office-shelf-references'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { withTenant } from '@/lib/db/tenant-context'
import type { DocumentReader } from '@/lib/documents/document-reader'
import { documentVisibleTo } from '@/lib/documents/visibility'
import { STANDARDS_FOLDER_NAME } from '@/lib/office-shelf/standards-folder'

export interface FolderFile {
  id: string
  fileName: string
  folderId: string
}

export async function listUndecidedFolderFiles(
  organizationId: string,
  reader: DocumentReader,
  { folderId, limit }: { folderId: string; limit: number },
): Promise<FolderFile[]> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ id: documents.id, filename: documents.filename, displayName: documents.displayName, folderId: projectFolders.id })
      .from(documents)
      .innerJoin(projectFolders, eq(projectFolders.id, documents.folderId))
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.scope, 'office_shelf'),
          eq(documents.lifecycle, 'active'),
          eq(projectFolders.organizationId, organizationId),
          eq(projectFolders.scope, 'office_shelf'),
          isNull(projectFolders.deletedAt),
          sql`${projectFolders.path} <> ${STANDARDS_FOLDER_NAME}`,
          sql`${projectFolders.path} NOT LIKE ${`${STANDARDS_FOLDER_NAME}/%`}`,
          eq(documents.folderId, folderId),
          notExists(db.select({ one: sql`1` }).from(knowledgeRecords).where(and(eq(knowledgeRecords.documentId, documents.id), isNull(knowledgeRecords.unlistedAt)))),
          notExists(db.select({ one: sql`1` }).from(officeShelfNormKeeps).where(eq(officeShelfNormKeeps.documentId, documents.id))),
          documentVisibleTo(reader),
        ),
      )
      .orderBy(asc(documents.id))
      .limit(limit),
  )
  return rows.map((row) => ({ id: row.id, fileName: row.displayName ?? row.filename, folderId: row.folderId }))
}

export async function keepAsOrdinaryFiles(organizationId: string, documentIds: readonly string[], keptBy: string): Promise<void> {
  if (documentIds.length === 0) return
  await withTenant({ organizationId }, () =>
    getDb()
      .insert(officeShelfNormKeeps)
      .values(documentIds.map((documentId) => ({ documentId, organizationId, keptBy })))
      .onConflictDoNothing(),
  )
}

export async function keptAsOrdinaryFiles(organizationId: string, documentIds: readonly string[], reader: DocumentReader): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set()
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ documentId: officeShelfNormKeeps.documentId })
      .from(officeShelfNormKeeps)
      .innerJoin(documents, eq(documents.id, officeShelfNormKeeps.documentId))
      .where(
        and(
          eq(officeShelfNormKeeps.organizationId, organizationId),
          eq(documents.organizationId, organizationId),
          inArray(officeShelfNormKeeps.documentId, [...documentIds]),
          documentVisibleTo(reader),
        ),
      ),
  )
  return new Set(rows.map((row) => row.documentId))
}
