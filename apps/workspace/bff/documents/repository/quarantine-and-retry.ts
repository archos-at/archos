import 'server-only'
import { and, asc, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { type DocumentListCursor } from '../list-cursor'
import { declaredStatusesIn } from '../document-status'
import { documents, type Document } from '@/lib/db/schema/documents'
import { heldAtRest } from '../visibility'
import { CURRENT_INGEST_READER_VERSION } from '../retry-policy'
import { cursorCreatedAtColumn } from './list'
import { dispatchedHash } from './reconcile'

export const QUARANTINE_LIST_LIMIT = 200

export interface QuarantineCursor {
  updatedAt: Date
  id: string
}

export async function listQuarantinedDocuments(
  organizationId: string,
  cursor: QuarantineCursor | null = null,
): Promise<Document[]> {
  const db = getDb()
  const after = cursor
    ? or(
        lt(documents.updatedAt, cursor.updatedAt),
        and(eq(documents.updatedAt, cursor.updatedAt), lt(documents.id, cursor.id)),
      )
    : undefined
  return withTenant({ organizationId }, () =>
    db
      .select()
      .from(documents)
      .where(and(eq(documents.organizationId, organizationId), heldAtRest(), after))
      .orderBy(desc(documents.updatedAt), desc(documents.id))
      .limit(QUARANTINE_LIST_LIMIT),
  )
}

export const FAILED_INGEST_RESCAN_STATUSES = ['failed', 'uploaded'] as const

export function retryAllowedSql(): SQL {
  const failedStatuses = sql.join(
    declaredStatusesIn('failed').map((status) => sql`${status}`),
    sql`, `,
  )
  const version = documents.ingestReaderVersion
  const readerIsNewer = sql`CASE
      WHEN ${version} IS NULL THEN true
      WHEN ${version} ~ '^[0-9]+([.][0-9]+)*$'
        THEN string_to_array(${version}, '.')::int[] < string_to_array(${CURRENT_INGEST_READER_VERSION}::text, '.')::int[]
      ELSE ${version} <> ${CURRENT_INGEST_READER_VERSION}::text
    END`
  const bytesChanged = sql`(${dispatchedHash} IS NOT NULL AND ${documents.contentHash} IS NOT NULL AND ${documents.contentHash} <> ${dispatchedHash})`
  const refused = sql`(lower(${documents.status}) IN (${failedStatuses}) AND CASE
      WHEN ${documents.ingestFailureCategory} = 'deterministic' THEN NOT (${bytesChanged} OR ${readerIsNewer})
      WHEN ${documents.ingestFailureCategory} IS NULL THEN coalesce(${documents.ingestRetryable}, true) = false
      ELSE ${documents.ingestFailureCategory} = 'quarantined'
    END)`
  return sql`NOT coalesce(${refused}, false)`
}

export const FAILED_INGEST_PAGE_LIMIT = 100

function afterFailedWalkCursor(cursor: DocumentListCursor): SQL {
  const at = sql`(${cursor.createdAt}::timestamp AT TIME ZONE 'UTC')`
  return sql`(${documents.createdAt} > ${at} OR (${documents.createdAt} = ${at} AND ${documents.id} > ${cursor.id}::uuid))`
}

export interface FailedDocumentPage {
  ids: string[]
  nextCursor: DocumentListCursor | null
}

export async function listFailedDocumentPageInOrg(
  organizationId: string,
  { limit = FAILED_INGEST_PAGE_LIMIT, cursor }: { limit?: number; cursor?: DocumentListCursor | null } = {},
): Promise<FailedDocumentPage> {
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), FAILED_INGEST_PAGE_LIMIT)
  const db = getDb()
  const fetched = await withTenant({ organizationId }, () =>
    db
      .select({ id: documents.id, cursorCreatedAt: cursorCreatedAtColumn })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          inArray(documents.status, [...FAILED_INGEST_RESCAN_STATUSES]),
          retryAllowedSql(),
          ...(cursor ? [afterFailedWalkCursor(cursor)] : []),
        ),
      )
      .orderBy(asc(documents.createdAt), asc(documents.id))
      .limit(bounded + 1),
  )
  const hasMore = fetched.length > bounded
  const page = hasMore ? fetched.slice(0, bounded) : fetched
  const last = page.at(-1)
  return {
    ids: page.map((row) => row.id),
    nextCursor: hasMore && last ? { createdAt: last.cursorCreatedAt, id: last.id } : null,
  }
}

export async function markForRescreening(
  documentId: string,
  organizationId: string,
  contentHash: string
): Promise<boolean> {
  const db = getDb()
  const updated = await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({
        status: 'uploaded',
        errorMessage: null,
        quarantine: null,
        screeningOutcome: sql`CASE WHEN ${documents.status} = 'quarantined' THEN 'quarantined' ELSE ${documents.screeningOutcome} END`,
        ingestFailureCategory: null,
        ingestRetryable: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          heldAtRest(),
          eq(documents.contentHash, contentHash)
        )
      )
      .returning({ id: documents.id })
  )
  return updated.length > 0
}
