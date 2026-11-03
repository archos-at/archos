/**
 * `document_ingest_finished` for PostHog (ADR-0100): an upload came to rest.
 *
 * The server is the only place that knows. The browser sees `document_uploaded`
 * when the bytes leave; whether the file then became searchable, failed or was
 * quarantined happens minutes later in the ingest job, and is learnt by whichever
 * reconcile first settles the row (`reconcile-status.ts`): the worker's push when
 * the job ends, a read, or a sweep. That reconcile already knows which rows IT
 * moved (`moved`), so a row is announced once, by the call whose write landed,
 * exactly as it is settled once.
 *
 * Personless on purpose: the read that notices is often somebody else's page
 * load, so the actor is not the uploader, and attributing the outcome to the
 * reader would be wrong. The organization is the dimension that matters.
 *
 * Lives here and not beside `reconcile-status.ts` because `document-status.spec.ts`
 * scans `lib/documents` for every `status:` it writes, and this event's `status`
 * property is a report about the column, not a write to it.
 *
 * What is sent: the outcome, the screening verdict, the counts the backend
 * reported, the file's extension, how long it took, the document's id, its
 * upload batch, which attempt it was, the machine prefix of the failure message
 * (`error_reason`), the stored failure class (`error_category`) and which path
 * noticed (`settled_by`). Never the filename, the summary or the error text,
 * which can quote the document.
 *
 * Three durations, on purpose. `duration_ms` is dispatch to the settle that
 * noticed: what the uploader waited, the lag until somebody looked included.
 * `queue_wait_ms` and `processing_ms` are the job's own clock, submitted to
 * started and started to completed (`documents/ingest-timing.ts`): what the
 * queue and the worker spent. The gap between `duration_ms` and their sum is
 * the lag the settle push (`/api/internal/ingest/settled`) exists to remove.
 */
import { captureServer, getPosthogServer } from './posthog-server'

/**
 * Which path settled the row: `push` (the worker's call to
 * `/api/internal/ingest/settled` when the job ended), `read` (a read that
 * reconciles in passing: a listing, a detail, a filing or placement step),
 * `sweep` (the scheduler's sweeps, for the rows nobody reads). A parameter of
 * every reconcile, so the share each path settles is measured, not guessed.
 */
export type SettledBy = 'push' | 'read' | 'sweep'

export interface FinishedIngest {
  /** Our own row id, so an attempt can be joined to its document and to its retries. */
  documentId: string
  filename: string
  /** When the row was last written: the dispatch time for a row that was in flight. */
  updatedAt?: Date | string | null
  status: 'completed' | 'failed' | 'quarantined'
  /**
   * What the content gate concluded (ADR-0086), when it ran. Absent is sent as
   * `not_run`: the job carried no rules (the office's screening is off, or a
   * reviewer released the bytes), which is a different fact from `unchecked`.
   */
  screening?: string
  pageCount?: number
  chunkCount?: number
  /** Dispatches of the row so far, this one included. */
  attempt?: number | null
  /** The upload gesture (batch) that wrote the bytes. */
  uploadId?: string | null
  /** From the job's own clock: submitted to started, and started to completed. */
  queueWaitMs?: number | null
  processingMs?: number | null
  /** The row's `error_message`; only its machine prefix (`interrupted`, `unreadable_job`) is ever sent. */
  errorMessage?: string | null
  /**
   * The stored failure class (`IngestFailureCategory`: `transient`, `deterministic`, ...),
   * a closed set, when the backend gave one. Sent as `error_category`, for a `failed` row only.
   */
  failureCategory?: string | null
  retryable?: boolean | null
}

/** What `finishedIngestOf` reads of a document row, a resolution and the backend's counts. */
export const finishedIngestOf = (
  row: { id: string; filename: string; updatedAt?: Date | string | null },
  resolution: {
    status: FinishedIngest['status'] | 'pending' | 'cancelled'
    errorMessage: string | null
    screeningOutcome?: string
    failure?: { category: string | null; retryable: boolean | null }
    timing?: { queueWaitMs?: number | null; processingMs?: number | null }
  },
  meta?: { pageCount?: number; chunkCount?: number }
): FinishedIngest => ({
  documentId: row.id,
  filename: row.filename,
  updatedAt: row.updatedAt,
  status: resolution.status as FinishedIngest['status'],
  screening: resolution.screeningOutcome,
  pageCount: meta?.pageCount,
  chunkCount: meta?.chunkCount,
  errorMessage: resolution.errorMessage,
  failureCategory: resolution.failure?.category,
  retryable: resolution.failure?.retryable,
  queueWaitMs: resolution.timing?.queueWaitMs,
  processingMs: resolution.timing?.processingMs,
})

const REASON = /^([a-z][a-z0-9_]{1,40}):/

/**
 * The machine prefix of a failure message (`interrupted: ingestion stopped…` is
 * `interrupted`), `unknown` for a message without one, nothing without a message.
 * The rest of the text can quote the document, so it never leaves.
 */
export const errorReasonOf = (message: string | null | undefined): string | undefined => {
  if (!message) return undefined
  return REASON.exec(message)?.[1] ?? 'unknown'
}

/** The screening value for an ingest whose job reported none. */
export const SCREENING_NOT_RUN = 'not_run'

const EXTENSION = /^[a-z0-9]{1,8}$/

