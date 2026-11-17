import type { ReconcilableDocument, TerminalResolution } from './reconcile-status'

export const INTERRUPTED_REASON_PREFIX = 'interrupted:'

const INTERRUPTED_RECHECK_WINDOW_MS = 30 * 60 * 1000

const LOST_JOB_AFTER_MS = 48 * 60 * 60 * 1000

export const extractIngestJobId = (metadata: unknown): string | null => {
  if (metadata && typeof metadata === 'object' && 'ingestJobId' in metadata) {
    const jobId = (metadata as Record<string, unknown>).ingestJobId
    if (typeof jobId === 'string' && jobId.length > 0) return jobId
  }
  return null
}

export const toEpochMs = (value: Date | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

export const isLostJob = (row: ReconcilableDocument, now: number): boolean => {
  const writtenAt = toEpochMs(row.updatedAt)
  return writtenAt !== null && now - writtenAt > LOST_JOB_AFTER_MS
}

export const lostJobResolution = (): TerminalResolution => ({
  status: 'failed',
  errorMessage: `${INTERRUPTED_REASON_PREFIX} the ingestion job was lost before it finished; retry to index this file`,
  failure: { category: 'transient', retryable: true, readerVersion: null },
})

export const isRecheckableInterruption = (row: ReconcilableDocument, now: number, pushed = false): boolean => {
  if (row.status !== 'failed') return false
  if (!row.errorMessage?.startsWith(INTERRUPTED_REASON_PREFIX)) return false
  if (!extractIngestJobId(row.metadata)) return false
  if (pushed) return true
  const writtenAt = toEpochMs(row.updatedAt)
  return writtenAt !== null && now - writtenAt < INTERRUPTED_RECHECK_WINDOW_MS
}

export const JOB_NOT_FOUND_MESSAGE = 'Job ID not found'

export const isForgottenJobFailure = (row: ReconcilableDocument | undefined): boolean =>
  row?.status === 'failed' && row.errorMessage === JOB_NOT_FOUND_MESSAGE

export const isRecheckableCancellation = (row: ReconcilableDocument, now: number): boolean => {
  if (row.status !== 'cancelled') return false
  if (!extractIngestJobId(row.metadata)) return false
  const writtenAt = toEpochMs(row.updatedAt)
  return writtenAt !== null && now - writtenAt < INTERRUPTED_RECHECK_WINDOW_MS
}
