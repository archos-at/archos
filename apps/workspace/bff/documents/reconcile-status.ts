import { fetchInChunks, type BackendJobStatus } from './status-batch'
import {
  extractIngestJobId,
  isForgottenJobFailure,
  isLostJob,
  isRecheckableCancellation,
  isRecheckableInterruption,
  lostJobResolution,
  toEpochMs,
} from './lost-job'
import { getBackendUrl } from '@/lib/backend-url'
import type { SettledBy } from '@/lib/analytics/ingest-events'
import { announceSettledIngests, announceSettledShelves } from './announce-settled'
import { onDocumentsSettled } from '@/lib/upload-batches/settle'
import type { DocumentAuthor } from '@/lib/db/schema/documents'
import { collectionFileRef, type CollectionFileRef } from './collection-file-ref'
import { IN_FLIGHT_DOCUMENT_STATUSES } from './document-status'
import { parseRevisionLinkNames, type RevisionLinkNames } from './revision-links'
import { setDocumentReconciledStatus } from './repository'
import { projectReadings } from '@/lib/search/facets-projector'
import { readHeader } from '@/lib/http/legacy-header-names'
import { extractMetadata, readingsIn, type DocumentMetadata, type ListedReading } from './reconcile-status/reading-metadata'
import { projectReplacedDocuments, type ReplacedVersions } from './reconcile-status/replaced-document-projection'
import {
  attributableFailure,
  resolveCancelledRow,
  resolveFromCollection,
  resolveFromJobStatus,
  resolveInterruptedRow,
  type RowResolution,
  type TerminalResolution,
} from './reconcile-status/ingest-resolution'
import type { BackendFileEntry, CollectionFiles, RawBackendFile } from './reconcile-status/collection-listing-types'

export type { DocumentMetadata, ListedReading } from './reconcile-status/reading-metadata'
export type { TerminalResolution } from './reconcile-status/ingest-resolution'
export { cancelledResolution } from './reconcile-status/ingest-resolution'

const IN_FLIGHT_STATUSES = IN_FLIGHT_DOCUMENT_STATUSES

const LOCALLY_OWNED_STATUS = 'processing'

const FETCH_TIMEOUT_MS = 5000

export interface ReconcilableDocument {
  id: string
  status: string
  filename: string
  collectionName: string
  authoredBy: DocumentAuthor
  publishedVersionId: string | null
  errorMessage: string | null
  metadata?: unknown
  updatedAt?: Date | string | null
}

export { extractIngestJobId }

const recordedIngestHash = (metadata: unknown): string | null => {
  if (metadata && typeof metadata === 'object' && 'ingestContentHash' in metadata) {
    const hash = (metadata as Record<string, unknown>).ingestContentHash
    if (typeof hash === 'string' && hash.length > 0) return hash
  }
  return null
}

const fetchJson = async (
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: unknown; headers?: Headers } | null> => {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (response.status === 404) return { status: 404, body: null }
    if (!response.ok) return null
    return { status: response.status, body: await response.json(), headers: response.headers }
  } catch {
    return null
  }
}

