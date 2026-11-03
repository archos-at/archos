/**
 * `POST /v1/documents/status/batch` takes at most this many job ids and answers
 * a longer list with a 422 (`BATCH_STATUS_MAX_IDS` in the backend's
 * `routes/documents_jobs.py`; `status-batch-contract.spec.ts` pins the pair).
 *
 * A reader that sent every in-flight job in one call took that 422 for an
 * unreachable backend and left every row alone: a bulk upload of more than
 * this many documents stayed `pending` for good, whatever its jobs had done.
 */
import type { JobClock } from './ingest-timing'

export const BATCH_STATUS_MAX_IDS = 200

/**
 * Ask for `ids` in calls of at most {@link BATCH_STATUS_MAX_IDS}, and merge the answers.
 * `null` when any call could not be answered: the caller then leaves its rows
 * alone for the round, as it did when this was one call.
 */
export async function fetchInChunks<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => Promise<Record<string, T> | null>
): Promise<Map<string, T> | null> {
  const merged = new Map<string, T>()
  for (let start = 0; start < ids.length; start += BATCH_STATUS_MAX_IDS) {
    const chunk = ids.slice(start, start + BATCH_STATUS_MAX_IDS)
    const answered = await fetchChunk(chunk)
    if (answered === null) {
      console.warn(`[reconcile] job status lookup failed for ${chunk.length} of ${ids.length} job(s); rows left as they are`)
      return null
    }
    for (const [id, status] of Object.entries(answered)) merged.set(id, status)
  }
  return merged
}

/** One file of a job, as the batch status endpoint reports it (`FileProgress`). */
export interface BackendJobFile {
  status?: string
  error_message?: string | null
  /** The content gate's per-file outcome (ADR-0086), null when the job carried no rules. */
  screening?: string | null
  /**
   * Why the gate held the file (`FileProgress.quarantine`, ADR-0113), null on
   * every other file and absent from a job written before the field. Parsed at
   * this boundary by `storedQuarantineVerdictOf`, never trusted as typed.
   */
  quarantine?: unknown
  /** Why it failed (`ingest_failures.py`), and whether the same bytes may read again; null unless FAILED. */
  failure_category?: string | null
  retryable?: boolean | null
}

/**
 * One job, as the batch status endpoint reports it (`IngestionJobStatus.model_dump`).
 * Its clock (`JobClock`) is parsed by `timingOf` for `document_ingest_finished`.
 */
export interface BackendJobStatus extends JobClock {
  status?: string
  error_message?: string | null
  /** `queue_ahead`: the backend's count for a job still in the durable queue. */
  metadata?: { queue_ahead?: unknown } | null
  /** The reader that ran the job (`INGEST_READER_VERSION`); null until a worker started it. */
  reader_version?: string | null
  file_details?: BackendJobFile[]
}
