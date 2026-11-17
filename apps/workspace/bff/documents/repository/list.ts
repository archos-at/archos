import 'server-only'
import { and, asc, desc, eq, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { projectShelf, shelfDocumentWhere, type DocumentShelf } from '../shelf'
import { CURSOR_TIMESTAMP_FORMAT, type DocumentListCursor } from '../list-cursor'
import { documents, type DocumentAuthor, type DocumentLifecycle } from '@/lib/db/schema/documents'
import type { DocumentScope, DocumentScreeningOutcome } from '@/lib/db/schema/documents'
import { type StoredQuarantineVerdict } from '@/lib/upload-screening/quarantine'
import { documentVisibleTo, type DocumentReader } from '../visibility'
import { type IngestFailureCategory } from '../retry-policy'

export const DOCUMENT_LIST_LIMIT = 500

export interface DocumentListRow {
  id: string
  filename: string
  projectId: string | null
  scope: DocumentScope
  displayName: string | null
  fileSize: number | null
  contentType: string | null
  status: string
  authoredBy: DocumentAuthor
  publishedVersionId: string | null
  lifecycle: DocumentLifecycle
  collectionName: string
  folderId: string | null
  originPath: string | null
  contentHash: string | null
  createdBy: string
  screeningOutcome: DocumentScreeningOutcome | null
  screenedHash: string | null
  createdAt: Date
  updatedAt: Date
  errorMessage: string | null
  metadata: unknown
  ingestFailureCategory?: IngestFailureCategory | null
  ingestRetryable?: boolean | null
  ingestReaderVersion?: string | null
  quarantine?: StoredQuarantineVerdict | null
}

export interface ListProjectDocumentsOptions {
  limit?: number
  offset?: number
  authoredBy?: DocumentAuthor
  includeArchived?: boolean
  hiddenFolderIds?: readonly string[]
  reader: DocumentReader
}

export function outsideHiddenFolders(hiddenFolderIds: readonly string[] | undefined): SQL[] {
  if (!hiddenFolderIds || hiddenFolderIds.length === 0) return []
  const visible = or(isNull(documents.folderId), notInArray(documents.folderId, [...hiddenFolderIds]))
  return visible ? [visible] : []
}

export const documentListColumns = {
  id: documents.id,
  filename: documents.filename,
  projectId: documents.projectId,
  scope: documents.scope,
  displayName: documents.displayName,
  fileSize: documents.fileSize,
  contentType: documents.contentType,
  status: documents.status,
  authoredBy: documents.authoredBy,
  publishedVersionId: documents.publishedVersionId,
  lifecycle: documents.lifecycle,
  collectionName: documents.collectionName,
  folderId: documents.folderId,
  originPath: documents.originPath,
  contentHash: documents.contentHash,
  createdBy: documents.createdBy,
  screeningOutcome: documents.screeningOutcome,
  screenedHash: documents.screenedHash,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
  errorMessage: documents.errorMessage,
  quarantine: documents.quarantine,
  metadata: documents.metadata,
  ingestFailureCategory: documents.ingestFailureCategory,
  ingestRetryable: documents.ingestRetryable,
  ingestReaderVersion: documents.ingestReaderVersion,
}

export function listingWhere(
  shelf: DocumentShelf,
  organizationId: string,
  {
    authoredBy,
    includeArchived = false,
    hiddenFolderIds,
    reader,
  }: Pick<ListProjectDocumentsOptions, 'authoredBy' | 'includeArchived' | 'hiddenFolderIds' | 'reader'>,
): SQL | undefined {
  return and(
    shelfDocumentWhere(shelf, organizationId),
    ...(authoredBy ? [eq(documents.authoredBy, authoredBy)] : []),
    ...(includeArchived ? [] : [eq(documents.lifecycle, 'active')]),
    ...outsideHiddenFolders(hiddenFolderIds),
    documentVisibleTo(reader),
  )
}

export function boundListLimit(limit: number): number {
  return Math.min(Math.max(1, Math.trunc(limit)), DOCUMENT_LIST_LIMIT)
}

export async function listProjectDocuments(
  projectId: string,
  organizationId: string,
  { limit = DOCUMENT_LIST_LIMIT, offset = 0, authoredBy, includeArchived = false, hiddenFolderIds, reader }: ListProjectDocumentsOptions,
): Promise<DocumentListRow[]> {
  const boundedLimit = boundListLimit(limit)
  const boundedOffset = Math.max(0, Math.trunc(offset))
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select(documentListColumns)
      .from(documents)
      .where(listingWhere(projectShelf(projectId), organizationId, { authoredBy, includeArchived, hiddenFolderIds, reader }))
      .orderBy(desc(documents.createdAt), asc(documents.id))
      .limit(boundedLimit)
      .offset(boundedOffset),
  )
}

export interface DocumentListPage {
  rows: DocumentListRow[]
  nextCursor: DocumentListCursor | null
}

export function afterDocumentListCursor(cursor: DocumentListCursor): SQL {
  const at = sql`(${cursor.createdAt}::timestamp AT TIME ZONE 'UTC')`
  return sql`(${documents.createdAt} < ${at} OR (${documents.createdAt} = ${at} AND ${documents.id} > ${cursor.id}::uuid))`
}

export async function readDocumentListPage(
  query: (probeLimit: number) => Promise<Array<DocumentListRow & { cursorCreatedAt: string }>>,
  limit: number,
): Promise<DocumentListPage> {
  const bounded = boundListLimit(limit)
  const fetched = await query(bounded + 1)
  const hasMore = fetched.length > bounded
  const page = hasMore ? fetched.slice(0, bounded) : fetched
  const rows = page.map(({ cursorCreatedAt: _cursor, ...row }) => ({
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  }))
  const last = page.at(-1)
  return {
    rows,
    nextCursor: hasMore && last ? { createdAt: last.cursorCreatedAt, id: last.id } : null,
  }
}

export const cursorCreatedAtColumn = sql<string>`to_char(${documents.createdAt} AT TIME ZONE 'UTC', ${CURSOR_TIMESTAMP_FORMAT})`

export async function listDocumentPage(
  shelf: DocumentShelf,
  organizationId: string,
  {
    limit = DOCUMENT_LIST_LIMIT,
    cursor,
    authoredBy,
    includeArchived = false,
    hiddenFolderIds,
    reader,
  }: Omit<ListProjectDocumentsOptions, 'offset'> & { cursor?: DocumentListCursor },
): Promise<DocumentListPage> {
  const db = getDb()
  return readDocumentListPage(
    (probeLimit) =>
      withTenant({ organizationId }, () =>
        db
          .select({ ...documentListColumns, cursorCreatedAt: cursorCreatedAtColumn })
          .from(documents)
          .where(
            and(
              listingWhere(shelf, organizationId, { authoredBy, includeArchived, hiddenFolderIds, reader }),
              ...(cursor ? [afterDocumentListCursor(cursor)] : []),
            ),
          )
          .orderBy(desc(documents.createdAt), asc(documents.id))
          .limit(probeLimit),
      ),
    limit,
  )
}

export function listProjectDocumentPage(
  projectId: string,
  organizationId: string,
  options: Omit<ListProjectDocumentsOptions, 'offset'> & { cursor?: DocumentListCursor },
): Promise<DocumentListPage> {
  return listDocumentPage(projectShelf(projectId), organizationId, options)
}