const fetchJobStatuses = (jobIds: string[]): Promise<Map<string, BackendJobStatus | null> | null> =>
  fetchInChunks(jobIds, async (chunk) => {
    const result = await fetchJson(`${getBackendUrl()}/v1/documents/status/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_ids: chunk }),
    })
    if (!result || result.status === 404 || typeof result.body !== 'object' || result.body === null) return null
    return (result.body as { statuses?: Record<string, BackendJobStatus | null> }).statuses ?? {}
  })

const READING_UNAVAILABLE_HEADER = 'x-reading-unavailable'

const loadCollectionFiles = async (collectionName: string): Promise<CollectionFiles | null> => {
  const result = await fetchJson(
    `${getBackendUrl()}/v1/collections/${encodeURIComponent(collectionName)}/documents`
  )
  if (!result || result.status === 404 || !Array.isArray(result.body)) return null

  const byName = new Map<string, BackendFileEntry>()
  const ambiguousNames = new Set<string>()
  for (const file of result.body as RawBackendFile[]) {
    if (!file.file_name) continue
    if (byName.has(file.file_name)) {
      ambiguousNames.add(file.file_name)
      continue
    }
    byName.set(file.file_name, {
      status: file.status,
      error_message: file.error_message,
      quarantine: file.quarantine,
      summary: file.summary,
      chunk_count: file.chunk_count,
      page_count: file.metadata?.page_count,
      content_types: file.metadata?.content_types,
      tags: file.tags,
      topics: file.topics,
      capture: file.capture,
      revision_facts: file.revision_facts,
      dossier: file.dossier,
      doc_references: file.doc_references,
      coverage: file.coverage,
      revision: parseRevisionLinkNames(file),
    })
  }
  return { byName, ambiguousNames, readingUnavailable: (result.headers ? readHeader(result.headers, READING_UNAVAILABLE_HEADER) : null) === '1' }
}

const COLLECTION_FILES_TTL_MS = 15_000

interface CollectionFilesCacheEntry {
  promise: Promise<CollectionFiles | null>
  fetchedAt: number
  expiresAt: number
}

const collectionFilesCache = new Map<string, CollectionFilesCacheEntry>()

const storeCollectionFiles = (collectionName: string, promise: Promise<CollectionFiles | null>): void => {
  const now = Date.now()
  collectionFilesCache.set(collectionName, { promise, fetchedAt: now, expiresAt: now + COLLECTION_FILES_TTL_MS })
  void promise.then((value) => {
    if (value === null && collectionFilesCache.get(collectionName)?.promise === promise) {
      collectionFilesCache.delete(collectionName)
    }
  })
}

const loadCollectionFilesCached = (collectionName: string): Promise<CollectionFiles | null> => {
  const entry = collectionFilesCache.get(collectionName)
  if (entry && entry.expiresAt > Date.now()) return entry.promise
  const promise = loadCollectionFiles(collectionName)
  storeCollectionFiles(collectionName, promise)
  return promise
}

const cachedListingFetchedAt = (collectionName: string): number | null => {
  const entry = collectionFilesCache.get(collectionName)
  return entry && entry.expiresAt > Date.now() ? entry.fetchedAt : null
}

const loadCollectionFilesFresh = (collectionName: string): Promise<CollectionFiles | null> => {
  const promise = loadCollectionFiles(collectionName)
  storeCollectionFiles(collectionName, promise)
  return promise
}

export const clearCollectionFilesCache = (): void => {
  collectionFilesCache.clear()
}

export const readRevisionLinkNames = async (ref: CollectionFileRef): Promise<RevisionLinkNames | null> => {
  const files = await loadCollectionFilesCached(ref.collectionName)
  if (!files || files.ambiguousNames.has(ref.filename)) return null
  return files.byName.get(ref.filename)?.revision ?? null
}

export const refreshCollectionFiles = async (collectionName: string): Promise<void> => {
  await loadCollectionFilesFresh(collectionName)
}

export type BackendIngestKnowledge =
  | { state: 'in-progress' }
  | { state: 'terminal'; resolution: TerminalResolution }
  | { state: 'absent' }
  | { state: 'unreachable' }

export async function describeBackendIngestState(row: {
  metadata?: unknown
  collectionName: string
  filename: string
  authoredBy: DocumentAuthor
  publishedVersionId: string | null
}): Promise<BackendIngestKnowledge> {
  const jobId = extractIngestJobId(row.metadata)
  if (jobId) {
    const statuses = await fetchJobStatuses([jobId])
    if (statuses === null) return { state: 'unreachable' }
    const result = resolveFromJobStatus(statuses.get(jobId))
    if (result.kind === 'terminal') return { state: 'terminal', resolution: result.resolution }
    if (result.kind === 'in_progress') return { state: 'in-progress' }
  }

  const ref = collectionFileRef(row)
  if (!ref) {
    return { state: 'absent' }
  }
  const files = await loadCollectionFilesFresh(row.collectionName)
  if (files === null) return { state: 'unreachable' }
  if (files.ambiguousNames.has(ref.filename)) return { state: 'in-progress' }
  const resolution = resolveFromCollection(files, ref, jobId)
  if (resolution) return { state: 'terminal', resolution }
  const file = files.byName.get(ref.filename)
  if (file && !(file.status === 'failed' && !attributableFailure(jobId))) return { state: 'in-progress' }
  return { state: 'absent' }
}

export const readCollectionReadings = async (
  collectionName: string,
  refs: readonly CollectionFileRef[]
): Promise<Map<string, ListedReading> | null> => {
  const files = await loadCollectionFilesFresh(collectionName)
  if (!files || files.readingUnavailable) return null
  return readingsIn(files, collectionName, refs)
}

export async function reconcileDocumentStatuses<T extends ReconcilableDocument>(
  rows: T[],
  organizationId: string,
  settledBy: SettledBy,
): Promise<Array<T & DocumentMetadata>> {
  if (rows.length === 0) return []

  const freshFetches = new Map<string, Promise<CollectionFiles | null>>()
  const getFreshCollectionFiles = (collectionName: string): Promise<CollectionFiles | null> => {
    let cached = freshFetches.get(collectionName)
    if (!cached) {
      cached = loadCollectionFilesFresh(collectionName)
      freshFetches.set(collectionName, cached)
    }
    return cached
  }

  const resolutions = new Map<string, RowResolution>()
  const moved = new Set<string>()
  const queueAheadByRow = new Map<string, number>()
  const inFlight = rows.filter(
    (row) => IN_FLIGHT_STATUSES.has(row.status) && row.status !== LOCALLY_OWNED_STATUS
  )
  const now = Date.now()
  const interrupted = rows.filter((row) => isRecheckableInterruption(row, now, settledBy === 'push'))
  const cancelled = rows.filter((row) => isRecheckableCancellation(row, now))
  if (inFlight.length > 0 || interrupted.length > 0 || cancelled.length > 0) {
    const jobIds = [
      ...new Set(
        [...inFlight, ...interrupted, ...cancelled]
          .map((row) => extractIngestJobId(row.metadata))
          .filter((id): id is string => !!id)
      ),
    ]
    const jobStatuses = await fetchJobStatuses(jobIds)

    await Promise.all(
      interrupted.map(async (row) => {
        const jobId = extractIngestJobId(row.metadata)
        if (jobStatuses === null || !jobId) return
        const resolution = resolveInterruptedRow(jobStatuses.get(jobId))
        if (!resolution) return
        if (await setDocumentReconciledStatus(row.id, organizationId, resolution, { status: row.status, jobId })) {
          moved.add(row.id)
        }
        resolutions.set(row.id, resolution)
      })
    )

    await Promise.all(
      cancelled.map(async (row) => {
        const jobId = extractIngestJobId(row.metadata)
        if (jobStatuses === null || !jobId) return
        const resolution = resolveCancelledRow(jobStatuses.get(jobId))
        if (!resolution) return
        if (await setDocumentReconciledStatus(row.id, organizationId, resolution, { status: row.status, jobId })) {
          moved.add(row.id)
        }
        resolutions.set(row.id, resolution)
      })
    )

    await Promise.all(
      inFlight.map(async (row) => {
        const jobId = extractIngestJobId(row.metadata)
        let resolution: TerminalResolution | null = null
        let jobForgotten = false

        if (jobId) {
          if (jobStatuses === null) return
          const jobResult = resolveFromJobStatus(jobStatuses.get(jobId))
          jobForgotten = jobResult.kind === 'unknown'
          if (jobResult.kind === 'terminal') {
            resolution = jobResult.resolution
          } else if (jobResult.kind === 'in_progress') {
            if (jobResult.queueAhead !== null) queueAheadByRow.set(row.id, jobResult.queueAhead)
            return
          }
        }

        if (!resolution) {
          const ref = collectionFileRef(row)
          if (!ref) return
          const files = await getFreshCollectionFiles(row.collectionName)
          resolution = resolveFromCollection(files, ref, jobId)
          if (!resolution && files && jobForgotten && isLostJob(row, now)) resolution = lostJobResolution()
        }
        if (!resolution) return

        if (await setDocumentReconciledStatus(row.id, organizationId, resolution, { status: row.status, jobId })) {
          moved.add(row.id)
        }
        resolutions.set(row.id, resolution)
      })
    )
  }

  await Promise.all(
    rows.filter(isForgottenJobFailure).map(async (row) => {
      const ref = collectionFileRef(row)
      if (!ref) return
      const files = await loadCollectionFilesCached(row.collectionName)
      if (!files || files.ambiguousNames.has(ref.filename)) return
      const jobId = extractIngestJobId(row.metadata)
      const resolution = resolveFromCollection(files, ref, jobId)
      if (resolution?.status !== 'completed') return
      if (await setDocumentReconciledStatus(row.id, organizationId, resolution, { status: row.status, jobId })) {
        moved.add(row.id)
      }
      resolutions.set(row.id, resolution)
    })
  )

  const settled = [...resolutions].filter(([id, resolution]) => moved.has(id) && resolution.status !== 'pending')
  if (settled.length > 0) {
    await onDocumentsSettled(
      organizationId,
      settled.map(([id, resolution]) => ({ id, status: resolution.status, ...(isForgottenJobFailure(rows.find((row) => row.id === id)) ? { correction: true } : {}) }))
    )
    announceSettledShelves(organizationId, rows, new Set(settled.map(([id]) => id)))
  }

  const collectionsNeedingFresh = new Set<string>()
  for (const row of rows) {
    if (freshFetches.has(row.collectionName)) continue
    if (resolutions.has(row.id)) {
      collectionsNeedingFresh.add(row.collectionName)
      continue
    }
    if (IN_FLIGHT_STATUSES.has(row.status)) continue
    const fetchedAt = cachedListingFetchedAt(row.collectionName)
    const writtenAt = toEpochMs(row.updatedAt)
    if (fetchedAt !== null && writtenAt !== null && writtenAt > fetchedAt) {
      collectionsNeedingFresh.add(row.collectionName)
    }
  }

  const listingFor = (collectionName: string): Promise<CollectionFiles | null> =>
    freshFetches.has(collectionName) || collectionsNeedingFresh.has(collectionName)
      ? getFreshCollectionFiles(collectionName)
      : loadCollectionFilesCached(collectionName)

  const metaByRow = new Map<string, DocumentMetadata>()
  const supersededRows = new Set<string>()
  const replacesByRow = new Map<string, ReplacedVersions>()
  await Promise.all(
    rows.map(async (row) => {
      const ref = collectionFileRef(row)
      if (!ref) return
      const files = await listingFor(row.collectionName)
      const meta = extractMetadata(files, ref)
      if (meta) metaByRow.set(row.id, meta)
      const revision = files?.byName.get(ref.filename)?.revision
      if (revision?.supersededBy) supersededRows.add(row.id)
      if (files && revision && revision.supersedes.length > 0) replacesByRow.set(row.id, { collectionName: row.collectionName, files, names: revision.supersedes })
    })
  )

  const readNow = settled.filter(([id, resolution]) => resolution.status === 'completed' && metaByRow.has(id))
  if (readNow.length > 0) {
    void projectReadings(
      organizationId,
      readNow.map(([id]) => ({ documentId: id, metadata: metaByRow.get(id) ?? null, superseded: supersededRows.has(id) }))
    ).catch((error: unknown) => console.warn('[search] projecting settled readings failed', error))
    const replaced = readNow.flatMap(([id]) => {
      const entry = replacesByRow.get(id)
      return entry ? [entry] : []
    })
    if (replaced.length > 0) {
      void projectReplacedDocuments(organizationId, replaced).catch((error: unknown) =>
        console.warn('[search] projecting replaced Fassungen failed', error)
      )
    }
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]))
  await announceSettledIngests(organizationId, settled, rowsById, metaByRow, settledBy)

  return rows.map((row) => {
    const resolution = resolutions.get(row.id)
    const meta = metaByRow.get(row.id) ?? {}
    const verdict =
      resolution && 'screeningOutcome' in resolution && resolution.screeningOutcome && 'screeningOutcome' in row
        ? { screeningOutcome: resolution.screeningOutcome }
        : {}
    const dispatchedHash = recordedIngestHash(row.metadata)
    const judged =
      resolution?.status === 'completed' && 'screenedHash' in row && dispatchedHash !== null
        ? { screenedHash: dispatchedHash }
        : {}
    const failure = resolution && 'failure' in resolution ? resolution.failure : undefined
    const held =
      resolution && 'quarantine' in row
        ? { quarantine: resolution.status === 'quarantined' ? (resolution.quarantine ?? null) : null }
        : {}
    const explained =
      failure && 'ingestFailureCategory' in row
        ? {
            ingestFailureCategory: failure.category,
            ingestRetryable: failure.retryable,
            ingestReaderVersion: failure.readerVersion,
          }
        : {}
    const base = resolution
      ? {
          ...row,
          status: resolution.status,
          errorMessage: resolution.errorMessage,
          ...verdict,
          ...judged,
          ...held,
          ...explained,
        }
      : row
    return { ...base, ...meta, queueAhead: queueAheadByRow.get(row.id) ?? null }
  })
}
