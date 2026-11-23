import type { Translator } from '@/i18n/translate'

export type IngestFailureKind =
  | 'rendition_failed'
  | 'drawing_unreadable'
  | 'download_failed'
  | 'interrupted'
  | 'unreadable_pages'
  | 'vision_not_configured'
  | 'dispatch_failed'
  | 'allowance_spent'
  | 'timeout'
  | 'empty'
  | 'deleted'
  | 'quarantined'
  | 'screening_unavailable'
  | 'unknown'

export type IngestFailure =
  | { kind: 'unreadable_pages'; failed: number; total: number; raw: string }
  | { kind: Exclude<IngestFailureKind, 'unreadable_pages'>; raw: string }

export const INGEST_FAILURE_PREFIXES = {
  office_rendition_required: 'rendition_failed',
  original_download_failed: 'download_failed',
  interrupted: 'interrupted',
  unreadable_job: 'dispatch_failed',
  pdf_pages_unreadable: 'unreadable_pages',
  vlm_not_configured: 'vision_not_configured',
  document_deleted: 'deleted',
  quarantined: 'quarantined',
  screening_unavailable: 'screening_unavailable',
} as const satisfies Record<string, IngestFailureKind>

export const BFF_FAILURE_PHRASES = {
  'Ingestion could not be started': 'dispatch_failed',
  'The ingestion allowance of this month is used up': 'allowance_spent',
  'The PDF version of this file could not be created': 'rendition_failed',
  'This DXF drawing could not be read': 'drawing_unreadable',
} as const satisfies Record<string, IngestFailureKind>

const UNREADABLE_PAGES = /(\d+)\s+of\s+(\d+)\s+pages?/i
const TIMEOUT = /\btimed?[\s_-]?out\b|\btimeout\b/i
const EMPTY = /^no content extracted\b/i

function prefixOf(message: string): string | null {
  const match = /^([a-z][a-z_]*):/.exec(message)
  return match ? match[1] : null
}

type BackendPrefix = keyof typeof INGEST_FAILURE_PREFIXES

function isBackendPrefix(prefix: string): prefix is BackendPrefix {
  return Object.prototype.hasOwnProperty.call(INGEST_FAILURE_PREFIXES, prefix)
}

function fromPrefix(prefix: string, raw: string): IngestFailure | null {
  if (!isBackendPrefix(prefix)) return null
  const kind: IngestFailureKind = INGEST_FAILURE_PREFIXES[prefix]
  if (kind !== 'unreadable_pages') return { kind, raw }
  const counts = UNREADABLE_PAGES.exec(raw)
  if (!counts) return { kind: 'unknown', raw }
  return { kind, failed: Number(counts[1]), total: Number(counts[2]), raw }
}

export function classifyIngestFailure(errorMessage: string | null | undefined): IngestFailure | null {
  const raw = errorMessage?.trim()
  if (!raw) return null

  const prefix = prefixOf(raw)
  const byPrefix = prefix ? fromPrefix(prefix, raw) : null
  if (byPrefix) return byPrefix

  for (const [phrase, kind] of Object.entries(BFF_FAILURE_PHRASES)) {
    if (raw.startsWith(phrase)) return { kind, raw }
  }
  if (EMPTY.test(raw)) return { kind: 'empty', raw }
  if (TIMEOUT.test(raw)) return { kind: 'timeout', raw }
  return { kind: 'unknown', raw }
}

export function ingestFailureSentence(failure: IngestFailure, t: Translator): string {
  if (failure.kind === 'unreadable_pages') {
    return t('ingestFailure.unreadable_pages', { failed: failure.failed, total: failure.total })
  }
  return t(`ingestFailure.${failure.kind}`)
}

export function failedWhileReading(file: { serverFileId?: string | null; jobId?: string | null }): boolean {
  return Boolean(file.serverFileId || file.jobId)
}
