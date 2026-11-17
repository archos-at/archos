import 'server-only'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { documents, type Document } from '@/lib/db/schema/documents'
import {
  uploadBatches,
  type NewUploadBatch,
  type UploadBatch,
  type UploadBatchEffects,
  type UploadBatchExclusion,
} from '@/lib/db/schema/upload-batches'
import { IN_FLIGHT_DOCUMENT_STATUSES, columnStatuses } from '@/lib/documents/document-status'
import { CURSOR_TIMESTAMP_FORMAT, type DocumentListCursor } from '@/lib/documents/list-cursor'
import { outsideHiddenFolders } from '@/lib/documents/repository'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'

export const UPLOAD_HISTORY_LIMIT = 50
export const UPLOAD_SUMMARY_DOCUMENT_LIMIT = 500

export async function insertUploadBatch(values: NewUploadBatch): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId: values.organizationId }, () =>
    db.insert(uploadBatches).values(values).onConflictDoNothing({ target: uploadBatches.id })
  )
}

export async function findUploadBatch(organizationId: string, batchId: string): Promise<UploadBatch | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(uploadBatches)
      .where(and(eq(uploadBatches.id, batchId), eq(uploadBatches.organizationId, organizationId)))
      .limit(1)
  )
  return row ?? null
}

function excludedPlus(entries: readonly UploadBatchExclusion[]) {
  return sql`(
    SELECT COALESCE(jsonb_agg(jsonb_build_object('term', merged.term, 'count', merged.total) ORDER BY merged.first_at), '[]'::jsonb)
    FROM (
      SELECT entry.value->>'term' AS term, SUM((entry.value->>'count')::int) AS total, MIN(entry.ordinality) AS first_at
      FROM jsonb_array_elements(${uploadBatches.excluded} || ${JSON.stringify(entries)}::jsonb) WITH ORDINALITY AS entry(value, ordinality)
      GROUP BY entry.value->>'term'
    ) AS merged
  )`
}

export async function sealUploadBatch(
  organizationId: string,
  batchId: string,
  createdBy: string,
  counts: { unchanged: number; failed: number; expected?: number; excluded?: readonly UploadBatchExclusion[] },
  sealedAt: Date
): Promise<boolean> {
  const db = getDb()
  const expected = counts.expected === undefined ? {} : { expectedCount: counts.expected }
  const excluded = counts.excluded?.length ? { excluded: excludedPlus(counts.excluded) } : {}
  const rows = await withTenant({ organizationId }, () =>
    db
      .update(uploadBatches)
      .set({ unchangedCount: counts.unchanged, failedCount: counts.failed, sealedAt, ...expected, ...excluded })
      .where(
        and(
          eq(uploadBatches.id, batchId),
          eq(uploadBatches.organizationId, organizationId),
          eq(uploadBatches.createdBy, createdBy),
          isNull(uploadBatches.sealedAt)
        )
      )
      .returning({ id: uploadBatches.id })
  )
  return rows.length > 0
}

export async function addUploadBatchExclusions(
  organizationId: string,
  batchId: string,
  createdBy: string,
  entries: readonly UploadBatchExclusion[]
): Promise<boolean> {
  if (entries.length === 0) return true
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .update(uploadBatches)
      .set({ excluded: excludedPlus(entries) })
      .where(
        and(
          eq(uploadBatches.id, batchId),
          eq(uploadBatches.organizationId, organizationId),
          eq(uploadBatches.createdBy, createdBy),
          isNull(uploadBatches.sealedAt)
        )
      )
      .returning({ id: uploadBatches.id })
  )
  return rows.length > 0
}

export async function completeSettledBatches(
  organizationId: string,
  batchIds: readonly string[],
  completedAt: Date
): Promise<UploadBatch[]> {
  if (batchIds.length === 0) return []
  const db = getDb()
  const inFlight = [...IN_FLIGHT_DOCUMENT_STATUSES]
  return withTenant({ organizationId }, () =>
    db
      .update(uploadBatches)
      .set({ completedAt })
      .where(
        and(
          inArray(uploadBatches.id, [...batchIds]),
          eq(uploadBatches.organizationId, organizationId),
          isNull(uploadBatches.completedAt),
          isNotNull(uploadBatches.sealedAt),
          sql`NOT EXISTS (
            SELECT 1 FROM ${documents}
            WHERE ${documents.uploadBatchId} = ${uploadBatches.id}
              AND ${documents.organizationId} = ${organizationId}
              AND ${documents.status} IN (${sql.join(
                inFlight.map((status) => sql`${status}`),
                sql`, `
              )})
          )`
        )
      )
      .returning()
  )
}

export async function reopenCompletedBatches(
  organizationId: string,
  batchIds: readonly string[],
  completedAt: Date
): Promise<void> {
  if (batchIds.length === 0) return
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(uploadBatches)
      .set({ completedAt: null })
      .where(
        and(
          inArray(uploadBatches.id, [...batchIds]),
          eq(uploadBatches.organizationId, organizationId),
          eq(uploadBatches.completedAt, completedAt)
        )
      )
  )
}

export async function batchIdsOfDocuments(organizationId: string, documentIds: readonly string[]): Promise<string[]> {
  if (documentIds.length === 0) return []
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .selectDistinct({ batchId: documents.uploadBatchId })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          inArray(documents.id, [...documentIds]),
          isNotNull(documents.uploadBatchId)
        )
      )
  )
  return rows.map((row) => row.batchId).filter((id): id is string => id !== null)
}

