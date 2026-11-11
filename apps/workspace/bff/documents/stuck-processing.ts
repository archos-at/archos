/**
 * The sweep for documents stranded at `processing` (ADR-0079).
 *
 * `processing` is the status of work the BFF itself owns: an IFC model being
 * parsed, an office file being converted, a document of a folder restored from
 * the Papierkorb waiting for its restore job. Before those became `bff_job_queue`
 * jobs, a restart mid-way left the row at `processing` with nothing behind it,
 * and the only way out was a person pressing "Erneut lesen". Two cases are still
 * left, and this is the clock behind both:
 *
 *   - **No job.** Rows written before the jobs existed, a job that could not
 *     be queued after the row was marked, and a restore's rows its job finished
 *     without reaching (the requester lost the project). They get a new job.
 *   - **A dead job.** The queue gave up after its last attempt. The row says so
 *     and waits for a person's retry; queueing a fifth attempt for work that
 *     failed four times would only spend the same minutes again.
 *
 * The run that makes a job dead fails that job's rows at once
 * ({@link failDocumentsOfDeadJob}, called from `jobs-queue/task-run.ts`), with
 * the write below, so the dead-job case here is what is left when that write
 * did not happen: the pod died between the two, or a release before it buried
 * the job.
 *
 * A row whose job is queued or running is left alone, however long it waits:
 * the listing joins on the job id the row remembers, so a backlog of thousands
 * of waiting rows never crowds the lost ones out of a batch.
 *
 * The caller is the `reconcile-background-work` Hatchet task
 * (`bff/scheduling/sweeps.ts`), every minute beside the run reconciler. Safe to run from several replicas at once and more
 * often than needed: a row it recovers is no longer stranded, and a second
 * dispatch for one object returns the job the first one queued.
 */

import 'server-only'
import { withTenant } from '@/lib/db/tenant-context'
import { INGEST_DISPATCH_FAILED_MESSAGE } from './ingest-dispatch'
import { redispatchStuckDocument } from './ingest-recovery'
import { listStuckProcessingDocuments, markDocumentIngestFailed, type StuckProcessingDocument } from './repository'

/** A row must have sat at `processing` this long before the sweep touches it. */
export const STUCK_AFTER_MINUTES = 15

/** Rows one sweep recovers. Bounded: it is housekeeping on a timer. */
export const STUCK_BATCH = 50

export interface StuckProcessingSweepResult {
  checked: number
  requeued: number
  /** Rows failed with a reason because they cannot be rebuilt or their job died. */
  failed: number
  /** Rows that were gone or had moved on by the time the sweep got to them. */
  gone: number
  /** Rows whose recovery threw; each is found again by the next sweep. */
  errors: number
}

async function recoverOne(row: StuckProcessingDocument): Promise<'requeued' | 'failed' | 'gone'> {
  if (row.jobStatus === 'dead') {
    // Only while the row still names that job: the batch is read once and
    // worked row by row, each a backend call, so a person may have read this
    // one again since.
    const failed = await markDocumentIngestFailed(row.id, row.organizationId, INGEST_DISPATCH_FAILED_MESSAGE, {
      backgroundJobId: row.jobId,
    })
    if (!failed) return 'gone'
    console.warn(`[documents] ${row.id} failed every attempt of its background job: ${row.lastError ?? 'no reason kept'}`)
    return 'failed'
  }
  return redispatchStuckDocument(row.organizationId, row.id)
}

/** Recover each row inside its own organization. Never throws for one row's failure; the counts say what happened. */
async function recoverRows(rows: StuckProcessingDocument[]): Promise<StuckProcessingSweepResult> {
  const result: StuckProcessingSweepResult = { checked: rows.length, requeued: 0, failed: 0, gone: 0, errors: 0 }
  for (const row of rows) {
    try {
      const outcome = await withTenant({ organizationId: row.organizationId }, () => recoverOne(row))
      result[outcome] += 1
    } catch (error) {
      console.error('[documents] could not recover document', row.id, 'left at processing', error)
      result.errors += 1
    }
  }
  return result
}

/** One sweep: find the stranded rows across every organization, then recover each. */
export async function recoverStuckProcessing(
  now: Date = new Date(),
  options: { staleMinutes?: number; batch?: number } = {}
): Promise<StuckProcessingSweepResult> {
  const before = new Date(now.getTime() - (options.staleMinutes ?? STUCK_AFTER_MINUTES) * 60_000)
  return recoverRows(await listStuckProcessingDocuments(before, options.batch ?? STUCK_BATCH))
}

/**
 * A job has just gone dead: fail the documents it left at `processing` now,
 * with the sweep's own listing and write, instead of after the sweep's quarter
 * of an hour. Whatever the kind: the rows are those that name the job
 * (`metadata.bffJobId`), one for an IFC extraction or an office conversion,
 * many for a folder restore or a placement re-read. One batch; a job that left
 * more has the rest failed by the sweep.
 */
export async function failDocumentsOfDeadJob(jobId: string): Promise<StuckProcessingSweepResult> {
  return recoverRows(await listStuckProcessingDocuments({ deadJobId: jobId }, STUCK_BATCH))
}
