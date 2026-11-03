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
 * reported, the file's extension, how long it took, the document's id, which
 * attempt it was, the stored failure category and which path noticed
 * (`settled_by`). Never the filename, the summary or the error text, which can
 * quote the document.
 *
 * Two durations, on purpose. `duration_ms` is dispatch to the settle that
 * noticed: what the uploader waited, the lag until somebody looked included.
 * `processing_ms` is the job's own start to finish, from the status the backend
 * reported: what the worker spent. The gap between the two is the lag the
 * settle push (`/api/internal/ingest/settled`) exists to remove.
 */
import { captureServer } from './posthog-server'

/**
 * Which path settled the row: `push` (the worker's call to
 * `/api/internal/ingest/settled` when the job ended), `read` (a read that
 * reconciles in passing: a listing, a detail, a filing or placement step),
 * `sweep` (the scheduler's sweeps, for the rows nobody reads). A parameter of
 * every reconcile, so the share each path settles is measured, not guessed.
 */
export type SettledBy = 'push' | 'read' | 'sweep'

export interface FinishedIngest {
  documentId: string
  filename: string
  /** When the row was last written: the dispatch time for a row that was in flight. */
  updatedAt?: Date | string | null
  status: 'completed' | 'failed' | 'quarantined'
  /** What the content gate concluded (ADR-0086), when it ran. */
  screening?: string
  pageCount?: number
  chunkCount?: number
  /** The row's dispatch count (`documents.ingest_attempts`), when the row carries it. */
  attempt?: number | null
  /** The stored failure category (`IngestFailureCategory`, a closed set); sent for a `failed` row only. */
  failureCategory?: string | null
  /** The job's `started_at` and `completed_at`, raw, as the backend's batch status reported them. */
  jobStartedAt?: unknown
  jobCompletedAt?: unknown
}

/**
 * A backend timestamp as epoch ms, or null. The ingestor stamps naive UTC
 * (`datetime.utcnow()`), so a string without an offset is read as UTC, not as
 * this process's local time.
 */
const backendInstant = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.length === 0) return null
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`
  const ms = Date.parse(zoned)
  return Number.isFinite(ms) ? ms : null
}

/** The job's start to finish, or `undefined` when either end is missing or they are out of order. */
const processingMs = (startedAt: unknown, completedAt: unknown): number | undefined => {
  const start = backendInstant(startedAt)
  const end = backendInstant(completedAt)
  return start !== null && end !== null && end >= start ? end - start : undefined
}

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
        status: ingest.status,
        screening: ingest.screening,
        file_type: fileTypeOf(ingest.filename),
        page_count: ingest.pageCount,
        chunk_count: ingest.chunkCount,
        duration_ms: durationSince(ingest.updatedAt, now),
        document_id: ingest.documentId,
        attempt: typeof ingest.attempt === 'number' ? ingest.attempt : undefined,
        failure_category: ingest.status === 'failed' ? (ingest.failureCategory ?? undefined) : undefined,
        processing_ms: processingMs(ingest.jobStartedAt, ingest.jobCompletedAt),
        settled_by: settledBy,
      },
    })
  }
}
