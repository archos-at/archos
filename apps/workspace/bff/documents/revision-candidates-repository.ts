import 'server-only'
import { and, asc, desc, eq, ilike, or } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { documents } from '@/lib/db/schema/documents'
import { likeContains } from '@/lib/text/like-pattern'
import { shelfDocumentWhere, type DocumentShelf } from './shelf'
import { documentVisibleTo, type DocumentReader } from './visibility'
import { outsideHiddenFolders } from './repository'
import type { AuthoredDocumentRow } from './collection-file-ref'

export const REVISION_SERIES_ROW_LIMIT = 1000

export interface RevisionSeriesRow extends AuthoredDocumentRow {
  id: string
  displayName: string | null
  folderId: string | null
  createdAt: Date | null
}

export async function findRevisionSeriesRows(
  shelf: DocumentShelf,
  organizationId: string,
  words: readonly string[],
  { hiddenFolderIds, reader }: { hiddenFolderIds?: readonly string[]; reader: DocumentReader },
): Promise<RevisionSeriesRow[]> {
  if (words.length === 0) return []
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({
        id: documents.id,
        filename: documents.filename,
        displayName: documents.displayName,
        folderId: documents.folderId,
        createdAt: documents.createdAt,
        collectionName: documents.collectionName,
        authoredBy: documents.authoredBy,
        authoredByProducer: documents.authoredByProducer,
        publishedVersionId: documents.publishedVersionId,
      })
      .from(documents)
      .where(
        and(
          shelfDocumentWhere(shelf, organizationId),
          ...outsideHiddenFolders(hiddenFolderIds),
          documentVisibleTo(reader),
          eq(documents.authoredBy, 'user'),
          eq(documents.lifecycle, 'active'),
          or(...words.map((word) => ilike(documents.filename, likeContains(word)))),
        ),
      )
      .orderBy(desc(documents.createdAt), asc(documents.id))
      .limit(REVISION_SERIES_ROW_LIMIT),
  )
  return rows.map((row) => ({ ...row, createdAt: row.createdAt ? new Date(row.createdAt) : null }))
}
