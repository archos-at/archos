import 'server-only'
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { projectShelf, type DocumentShelf } from '../shelf'
import { documentAliasKey, documentNameKey, documentNameVariants } from '../name-match'
import { FILENAME_LOOKUP_MAX_NAMES } from '../filename-lookup'
import { declaredStatusesIn, type DocumentReadFamily } from '../document-status'
import { SHELF_SUMMARY_FAILED_LIMIT, SHELF_SUMMARY_FOLDER_LIMIT, type ShelfFolderTally, type ShelfSummary } from '../shelf-summary-types'
import { documents } from '@/lib/db/schema/documents'
import { DOCUMENT_LIST_LIMIT, documentListColumns, type DocumentListRow, listingWhere, type ListProjectDocumentsOptions } from './list'
import { type ShelfReadFilters } from './levels'
import { retryAllowedSql } from './quarantine-and-retry'

export async function findShelfDocumentListRow(
  shelf: DocumentShelf,
  organizationId: string,
  documentId: string,
  filters: ShelfReadFilters,
): Promise<DocumentListRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select(documentListColumns)
      .from(documents)
      .where(and(eq(documents.id, documentId), listingWhere(shelf, organizationId, filters)))
      .limit(1),
  )
  return row ?? null
}

function familyCount(family: Exclude<DocumentReadFamily, 'reading'>): SQL<number> {
  return sql<number>`count(*) FILTER (WHERE ${inArray(sql`lower(${documents.status})`, declaredStatusesIn(family))})`
}

const ISO_MILLISECOND_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'

export async function summarizeShelfFolders(
  shelf: DocumentShelf,
  organizationId: string,
  filters: ShelfReadFilters,
): Promise<ShelfFolderTally[]> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({
        folderId: documents.folderId,
        total: sql<number>`count(*)`,
        readable: familyCount('readable'),
        failed: familyCount('failed'),
        held: familyCount('held'),
        unindexed: familyCount('unindexed'),
        latest: sql<string | null>`to_char(max(${documents.createdAt}) AT TIME ZONE 'UTC', ${ISO_MILLISECOND_FORMAT})`,
      })
      .from(documents)
      .where(listingWhere(shelf, organizationId, filters))
      .groupBy(documents.folderId)
      .limit(SHELF_SUMMARY_FOLDER_LIMIT),
  )
  return rows.map((row) => {
    const total = Number(row.total)
    const readable = Number(row.readable)
    const failed = Number(row.failed)
    const held = Number(row.held)
    const unindexed = Number(row.unindexed)
    return {
      folderId: row.folderId,
      total,
      readable,
      reading: Math.max(0, total - readable - failed - held - unindexed),
      failed,
      held,
      unindexed,
      latest: row.latest === null ? null : String(row.latest),
    }
  })
}

export async function listShelfFailedDocuments(
  shelf: DocumentShelf,
  organizationId: string,
  filters: ShelfReadFilters,
): Promise<Pick<ShelfSummary, 'failed' | 'failedTruncated'>> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ id: documents.id, folderId: documents.folderId })
      .from(documents)
      .where(
        and(
          listingWhere(shelf, organizationId, filters),
          inArray(sql`lower(${documents.status})`, declaredStatusesIn('failed')),
          retryAllowedSql(),
        ),
      )
      .orderBy(desc(documents.createdAt), asc(documents.id))
      .limit(SHELF_SUMMARY_FAILED_LIMIT + 1),
  )
  return {
    failed: rows.slice(0, SHELF_SUMMARY_FAILED_LIMIT).map((row) => ({ id: row.id, folderId: row.folderId })),
    failedTruncated: rows.length > SHELF_SUMMARY_FAILED_LIMIT,
  }
}

export function filenameLookupWhere(filenames: readonly string[]): SQL | undefined {
  const bounded = [...new Set(filenames.map(documentNameKey).filter((name) => name.length > 0))].slice(
    0,
    FILENAME_LOOKUP_MAX_NAMES,
  )
  if (bounded.length === 0) return undefined
  const exact = [...new Set(bounded.flatMap(documentNameVariants))]
  const folded = [...new Set(bounded.flatMap((name) => documentNameVariants(documentAliasKey(name))))]
  return or(inArray(documents.filename, exact), inArray(sql`lower(${documents.filename})`, folded))
}

export async function findDocumentsByFilenames(
  shelf: DocumentShelf,
  organizationId: string,
  filenames: readonly string[],
  {
    includeArchived = false,
    hiddenFolderIds,
    reader,
  }: Pick<ListProjectDocumentsOptions, 'includeArchived' | 'hiddenFolderIds' | 'reader'>,
): Promise<DocumentListRow[]> {
  const byName = filenameLookupWhere(filenames)
  if (!byName) return []
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select(documentListColumns)
      .from(documents)
      .where(and(listingWhere(shelf, organizationId, { includeArchived, hiddenFolderIds, reader }), byName))
      .orderBy(desc(documents.createdAt), asc(documents.id))
      .limit(DOCUMENT_LIST_LIMIT),
  )
}

export function findProjectDocumentsByFilenames(
  projectId: string,
  organizationId: string,
  filenames: readonly string[],
  options: Pick<ListProjectDocumentsOptions, 'includeArchived' | 'hiddenFolderIds' | 'reader'>,
): Promise<DocumentListRow[]> {
  return findDocumentsByFilenames(projectShelf(projectId), organizationId, filenames, options)
}
