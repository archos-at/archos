/** Document writes: deletion, display name and ingest or processing state. */

import 'server-only'
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { documents } from '@/lib/db/schema/documents'
import { FILING_CHOICE_METADATA_KEY } from '../filing-choice-key'
import { statusesAccepting, type DocumentReadingEvent } from '../reading-lifecycle'
import { sameDispatch } from './reconcile'

/**
 * Hard-delete a project document row (the DB record; SeaweedFS + backend
 * cleanup live in the service). Scoped by `organizationId` AND `projectId` so a
 * document id from another tenant or project can never be deleted through this
 * path — tenancy and project ownership are both enforced in SQL.
 */
export async function deleteProjectDocument(
  documentId: string,
  organizationId: string,
  projectId: string,
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .delete(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          eq(documents.projectId, projectId),
        ),
      ),
  )
}

/**
 * Persist a rename.
 *
 * Writes `display_name` and nothing else — `filename` is the join key to the
 * stored object and to the document's chunks in the retrieval index, so a
 * rename must not touch it (migration 0048 has the full reasoning). `null`
 * clears the rename, restoring the file's own name.
 *
 * Scoped by organization alone, deliberately: this serves both a project
 * document and an org-wide Archiv document (which has no project), and the
 * caller has already established which of the two access rules applies —
 * `getAccessibleDocument` in the service is where project FGA vs
 * `org:office_shelf:manage` is decided.
 */
export async function setDocumentDisplayName(
  documentId: string,
  organizationId: string,
  displayName: string | null,
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({ displayName, updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId))),
  )
}

/**
 * The rows a write of `event` may land on, read from the declared lifecycle
 * (`../reading-lifecycle`, ADR-0179).
 *
 * For every writer below that is each state but `quarantined`: a row the
 * content gate quarantined keeps its status through every write but a
 * reviewer's release (`markScreeningReleased`) and a delete (ADR-0086). A
 * dispatch, a local conversion or a failure does not clear a held state: a new
 * screening produces a new verdict, written by the reconcile, never a reset to
 * `pending` that the next reader takes for an ordinary upload. Migration
 * 0122's trigger refuses any other write that tries.
 */
export const statusAccepts = (event: DocumentReadingEvent): SQL => inArray(documents.status, statusesAccepting(event))

/**
 * What a dispatch read on the row before it asked the backend: the ingest job
 * the row answered to (or none), and the bytes it held.
 */
export interface DispatchStart {
  ingestJobId: string | null
  storageKey: string | null
}

/**
 * The row is as the dispatch found it: no later dispatch has given it a job,
 * no later round of local work has dropped the one it had, and no re-upload has
 * replaced its bytes. The backend may answer a dispatch ten or twenty seconds
 * after it was asked (`BACKEND_FETCH_TIMEOUT_MS`, twice), and what the
 * dispatch then writes, its job or its failure, is about the row it read. A
 * compare-and-set like the reconcile's (`sameDispatch`), with the storage key
 * beside it because new bytes carry no job until their own dispatch answers.
 * `dispatch-failure-race.integration.spec.ts` runs the interleavings.
 */
export const unchangedSinceDispatch = (start: DispatchStart): SQL | undefined =>
  and(
    sameDispatch(start.ingestJobId),
    start.storageKey === null ? isNull(documents.storageKey) : eq(documents.storageKey, start.storageKey),
  )

/**
 * Persist the backend ingest job id so status reads can reconcile the row
 * with the backend's ingestion state (see lib/documents/reconcile-status.ts).
 * Returns whether the row took it: a quarantined row does not
 * ({@link statusAccepts}), and neither does a row that moved on while the
 * backend was answering ({@link unchangedSinceDispatch}).
 *
 * Beside the job id, the digest of the bytes this job reads
 * (`ingestContentHash`): the verdict it brings back is about those bytes, and
 * the reconcile writes it to `screened_hash` from here (migration 0123), not
 * from whatever the row holds when the verdict lands. And the filing choice
 * the dispatch carried, which is about those same bytes.
 */
