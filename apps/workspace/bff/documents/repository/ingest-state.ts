/** Stuck, transient, failed and just-finished ingest documents. */

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

/**
 * The documents the ingest jobs `jobIds` can still settle, in every
 * organization: the settle push (`/api/internal/ingest/settled`) names jobs,
 * not documents or tenants. In flight, or `failed` as `interrupted:` (a verdict
 * about a job whose owner went silent, which the job's own end overrules,
 * `lost-job.ts`). Discovery only, under platform access; the caller reconciles
 * each row inside its own organization. A job id no row carries finds nothing,
 * and a row that came to rest any other way is not found, so a second push for
 * the same job changes nothing. Bounded by the ids: one dispatch records one
 * job id on one row (`setDocumentIngestJob`).
 */
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

/** A document left at `processing` with no live job behind it. */
export interface StuckProcessingDocument {
  id: string
  organizationId: string
  /** `dead` when its job failed every attempt, `null` when it has none (a row from before jobs, or a lost enqueue). */
  jobStatus: 'dead' | null
  /** The dead job the row names, so a failure is written only while the row still names it. */
  jobId: string | null
  lastError: string | null
}

/**
 * Documents at `processing` since before `stranded` whose job is gone or dead,
 * oldest first. Platform scope by nature: the caller is a sweep over every
 * organization, and acts on each row inside its own.
 *
 * A row whose job is still `queued` or `claimed` is left out in the query, so
 * the batch is always rows that need something done. So is a row in a folder
 * that went to the Papierkorb (ADR-0088): it is hidden and its chunks were
 * purged, and restoring the folder marks it `processing` for the restore's
 * job again; a job queued for it here would only parse or convert a document
 * nobody may see. Once restored, a row that job never reached (it died, or its
 * requester lost access) is found here like any other.
 *
 * `{ deadJobId }` in place of the date asks for one dead job's rows however
 * briefly they have waited: what the job's own run fails the moment it gives
 * up (`failDocumentsOfDeadJob`), the same rows the sweep would reach later.
 */
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

/**
 * `localWorkOwnsRow` (`../local-work-ownership`) as SQL: the predicate
 * `jobStillOwnsRow` asks before the work, as the write's own WHERE after it.
 * `local-work-ownership.integration.spec.ts` holds the two to the same answer.
 */
export function stillOwnedBy(owned: LocalWorkOwnership): SQL | undefined {
  const named = sql`${documents.metadata} ->> ${BACKGROUND_JOB_METADATA_FIELD}::text`
  const jobId = owned.backgroundJobId
  return and(
    eq(documents.status, 'processing'),
    ...(owned.storageKey ? [eq(documents.storageKey, owned.storageKey)] : []),
    // Without `unnamedCounts` a row that names no job compares NULL, which is no match.
    ...(jobId ? [owned.unnamedCounts ? sql`coalesce(${named}, ${jobId}) = ${jobId}` : sql`${named} = ${jobId}`] : []),
  )
}

/** The rows a failure may land on, by who reports it: local work, a dispatch, or a caller that has just read the row. */
function failureLandsOn(from: LocalWorkOwnership | DispatchStart | undefined): SQL | undefined {
  if (!from) return statusAccepts('fail')
  if ('ingestJobId' in from) return and(statusAccepts('fail'), unchangedSinceDispatch(from))
  return stillOwnedBy(from)
}

/**
 * Persist an ingestion failure so status reads tell the truth. Without this a
 * document whose ingest dispatch never started would sit at 'uploaded' — which
 * the UI renders as a green "Ready" — forever (reconciliation only revisits
 * in-flight statuses, and there is no job id to reconcile against).
 *
 * A failure the BFF records itself (the dispatch did not start, the office
 * conversion or the IFC parse failed) carries no backend category, so it
 * clears the last one (migration 0134): a dispatch that never reached the
 * backend says nothing about the bytes, and an earlier `deterministic` left
 * standing would refuse the retry this failure deserves.
 *
 * A caller that starts a read says so of the row as it is, whatever its state:
 * a re-read that could not start fails a `completed` row, and that is the
 * truth about the attempt. A caller reporting on work that began EARLIER (a
 * queue job, the sweep over rows a dead job left behind) passes `owned`, and
 * the write lands only while that work still owns the row. Without it a job on
 * its last attempt failed a row a person had archived or re-read meanwhile:
 * the document read `failed` although its bytes were indexed, or the job for
 * its new bytes found the row no longer `processing` and left without reading
 * them.
 *
 * A dispatch reports late too: the backend may take twenty seconds to not
 * answer, and by then a second dispatch may have put the row in flight under
 * its own job, or a re-upload replaced the bytes. It passes what it read of
 * the row before it asked ({@link DispatchStart}), and its failure lands only
 * on the row as it found it. Without that the row read `failed` beside a live
 * job, and nothing asked about it again: the settle push and the sweeps select
 * rows in flight. A row with nothing newer on it takes the failure as before,
 * whatever its state. Returns whether the row took the failure.
 */
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
  // The one door every hard failure goes through (a dispatch refused, an IFC
  // extraction that failed, a row stuck in processing): the badge turns red
  // for everyone reading the shelf, not only for a tab that happens to poll it.
  if (row) publishShelfChanged(organizationId, documentShelf(row))
  return Boolean(row)
}

/** What `document_ingest_finished` says about a row beyond the reconcile's own view. */
export interface IngestAnnouncementFacts {
  /** Dispatches of the row so far (`ingest_attempts`); null on a row from before the column. */
  attempt: number | null
  /** The upload gesture that wrote the bytes, or null. */
  uploadBatchId: string | null
  /** The stored file's size in bytes, or null: what an ingest's cost is divided by for cost per byte. */
  fileSize: number | null
}

/**
 * The attempt count and upload batch of the rows a read just settled, by id.
 * Fail-open: analytics must not fail a status read, so a failed read answers with no facts.
 */
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

/**
 * Documents the backend took (`pending`, with a job id) and nobody has asked about
 * since `before`, oldest first, across every organization. The backend writes no
 * result into Postgres; the worker's settle push (`../settle-push`) asks the reconcile
 * to look when a job ends, and it is best effort. A row whose push was lost, whose
 * office closed the tab and which no open upload batch names would stay `pending`
 * until somebody next read its shelf: hours, or days, before this sweep.
 * The caller reconciles each row inside its own organization.
 */
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
