/**
 * The Archiv documents base-knowledge entries describe (ADR-0158): which of
 * them the reader may see, under which name, and what the ingest read of one.
 * Every read of `documents` states its reader (`documentVisibleTo`, ADR-0086):
 * a held upload stays out of the list and out of the turn until it is screened.
 */

import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { documentSearchFacets } from '@/lib/db/schema/document-search'
import { withTenant } from '@/lib/db/tenant-context'
import type { DocumentReader } from '@/lib/documents/document-reader'
import { documentVisibleTo } from '@/lib/documents/visibility'
import type { DocumentReading } from './reading'

export interface EntryDocument {
  id: string
  fileName: string
  collectionName: string
  /** The name the backend holds its chunks under. */
  storedName: string
}

/** The Archiv documents among `ids` the reader may see, by id. */
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
      { id: row.id, fileName: row.displayName ?? row.filename, collectionName: row.collectionName, storedName: row.filename },
    ])
  )
}

/** What the ingest read of one Archiv document (its search projection), or only its name before that. */
export async function readDocumentReading(
  organizationId: string,
  documentId: string,
  reader: DocumentReader
): Promise<(DocumentReading & { document: EntryDocument }) | null> {
  const [row] = await withTenant({ organizationId }, () =>
    getDb()
      .select({
        id: documents.id,
        filename: documents.filename,
        displayName: documents.displayName,
        collectionName: documents.collectionName,
        title: documentSearchFacets.title,
        summary: documentSearchFacets.summary,
        documentType: documentSearchFacets.documentType,
        federalState: documentSearchFacets.federalState,
      })
      .from(documents)
      .leftJoin(documentSearchFacets, eq(documentSearchFacets.documentId, documents.id))
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
  const fileName = row.displayName ?? row.filename
  return {
    fileName,
    title: row.title,
    summary: row.summary,
    documentType: row.documentType,
    federalState: row.federalState,
    document: { id: row.id, fileName, collectionName: row.collectionName, storedName: row.filename },
  }
}
