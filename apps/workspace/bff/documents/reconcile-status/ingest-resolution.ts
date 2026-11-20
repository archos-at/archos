import type { BackendJobFile, BackendJobStatus } from '../status-batch'
import { timingOf, type IngestTiming } from '../ingest-timing'
import { reportsQuarantine, storedQuarantineVerdictOf, type StoredQuarantineVerdict } from '@/lib/upload-screening/quarantine'
import type { DocumentScreeningOutcome } from '@/lib/db/schema/documents'
import { parseIngestFailureCategory, type IngestFailureFacts } from '../retry-policy'
import type { CollectionFileRef } from '../collection-file-ref'
import type { CollectionFiles } from './collection-listing-types'

export interface TerminalResolution {
  status: 'completed' | 'failed' | 'quarantined' | 'cancelled'
  errorMessage: string | null
  screeningOutcome?: DocumentScreeningOutcome
  quarantine?: StoredQuarantineVerdict | null
  failure?: IngestFailureFacts
  timing?: IngestTiming
}

const NO_FAILURE_FACTS: IngestFailureFacts = { category: null, retryable: null, readerVersion: null }

export type RowResolution = TerminalResolution | { status: 'pending'; errorMessage: null }

type JobResolution =
  | { kind: 'terminal'; resolution: TerminalResolution }
  | { kind: 'in_progress'; queueAhead: number | null }
  | { kind: 'unknown' }

const failureFacts = (job: BackendJobStatus, file: BackendJobFile | undefined): IngestFailureFacts => ({
  category: parseIngestFailureCategory(file?.failure_category),
  retryable: typeof file?.retryable === 'boolean' ? file.retryable : null,
  readerVersion: typeof job.reader_version === 'string' && job.reader_version.length > 0 ? job.reader_version : null,
})

interface FailureReport {
  errorMessage: string | null
  quarantine?: unknown
}

const failedOrQuarantined = (
  report: FailureReport,
  failure: IngestFailureFacts = NO_FAILURE_FACTS
): TerminalResolution =>
  reportsQuarantine(report)
    ? {
        status: 'quarantined',
        errorMessage: report.errorMessage,
        quarantine: storedQuarantineVerdictOf(report),
        screeningOutcome: 'quarantined',
        failure,
      }
    : { status: 'failed', errorMessage: report.errorMessage, failure }

const SCREENING_OUTCOMES_FROM_JOB = new Set<DocumentScreeningOutcome>(['clean', 'partial', 'unchecked'])

const completedOutcome = (job: BackendJobStatus): TerminalResolution => {
  const reported = job.file_details?.length === 1 ? job.file_details[0]?.screening : null
  const outcome = SCREENING_OUTCOMES_FROM_JOB.has(reported as DocumentScreeningOutcome)
    ? (reported as DocumentScreeningOutcome)
    : undefined
  const failure = failureFacts(job, undefined)
  return { status: 'completed', errorMessage: null, ...(outcome ? { screeningOutcome: outcome } : {}), failure }
}

export const cancelledResolution = (): TerminalResolution => ({
  status: 'cancelled',
  errorMessage: null,
  failure: NO_FAILURE_FACTS,
})

export const resolveFromJobStatus = (job: BackendJobStatus | null | undefined): JobResolution => {
  const resolved = resolveJobOutcome(job)
  if (resolved.kind !== 'terminal' || !job) return resolved
  return { kind: 'terminal', resolution: { ...resolved.resolution, timing: timingOf(job) } }
}

const resolveJobOutcome = (job: BackendJobStatus | null | undefined): JobResolution => {
  if (job === undefined || job === null) return { kind: 'unknown' }

  if (job.status === 'cancelled') {
    return { kind: 'terminal', resolution: cancelledResolution() }
  }
  if (job.status === 'completed') {
    const failedFile = job.file_details?.find((f) => f.status === 'failed')
    if (failedFile && job.file_details?.length === 1) {
      return {
        kind: 'terminal',
        resolution: failedOrQuarantined(
          { errorMessage: failedFile.error_message ?? null, quarantine: failedFile.quarantine },
          failureFacts(job, failedFile)
        ),
      }
    }
    return { kind: 'terminal', resolution: completedOutcome(job) }
  }
  if (job.status === 'failed') {
    const reportingFile = job.file_details?.find((f) => f.error_message || f.quarantine)
    const errorMessage = reportingFile?.error_message ?? job.error_message ?? null
    return {
      kind: 'terminal',
      resolution: failedOrQuarantined(
        { errorMessage, quarantine: reportingFile?.quarantine },
        failureFacts(job, reportingFile)
      ),
    }
  }
  const ahead = job.metadata?.queue_ahead
  return { kind: 'in_progress', queueAhead: typeof ahead === 'number' && ahead >= 0 ? ahead : null }
}

export const resolveFromCollection = (
  files: CollectionFiles | null,
  ref: CollectionFileRef,
  jobId: string | null
): TerminalResolution | null => {
  const file = files?.byName.get(ref.filename)
  if (!file) return null
  if (file.status === 'success') return { status: 'completed', errorMessage: null, failure: NO_FAILURE_FACTS }
  if (file.status === 'failed' && attributableFailure(jobId)) {
    return failedOrQuarantined({ errorMessage: file.error_message ?? null, quarantine: file.quarantine })
  }
  return null
}

export const attributableFailure = (jobId: string | null): boolean => jobId === null

export const resolveInterruptedRow = (job: BackendJobStatus | null | undefined): RowResolution | null => {
  const result = resolveFromJobStatus(job)
  if (result.kind === 'in_progress') return { status: 'pending', errorMessage: null }
  if (result.kind === 'terminal' && result.resolution.status === 'completed') return result.resolution
  return null
}

export const resolveCancelledRow = (job: BackendJobStatus | null | undefined): RowResolution | null => {
  const result = resolveFromJobStatus(job)
  if (result.kind === 'terminal' && result.resolution.status === 'completed') return result.resolution
  return null
}
