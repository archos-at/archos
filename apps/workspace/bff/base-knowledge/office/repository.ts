import 'server-only'
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { withTenant } from '@/lib/db/tenant-context'
import type { DocumentReader } from '@/lib/documents/document-reader'
import { documentVisibleTo } from '@/lib/documents/visibility'
import { knowledgeRecords } from '@/lib/db/schema/knowledge-records'

export interface EntryDocument {
  id: string
  fileName: string
  collectionName: string
  storedName: string
  folderId: string | null
}

export async function visibleOfficeDocuments(
  organizationId: string,
  ids: readonly string[],
  reader: DocumentReader
): Promise<Map<string, EntryDocument>> {
  if (ids.length === 0) return new Map()
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({
        id: documents.id,
        filename: documents.filename,
        displayName: documents.displayName,
        collectionName: documents.collectionName,
        folderId: documents.folderId,
      })
      .from(documents)
      .where(
        and(
          inArray(documents.id, [...ids]),
          eq(documents.organizationId, organizationId),
          eq(documents.scope, 'office_shelf'),
          documentVisibleTo(reader)
        )
      )
  )
  return new Map(
    rows.map((row) => [
      row.id,
      { id: row.id, fileName: row.displayName ?? row.filename, collectionName: row.collectionName, storedName: row.filename, folderId: row.folderId },
    ])
  )
}

export async function readShelfDocument(
  organizationId: string,
  documentId: string,
  reader: DocumentReader
): Promise<EntryDocument | null> {
  const [row] = await withTenant({ organizationId }, () =>
    getDb()
      .select({
        id: documents.id,
        filename: documents.filename,
        displayName: documents.displayName,
        collectionName: documents.collectionName,
        folderId: documents.folderId,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          eq(documents.scope, 'office_shelf'),
          documentVisibleTo(reader)
        )
      )
      .limit(1)
  )
  if (!row) return null
  return { id: row.id, fileName: row.displayName ?? row.filename, collectionName: row.collectionName, storedName: row.filename, folderId: row.folderId }
}

export async function listOrganizationsWithOfficeEditions(limit: number): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ organizationId: knowledgeRecords.organizationId })
    .from(knowledgeRecords)
    .where(and(isNotNull(knowledgeRecords.organizationId), eq(knowledgeRecords.type, 'edition'), isNotNull(knowledgeRecords.headRevisionId)))
    .orderBy(asc(knowledgeRecords.organizationId))
    .limit(limit)
  return rows.flatMap((row) => (row.organizationId ? [row.organizationId] : []))
}