export type BatchSettleEffects = Pick<UploadBatchEffects, 'revisionNotice' | 'runsDocumentCheck'>

export async function findBatchSettleEffects(
  organizationId: string,
  batchIds: readonly string[]
): Promise<Map<string, BatchSettleEffects>> {
  if (batchIds.length === 0) return new Map()
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({
        id: uploadBatches.id,
        revisionNotice: uploadBatches.revisionNotice,
        runsDocumentCheck: uploadBatches.runsDocumentCheck,
      })
      .from(uploadBatches)
      .where(and(eq(uploadBatches.organizationId, organizationId), inArray(uploadBatches.id, [...batchIds])))
  )
  return new Map(rows.map(({ id, ...effects }) => [id, effects]))
}

export async function listBatchDocuments(
  organizationId: string,
  batchId: string,
  reader: DocumentReader
): Promise<Document[]> {
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select()
      .from(documents)
      .where(
        and(eq(documents.organizationId, organizationId), eq(documents.uploadBatchId, batchId), documentVisibleTo(reader))
      )
      .orderBy(documents.filename)
      .limit(UPLOAD_SUMMARY_DOCUMENT_LIMIT)
  )
}

export async function countBatchDocumentsByStatus(
  organizationId: string,
  batchIds: readonly string[],
  { hiddenFolderIds, reader }: { hiddenFolderIds?: readonly string[]; reader: DocumentReader }
): Promise<Array<{ batchId: string; status: string; count: number }>> {
  if (batchIds.length === 0) return []
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ batchId: documents.uploadBatchId, status: documents.status, count: sql<number>`count(*)` })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          inArray(documents.uploadBatchId, [...batchIds]),
          ...outsideHiddenFolders(hiddenFolderIds),
          documentVisibleTo(reader)
        )
      )
      .groupBy(documents.uploadBatchId, documents.status)
  )
  return rows
    .filter((row): row is typeof row & { batchId: string } => row.batchId !== null)
    .map((row) => ({ batchId: row.batchId, status: row.status, count: Number(row.count) }))
}

export interface UploadBatchPage {
  batches: UploadBatch[]
  nextCursor: DocumentListCursor | null
}

export async function listProjectUploadBatchPage(
  organizationId: string,
  projectId: string,
  { cursor }: { cursor?: DocumentListCursor } = {}
): Promise<UploadBatchPage> {
  const db = getDb()
  const at = cursor ? sql`(${cursor.createdAt}::timestamp AT TIME ZONE 'UTC')` : null
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({
        batch: uploadBatches,
        cursorCreatedAt: sql<string>`to_char(${uploadBatches.createdAt} AT TIME ZONE 'UTC', ${CURSOR_TIMESTAMP_FORMAT})`,
      })
      .from(uploadBatches)
      .where(
        and(
          eq(uploadBatches.organizationId, organizationId),
          eq(uploadBatches.projectId, projectId),
          ...(cursor && at
            ? [
                sql`(${uploadBatches.createdAt} < ${at} OR (${uploadBatches.createdAt} = ${at} AND ${uploadBatches.id} > ${cursor.id}::uuid))`,
              ]
            : [])
        )
      )
      .orderBy(desc(uploadBatches.createdAt), asc(uploadBatches.id))
      .limit(UPLOAD_HISTORY_LIMIT + 1)
  )
  const page = rows.slice(0, UPLOAD_HISTORY_LIMIT)
  const last = page.at(-1)
  return {
    batches: page.map((row) => row.batch),
    nextCursor: rows.length > UPLOAD_HISTORY_LIMIT && last ? { createdAt: last.cursorCreatedAt, id: last.batch.id } : null,
  }
}

export async function listOpenBatchesBetween(
  createdAfter: Date,
  createdBefore: Date,
  limit: number
): Promise<UploadBatch[]> {
  const db = getDb()
  return db
    .select()
    .from(uploadBatches)
    .where(
      and(
        isNull(uploadBatches.completedAt),
        lt(uploadBatches.createdAt, createdBefore),
        gt(uploadBatches.createdAt, createdAfter)
      )
    )
    .orderBy(desc(uploadBatches.createdAt))
    .limit(limit)
}

export async function latestBatchDocumentAt(organizationId: string, batchId: string): Promise<Date | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({ at: sql<Date | string | null>`max(${documents.createdAt})` })
      .from(documents)
      .where(and(eq(documents.organizationId, organizationId), eq(documents.uploadBatchId, batchId)))
  )
  return row?.at ? new Date(row.at) : null
}

export async function sealAbandonedBatch(organizationId: string, batchId: string, sealedAt: Date): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(uploadBatches)
      .set({ sealedAt })
      .where(
        and(
          eq(uploadBatches.id, batchId),
          eq(uploadBatches.organizationId, organizationId),
          isNull(uploadBatches.sealedAt)
        )
      )
  )
}

export async function listInFlightBatchDocuments(organizationId: string, batchId: string): Promise<Document[]> {
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.uploadBatchId, batchId),
          inArray(documents.status, columnStatuses(IN_FLIGHT_DOCUMENT_STATUSES))
        )
      )
      .limit(UPLOAD_SUMMARY_DOCUMENT_LIMIT)
  )
}
