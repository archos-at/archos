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
import { withTenant } from '@/lib/db/tenant-context'
import type { DocumentReader } from '@/lib/documents/document-reader'
import { documentVisibleTo } from '@/lib/documents/visibility'
import { knowledgeRecords } from '@/lib/db/schema/knowledge-records'

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

/**
 * One Archiv document as an entry names it, or null when the reader may not see
 * it. Its name only: a proposal reads nothing the ingest wrote about the text
 * (ADR-0158), since the copy may turn out to be licensed.
 */
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
  return { id: row.id, fileName: row.displayName ?? row.filename, collectionName: row.collectionName, storedName: row.filename }
}

/**
 * Whether an Archiv document stored under `filename` (the upload's name key) is
 * already a base-knowledge copy: the base-knowledge upload asks before it writes
 * any bytes, since an upload under an existing name replaces that document's
 * file in place.
 */
export async function shelfNameHasEntry(organizationId: string, filename: string, reader: DocumentReader): Promise<boolean> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ id: documents.id })
      .from(documents)
      .innerJoin(knowledgeRecords, eq(knowledgeRecords.documentId, documents.id))
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.scope, 'office_shelf'),
          eq(documents.filename, filename),
          documentVisibleTo(reader)
        )
      )
      .limit(1)
  )
  return rows.length > 0
}
