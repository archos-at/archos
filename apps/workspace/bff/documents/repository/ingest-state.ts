import 'server-only'
import { and, asc, eq, getTableColumns, inArray, isNull, like, lt, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { columnStatuses, IN_FLIGHT_DOCUMENT_STATUSES } from '../document-status'
import { INTERRUPTED_REASON_PREFIX } from '../lost-job'
import { documentShelf } from '../shelf'
import { publishShelfChanged } from '../shelf-live'
import { bffJobQueue } from '@/lib/db/schema/bff-job-queue'
import { documents, type Document } from '@/lib/db/schema/documents'
import { statusAccepts, unchangedSinceDispatch, type DispatchStart } from './mutations'
import { BACKGROUND_JOB_METADATA_FIELD, type LocalWorkOwnership } from '../local-work-ownership'

export async function listSettleableDocumentsForIngestJobs(jobIds: readonly string[]): Promise<Document[]> {
  if (jobIds.length === 0) return []
  const db = getDb()
  return withPlatformAccess('settle push: finding the documents of ingest jobs that ended', () =>
    db
      .select()
      .from(documents)
      .where(
        and(
          or(
            inArray(documents.status, columnStatuses(IN_FLIGHT_DOCUMENT_STATUSES)),
            and(eq(documents.status, 'failed'), like(documents.errorMessage, `${INTERRUPTED_REASON_PREFIX}%`)),
          ),
          inArray(sql`${documents.metadata} ->> 'ingestJobId'`, [...jobIds]),
        ),
      )
      .limit(jobIds.length),
  )
}

export interface StuckProcessingDocument {
  id: string
  organizationId: string
  jobStatus: 'dead' | null
  jobId: string | null
  lastError: string | null
}

export async function listStuckProcessingDocuments(
  stranded: Date | { deadJobId: string },
  limit: number,
): Promise<StuckProcessingDocument[]> {
  const db = getDb()
  const rows = await withPlatformAccess('document sweep: finding rows left at processing without a live job', () =>
    db
      .select({
        id: documents.id,
        organizationId: documents.organizationId,
        jobStatus: bffJobQueue.status,
        jobId: bffJobQueue.jobId,
        lastError: bffJobQueue.lastError,
      })
      .from(documents)
      .leftJoin(
        bffJobQueue,
        sql`${bffJobQueue.jobId} = nullif(${documents.metadata}->>'bffJobId', '')::uuid`,
      )
      .where(
        and(
          eq(documents.status, 'processing'),
          stranded instanceof Date ? lt(documents.updatedAt, stranded) : eq(bffJobQueue.jobId, stranded.deadJobId),
          or(isNull(bffJobQueue.jobId), eq(bffJobQueue.status, 'dead')),
          sql`NOT EXISTS (SELECT 1 FROM project_folders f WHERE f.id = ${documents.folderId} AND f.deleted_at IS NOT NULL)`,
        ),
      )
      .orderBy(asc(documents.updatedAt))
      .limit(limit),
  )
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    jobStatus: row.jobStatus === 'dead' ? 'dead' : null,
    jobId: row.jobId ?? null,
    lastError: row.lastError ?? null,
  }))
}

export type { LocalWorkOwnership } from '../local-work-ownership'

export function stillOwnedBy(owned: LocalWorkOwnership): SQL | undefined {
  const named = sql`${documents.metadata} ->> ${BACKGROUND_JOB_METADATA_FIELD}::text`
  const jobId = owned.backgroundJobId
  return and(
    eq(documents.status, 'processing'),
    ...(owned.storageKey ? [eq(documents.storageKey, owned.storageKey)] : []),
    ...(jobId ? [owned.unnamedCounts ? sql`coalesce(${named}, ${jobId}) = ${jobId}` : sql`${named} = ${jobId}`] : []),
  )
}

function failureLandsOn(from: LocalWorkOwnership | DispatchStart | undefined): SQL | undefined {
  if (!from) return statusAccepts('fail')
  if ('ingestJobId' in from) return and(statusAccepts('fail'), unchangedSinceDispatch(from))
  return stillOwnedBy(from)
}

export async function markDocumentIngestFailed(
  documentId: string,
  organizationId: string,
  errorMessage: string,
  from?: LocalWorkOwnership | DispatchStart,
): Promise<boolean> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({ status: 'failed', errorMessage, ingestFailureCategory: null, ingestRetryable: null, updatedAt: new Date() })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          failureLandsOn(from),
        ),
      )
      .returning({ projectId: documents.projectId, scope: documents.scope }),
  )
  if (row) publishShelfChanged(organizationId, documentShelf(row))
  return Boolean(row)
}

export interface IngestAnnouncementFacts {
  attempt: number | null
  uploadBatchId: string | null
  fileSize: number | null
}

export async function findIngestAnnouncementFacts(
  organizationId: string,
  documentIds: string[],
): Promise<Map<string, IngestAnnouncementFacts>> {
  const facts = new Map<string, IngestAnnouncementFacts>()
  if (documentIds.length === 0) return facts
  try {
    const rows = await withTenant({ organizationId }, () =>
      getDb()
        .select({
          id: documents.id,
          attempts: documents.ingestAttempts,
          uploadBatchId: documents.uploadBatchId,
          fileSize: documents.fileSize,
        })
        .from(documents)
        .where(and(eq(documents.organizationId, organizationId), inArray(documents.id, documentIds))),
    )
    for (const row of rows) {
      facts.set(row.id, {
        attempt: row.attempts === null || row.attempts === undefined ? null : Number(row.attempts),
        uploadBatchId: row.uploadBatchId ?? null,
        fileSize: row.fileSize === null || row.fileSize === undefined ? null : Number(row.fileSize),
      })
    }
  } catch (error) {
    console.debug('[posthog] could not read ingest facts', error)
  }
  return facts
}

export async function listStalePendingDocuments(before: Date, limit: number): Promise<Document[]> {
  const db = getDb()
  return withPlatformAccess('document sweep: finding dispatched ingests nobody has read back', () =>
    db
      .select(getTableColumns(documents))
      .from(documents)
      .where(
        and(
          eq(documents.status, 'pending'),
          lt(documents.updatedAt, before),
          sql`${documents.metadata}->>'ingestJobId' IS NOT NULL`,
          sql`NOT EXISTS (SELECT 1 FROM project_folders f WHERE f.id = ${documents.folderId} AND f.deleted_at IS NOT NULL)`,
        ),
      )
      .orderBy(asc(documents.updatedAt))
      .limit(limit),
  )
}
