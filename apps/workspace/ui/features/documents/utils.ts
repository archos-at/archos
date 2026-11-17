import { reportsQuarantine } from '@/lib/upload-screening/quarantine'
import type { DocumentFileStatus, JobState, TrackedFileStatus } from './types'
import type { ListedFileStatus } from '@/adapters/api/documents-schemas'
import type { FileSourceStatus } from '@/features/layout/components/FileSourceCard'

export const mapBackendStatus = (backendStatus: string): DocumentFileStatus => {
  const statusMap: Record<string, DocumentFileStatus> = {
    uploading: 'uploading',
    ingesting: 'ingesting',
    success: 'success',
    failed: 'failed',
  }
  return statusMap[backendStatus] || 'uploading'
}

const JOB_STATE_HAS_ENDED: Record<JobState, boolean> = {
  pending: false,
  processing: false,
  completed: true,
  failed: true,
  cancelled: true,
}

export const isEndedJobStatus = (status: JobState): boolean => JOB_STATE_HAS_ENDED[status]

export const trackedStatusOfJobFile = (jobFile: {
  status: string
  error_message?: string | null
  quarantine?: unknown
}): TrackedFileStatus => {
  if (jobFile.status === 'failed' && reportsQuarantine(jobFile)) return 'held'
  if (isAtRestListedStatus(jobFile.status)) return jobFile.status
  return mapBackendStatus(jobFile.status)
}

const AT_REST_LISTED_STATUSES: ReadonlySet<string> = new Set<ListedFileStatus>(['stored', 'held'])

function isAtRestListedStatus(status: string): status is 'stored' | 'held' {
  return AT_REST_LISTED_STATUSES.has(status)
}

export const mapUploadResponseStatus = (
  status: string | null | undefined,
  unchanged = false
): TrackedFileStatus => {
  if (unchanged) return 'success'
  switch (status) {
    case 'failed':
      return 'failed'
    case 'uploaded':
      return 'stored'
    case 'quarantined':
      return 'held'
    default:
      return 'ingesting'
  }
}

export const mapToDisplayStatus = (status: TrackedFileStatus): FileSourceStatus => {
  switch (status) {
    case 'uploading':
      return 'uploading'
    case 'ingesting':
      return 'ingesting'
    case 'success':
      return 'available'
    case 'stored':
      return 'stored'
    case 'failed':
      return 'error'
    case 'held':
      return 'held'
    case 'deleting':
      return 'deleting'
    case 'canceled':
      return 'canceled'
    default: {
      status satisfies never
      return 'uploading'
    }
  }
}

export const normalizeFileName = (backendFileName: string): string => {
  const match = backendFileName.match(/^tmp_[a-z0-9]+_(.+)$/i)
  if (match) {
    return match[1]
  }
  return backendFileName
}
