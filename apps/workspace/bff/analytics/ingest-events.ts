import { INGEST_STAGES, type IngestReading, type IngestTiming } from '@/lib/documents/ingest-timing'
import { SCREENING_DETECTORS } from '@/lib/upload-screening/policy'
import { captureServer, getPosthogServer } from './posthog-server'

export type SettledBy = 'push' | 'read' | 'sweep'

export interface FinishedIngest {
  documentId: string
  filename: string
  updatedAt?: Date | string | null
  status: 'completed' | 'failed' | 'quarantined'
  screening?: string
  pageCount?: number
  chunkCount?: number
  attempt?: number | null
  uploadId?: string | null
  fileBytes?: number | null
  queueWaitMs?: number | null
  processingMs?: number | null
  stageSeconds?: IngestTiming['stageSeconds']
  reading?: IngestReading
  errorMessage?: string | null
  failureCategory?: string | null
  retryable?: boolean | null
  quarantine?: { reasons: ReadonlyArray<{ kind: string }> } | null
}

export const finishedIngestOf = (
  row: { id: string; filename: string; updatedAt?: Date | string | null },
  resolution: {
    status: FinishedIngest['status'] | 'pending' | 'cancelled'
    errorMessage: string | null
    screeningOutcome?: string
    failure?: { category: string | null; retryable: boolean | null }
    timing?: Partial<IngestTiming>
    quarantine?: FinishedIngest['quarantine']
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
  stageSeconds: resolution.timing?.stageSeconds,
  reading: resolution.timing?.reading,
  quarantine: resolution.quarantine,
})

const stageProperties = (stageSeconds: IngestTiming['stageSeconds']): Record<string, number> =>
  Object.fromEntries(
    INGEST_STAGES.flatMap((stage) => {
      const seconds = stageSeconds?.[stage]
      return seconds === undefined ? [] : [[`${stage}_s`, seconds]]
    })
  )

const REASON = /^([a-z][a-z0-9_]{1,40}):/

export const errorReasonOf = (message: string | null | undefined): string | undefined => {
  if (!message) return undefined
  return REASON.exec(message)?.[1] ?? 'unknown'
}

export const SCREENING_NOT_RUN = 'not_run'

const HOLD_KINDS: ReadonlySet<string> = new Set(['term', ...SCREENING_DETECTORS])

export const holdKindsOf = (verdict: FinishedIngest['quarantine']): string => {
  const kinds = new Set((verdict?.reasons ?? []).map(({ kind }) => (HOLD_KINDS.has(kind) ? kind : 'other')))
  return kinds.size === 0 ? 'unknown' : [...kinds].sort().join(',')
}

const EXTENSION = /^[a-z0-9]{1,8}$/

export const fileTypeOf = (filename: string): string => {
  const dot = filename.lastIndexOf('.')
  if (dot === -1) return 'none'
  const extension = filename.slice(dot + 1).toLowerCase()
  return EXTENSION.test(extension) ? extension : 'other'
}

const durationSince = (updatedAt: Date | string | null | undefined, now: number): number | undefined => {
  if (!updatedAt) return undefined
  const written = new Date(updatedAt).getTime()
  return Number.isFinite(written) ? Math.max(0, now - written) : undefined
}

const FAILURE_CAPTURE_BURST = 5
const FAILURE_CAPTURE_WINDOW_MS = 5 * 60_000
let failureWindows = new Map<string, { startedAt: number; count: number }>()

export const resetIngestFailureLimiterForTests = (): void => {
  failureWindows = new Map()
}

class IngestFailedError extends Error {
  override name = 'IngestFailedError'
}

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
        file_bytes: ingest.fileBytes ?? undefined,
        attempt: ingest.attempt ?? undefined,
        status: ingest.status,
        screening: ingest.screening ?? SCREENING_NOT_RUN,
        hold_kinds: ingest.status === 'quarantined' ? holdKindsOf(ingest.quarantine) : undefined,
        error_reason: errorReasonOf(ingest.errorMessage),
        error_category: ingest.status === 'failed' ? (ingest.failureCategory ?? undefined) : undefined,
        retryable: ingest.retryable ?? undefined,
        file_type: fileTypeOf(ingest.filename),
        page_count: ingest.pageCount ?? ingest.reading?.pages,
        chunk_count: ingest.chunkCount,
        duration_ms: durationSince(ingest.updatedAt, now),
        queue_wait_ms: ingest.queueWaitMs ?? undefined,
        processing_ms: ingest.processingMs ?? undefined,
        ...stageProperties(ingest.stageSeconds),
        pages_fully_read: ingest.reading?.pagesFullyRead,
        pages_not_read: ingest.reading?.pagesNotRead,
        pages_over_render_cap: ingest.reading?.pagesOverRenderCap,
        rasters_over_cap: ingest.reading?.rastersOverCap,
        settled_by: settledBy,
      },
    })
    if (ingest.status === 'failed') captureIngestFailure(organizationId, ingest, now)
  }
}

export type UploadSource = 'web' | 'mail' | 'chat'

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
