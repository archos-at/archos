import { documentReadFamily } from './document-status'

export const INGEST_FAILURE_CATEGORIES = ['transient', 'configuration', 'deterministic', 'quarantined', 'unknown'] as const

export type IngestFailureCategory = (typeof INGEST_FAILURE_CATEGORIES)[number]

export const CURRENT_INGEST_READER_VERSION = '2026.10.1'

export interface IngestFailureFacts {
  category: IngestFailureCategory | null
  retryable: boolean | null
  readerVersion: string | null
}

export interface RetryFacts {
  status: string | null
  ingestFailureCategory?: string | null
  ingestRetryable?: boolean | null
  ingestReaderVersion?: string | null
}

export interface RetryContext {
  currentReaderVersion: string
  contentHashChanged: boolean
}

export function parseIngestFailureCategory(value: unknown): IngestFailureCategory | null {
  return typeof value === 'string' && (INGEST_FAILURE_CATEGORIES as readonly string[]).includes(value)
    ? (value as IngestFailureCategory)
    : null
}

function readerVersionParts(version: string): number[] | null {
  if (!/^\d+(\.\d+)*$/.test(version)) return null
  return version.split('.').map(Number)
}

export function isNewerReader(current: string, failed: string | null | undefined): boolean {
  if (!failed) return true
  const a = readerVersionParts(current)
  const b = readerVersionParts(failed)
  if (!a || !b) return current !== failed
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

export function contentHashChanged(row: { contentHash?: string | null; metadata?: unknown }): boolean {
  const dispatched =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as { ingestContentHash?: unknown }).ingestContentHash
      : undefined
  return (
    typeof dispatched === 'string' &&
    dispatched.length > 0 &&
    typeof row.contentHash === 'string' &&
    row.contentHash.length > 0 &&
    row.contentHash !== dispatched
  )
}

export function canRetry(doc: RetryFacts, context: RetryContext): boolean {
  if (documentReadFamily(doc.status) !== 'failed') return true
  const category = parseIngestFailureCategory(doc.ingestFailureCategory)
  if (category === 'deterministic') {
    return context.contentHashChanged || isNewerReader(context.currentReaderVersion, doc.ingestReaderVersion)
  }
  if (category === null) return doc.ingestRetryable !== false
  return category !== 'quarantined'
}

export function canRetryRow(
  row: RetryFacts & { contentHash?: string | null; metadata?: unknown }
): boolean {
  return canRetry(row, {
    currentReaderVersion: CURRENT_INGEST_READER_VERSION,
    contentHashChanged: contentHashChanged(row),
  })
}

export function offeredForRetry<T extends object>(documents: readonly T[]): T[] {
  return documents.filter((document) => (document as Record<string, unknown>).retryable !== false)
}