/** The lower-cased extension, or `other` for anything that is not a plain one. Never the name. */
export const fileTypeOf = (filename: string): string => {
  const dot = filename.lastIndexOf('.')
  if (dot === -1) return 'none'
  const extension = filename.slice(dot + 1).toLowerCase()
  return EXTENSION.test(extension) ? extension : 'other'
}

/**
 * Milliseconds from the row's last write to `now`. For a row that was in flight
 * that write is the dispatch (`setDocumentIngestJob`), so this is the ingest
 * duration to within one poll interval; `undefined` when the row has no usable
 * time rather than a wrong number.
 */
const durationSince = (updatedAt: Date | string | null | undefined, now: number): number | undefined => {
  if (!updatedAt) return undefined
  const written = new Date(updatedAt).getTime()
  return Number.isFinite(written) ? Math.max(0, now - written) : undefined
}

/** The error-tracking budget per reason: a bulk upload that fails 109 times is five issues' worth, the event counts the rest. */
const FAILURE_CAPTURE_BURST = 5
const FAILURE_CAPTURE_WINDOW_MS = 5 * 60_000
let failureWindows = new Map<string, { startedAt: number; count: number }>()

export const resetIngestFailureLimiterForTests = (): void => {
  failureWindows = new Map()
}

class IngestFailedError extends Error {
  override name = 'IngestFailedError'
}

/**
 * A failed ingest as an exception in PostHog error tracking, with the office and
 * the document. The worker's own exception lives in the backend's logs; this is
 * the one place that knows which office and which row it was, and a failure the
 * backend settles without an exception (a lost owner, `interrupted`) leaves
 * nothing else behind. Never throws.
 */
const captureIngestFailure = (organizationId: string, ingest: FinishedIngest, now: number): void => {
  const posthog = getPosthogServer()
  if (!posthog) return
  const reason = errorReasonOf(ingest.errorMessage) ?? 'unknown'
  const window = failureWindows.get(reason)
  if (!window || now - window.startedAt >= FAILURE_CAPTURE_WINDOW_MS) failureWindows.set(reason, { startedAt: now, count: 1 })
  else if (++window.count > FAILURE_CAPTURE_BURST) return
  try {
    posthog.captureException(new IngestFailedError(`document ingest failed: ${reason}`), undefined, {
      source: 'bff-ingest-reconcile',
      organization_id: organizationId,
      document_id: ingest.documentId,
      error_reason: reason,
      error_category: ingest.failureCategory ?? undefined,
      retryable: ingest.retryable ?? undefined,
      attempt: ingest.attempt ?? undefined,
      file_type: fileTypeOf(ingest.filename),
    })
  } catch (failure) {
    console.debug('[posthog] could not queue an ingest failure', failure)
  }
}

/** `document_ingest_started`: a dispatch the backend took (the job is queued, not yet read). Fire-and-forget. */
export function announceIngestStarted(
  organizationId: string,
  started: { documentId: string; filename: string; attempt: number | null; jobId: string }
): void {
  captureServer({
    event: 'document_ingest_started',
    distinctId: null,
    organizationId,
    properties: {
      document_id: started.documentId,
      job_id: started.jobId,
      file_type: fileTypeOf(started.filename),
      attempt: started.attempt ?? undefined,
    },
  })
}

/** Queue one event per finished row. Fire-and-forget: `captureServer` never throws. */
export function announceIngestsFinished(
  organizationId: string,
  finished: FinishedIngest[],
  settledBy: SettledBy,
  now = Date.now()
): void {
  for (const ingest of finished) {
    captureServer({
      event: 'document_ingest_finished',
      distinctId: null,
      organizationId,
      properties: {
        document_id: ingest.documentId,
        upload_id: ingest.uploadId ?? undefined,
        attempt: ingest.attempt ?? undefined,
        status: ingest.status,
        screening: ingest.screening ?? SCREENING_NOT_RUN,
        error_reason: errorReasonOf(ingest.errorMessage),
        error_category: ingest.status === 'failed' ? (ingest.failureCategory ?? undefined) : undefined,
        retryable: ingest.retryable ?? undefined,
        file_type: fileTypeOf(ingest.filename),
        page_count: ingest.pageCount,
        chunk_count: ingest.chunkCount,
        // Dispatch to the read that noticed: includes every poll gap, and days
        // when nothing read the row. The two below are the job's own clock.
        duration_ms: durationSince(ingest.updatedAt, now),
        queue_wait_ms: ingest.queueWaitMs ?? undefined,
        processing_ms: ingest.processingMs ?? undefined,
        settled_by: settledBy,
      },
    })
    if (ingest.status === 'failed') captureIngestFailure(organizationId, ingest, now)
  }
}

/** Where a stored document came from, as far as the server can tell. */
export type UploadSource = 'web' | 'mail' | 'chat'

/**
 * `document_uploaded` from the server, once per file it stored (`file_count` is 1):
 * the browser's own event is one per batch and is lost to ad blockers and closed
 * tabs, and a file that arrives by the mail import never touches a browser.
 * Filtering on `source` tells the two apart; `web_batch` is the browser's.
 */
export function announceDocumentUploaded(
  organizationId: string,
  userId: string,
  upload: { source: UploadSource; filename: string; documentId: string; uploadId?: string | null; replaced?: boolean }
): void {
  captureServer({
    event: 'document_uploaded',
    distinctId: userId,
    organizationId,
    properties: {
      source: upload.source,
      file_count: 1,
      document_id: upload.documentId,
      upload_id: upload.uploadId ?? undefined,
      file_type: fileTypeOf(upload.filename),
      replaced: upload.replaced ?? false,
    },
  })
}