export async function setDocumentIngestJob(
  documentId: string,
  organizationId: string,
  ingestJobId: string,
  /**
   * What the person filing these bytes chose (`filingChoiceRecord`), kept so a
   * reviewer's release of a held file still carries it (`../filing-choice`).
   * Null records none, and a dispatch without one drops the last.
   */
  filingChoice: Record<string, unknown> | null = null,
  /**
   * The row as the dispatch read it. With it, a job the backend gave late does
   * not replace the job of a newer dispatch or take the row from a read of new
   * bytes ({@link unchangedSinceDispatch}). Without it (the read failed) the
   * lifecycle alone decides.
   */
  start?: DispatchStart,
): Promise<boolean> {
  const db = getDb()
  const moved = await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({
        status: 'pending',
        metadata: sql`jsonb_strip_nulls(jsonb_build_object('ingestJobId', ${ingestJobId}::text, 'ingestContentHash', ${documents.contentHash}, ${FILING_CHOICE_METADATA_KEY}::text, ${filingChoice === null ? null : JSON.stringify(filingChoice)}::jsonb))`,
        // A new attempt: the previous one's failure no longer describes the
        // row, and the job's own verdict replaces it when it ends (migration
        // 0134). The reader version stays until then: it is the last reader
        // that read the row, which is still true.
        ingestFailureCategory: null,
        ingestRetryable: null,
        ingestAttempts: sql`coalesce(${documents.ingestAttempts}, 0) + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          statusAccepts('dispatch'),
          start ? unchangedSinceDispatch(start) : undefined,
        ),
      )
      .returning({ id: documents.id }),
  )
  return moved.length > 0
}

/**
 * Say that the row's bytes are deliberately not in the index: an archived
 * document, whose chunks `archiveDocument` purged, and a re-upload onto one,
 * which `dispatchDocument` does not send. `stored` is the status for "the bytes
 * are here and nothing reads them", which is what the row now is; leaving it
 * `completed` showed a document Piloti can no longer cite as „Zitierbar“.
 *
 * A held row keeps `quarantined`: the hold is what keeps it from every reader
 * but its uploader and the reviewers (ADR-0086), and archiving it decides
 * nothing about its content.
 */
export async function markDocumentNotIndexed(documentId: string, organizationId: string): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({ status: 'stored', updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId), statusAccepts('unindex'))),
  )
}

/**
 * The `documents.metadata` key of a row placement purged and re-pointed whose
 * re-read into its new collection is the `placement_reingest` job's to do
 * (`lib/projects/collection-placement.ts`, ADR-0087). Only ever set beside
 * `status = 'processing'`; the job removes it when it takes the row, and every
 * other writer of `processing` or of an ingest job id drops it.
 */
export const PLACEMENT_REINGEST_MARKER = 'placementReingest'

/**
 * Mark a document as being worked on locally, before any backend job exists.
 *
 * The IFC path needs this: extraction happens in THIS process and can take
 * tens of seconds, during which there is no ingest job to reconcile against.
 * Leaving the row at 'uploaded' would render a green "Ready" for a model that
 * cannot be opened yet. 'processing' is an in-flight status, and reconciliation
 * leaves a `processing` row alone, so the status survives until extraction
 * sets a real one.
 *
 * The previous ingest job id is dropped here. A retried or re-ingested document
 * still carried it, and every reader that consults the job (the reconcile and
 * the re-ingest heal) then answered with the OLD job's outcome — a retry of a
 * failed file flipped back to failed while its new conversion was running.
 * Clearing it at the one writer of `processing` fixes both readers at once.
 * The queue job of the previous round goes with it ({@link setDocumentBackgroundJob}),
 * and so does the placement mark ({@link PLACEMENT_REINGEST_MARKER}): a row this
 * marks is owned by the work that marked it, not waiting for placement's job.
 */
export async function markDocumentProcessing(
  documentId: string,
  organizationId: string,
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({
        status: 'processing',
        errorMessage: null,
        metadata: sql`coalesce(${documents.metadata}, '{}'::jsonb) - 'ingestJobId' - 'bffJobId' - ${PLACEMENT_REINGEST_MARKER}::text`,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId), statusAccepts('process'))),
  )
}

/**
 * Remember which `bff_job_queue` job is working on a document that sits at
 * `processing` (IFC extraction, office conversion).
 *
 * The sweep that recovers stranded rows ({@link listStuckProcessingDocuments})
 * joins on this id: a row whose job is queued or running is waiting its turn,
 * not lost, and without the id telling the two apart a backlog of thousands of
 * waiting rows would crowd the lost ones out of every sweep's batch. The id
 * leaves with the status: `setDocumentIngestJob` replaces the metadata when the
 * dispatch succeeds, and `markDocumentProcessing` drops it for the next round.
 */
export async function setDocumentBackgroundJob(
  documentId: string,
  organizationId: string,
  jobId: string,
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({ metadata: sql`coalesce(${documents.metadata}, '{}'::jsonb) || ${JSON.stringify({ bffJobId: jobId })}::text::jsonb` })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          eq(documents.status, 'processing'),
        ),
      ),
  )
}
