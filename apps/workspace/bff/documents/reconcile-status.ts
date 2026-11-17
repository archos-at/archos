import { fetchInChunks, type BackendJobFile, type BackendJobStatus } from './status-batch'
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
import { timingOf, type IngestTiming } from './ingest-timing'
import { onDocumentsSettled } from '@/lib/upload-batches/settle'
import {
  reportsQuarantine,
  storedQuarantineVerdictOf,
  type StoredQuarantineVerdict,
} from '@/lib/upload-screening/quarantine'
import type { DocumentScreeningOutcome } from '@/lib/db/schema/documents'
import type { DocumentAuthor } from '@/lib/db/schema/documents'
import { collectionFileRef, type CollectionFileRef } from './collection-file-ref'
import { IN_FLIGHT_DOCUMENT_STATUSES } from './document-status'
import { parseRevisionLinkNames, type RevisionLinkNames, type RawRevisionLinkFields } from './revision-links'
import { parsePhotoCapture, type PhotoCapture } from './photo-capture'
import { parseRevisionFacts, type RevisionFacts } from './revision-facts'
import {
  parseDocumentReferences,
  parseDossier,
  parseReadingCoverage,
  type DocumentReference,
  type Dossier,
  type ReadingCoverage,
} from './dossier'
import { setDocumentReconciledStatus } from './repository'
import { projectReadings } from '@/lib/search/facets-projector'
import { listCollectionDocumentsForProjection } from '@/lib/search/facets-repository'
import { parseIngestFailureCategory, type IngestFailureFacts } from './retry-policy'
import { readHeader } from '@/lib/http/legacy-header-names'

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

export interface DocumentMetadata {
  summary?: string
  pageCount?: number
  chunkCount?: number
  contentTypes?: string[]
  tags?: string[]
  topics?: string[]
  capture?: PhotoCapture
  revisionFacts?: RevisionFacts
  dossier?: Dossier
  docReferences?: DocumentReference[]
  coverage?: ReadingCoverage
  queueAhead?: number | null
}

export interface TerminalResolution {
  status: 'completed' | 'failed' | 'quarantined' | 'cancelled'
  errorMessage: string | null
  screeningOutcome?: DocumentScreeningOutcome
  quarantine?: StoredQuarantineVerdict | null
  failure?: IngestFailureFacts
  timing?: IngestTiming
}

const NO_FAILURE_FACTS: IngestFailureFacts = { category: null, retryable: null, readerVersion: null }

type RowResolution = TerminalResolution | { status: 'pending'; errorMessage: null }

type JobResolution =
  | { kind: 'terminal'; resolution: TerminalResolution }
  | { kind: 'in_progress'; queueAhead: number | null }
  | { kind: 'unknown' }

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

export const cancelledResolution = (): TerminalResolution => ({
  status: 'cancelled',
  errorMessage: null,
  failure: NO_FAILURE_FACTS,
})

const resolveFromJobStatus = (job: BackendJobStatus | null | undefined): JobResolution => {
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

interface BackendFileEntry {
  status?: string
  error_message?: string | null
  quarantine?: unknown
  summary?: string | null
  chunk_count?: number
  page_count?: number
  content_types?: string[]
  tags?: string[] | null
  topics?: string[] | null
  capture?: unknown
  revision_facts?: unknown
  dossier?: unknown
  doc_references?: unknown
  coverage?: unknown
  revision?: RevisionLinkNames | null
}

interface CollectionFiles {
  byName: Map<string, BackendFileEntry>
  ambiguousNames: Set<string>
  readingUnavailable: boolean
}

const READING_UNAVAILABLE_HEADER = 'x-reading-unavailable'

interface RawBackendFile extends RawRevisionLinkFields {
  file_name?: string
  status?: string
  error_message?: string | null
  quarantine?: unknown
  summary?: string | null
  chunk_count?: number
  tags?: string[] | null
  topics?: string[] | null
  capture?: unknown
  revision_facts?: unknown
  dossier?: unknown
  doc_references?: unknown
  coverage?: unknown
  metadata?: { page_count?: number; content_types?: string[] } | null
}

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

const resolveFromCollection = (
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

const attributableFailure = (jobId: string | null): boolean => jobId === null

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

const resolveInterruptedRow = (job: BackendJobStatus | null | undefined): RowResolution | null => {
  const result = resolveFromJobStatus(job)
  if (result.kind === 'in_progress') return { status: 'pending', errorMessage: null }
  if (result.kind === 'terminal' && result.resolution.status === 'completed') return result.resolution
  return null
}

const resolveCancelledRow = (job: BackendJobStatus | null | undefined): RowResolution | null => {
  const result = resolveFromJobStatus(job)
  if (result.kind === 'terminal' && result.resolution.status === 'completed') return result.resolution
  return null
}

const extractMetadata = (files: CollectionFiles | null, ref: CollectionFileRef): DocumentMetadata | null => {
  if (!files || files.ambiguousNames.has(ref.filename)) return null
  const file = files.byName.get(ref.filename)
  if (!file) return null

  const meta: DocumentMetadata = {}
  if (typeof file.summary === 'string' && file.summary.length > 0) meta.summary = file.summary
  if (typeof file.page_count === 'number' && file.page_count > 0) meta.pageCount = file.page_count
  if (typeof file.chunk_count === 'number' && file.chunk_count > 0) meta.chunkCount = file.chunk_count
  if (Array.isArray(file.content_types) && file.content_types.length > 0) {
    meta.contentTypes = file.content_types
  }
  if (Array.isArray(file.tags) && file.tags.length > 0) {
    meta.tags = file.tags.filter((t): t is string => typeof t === 'string')
  }
  if (Array.isArray(file.topics)) {
    const topics = file.topics.filter((t): t is string => typeof t === 'string' && t.length > 0)
    if (topics.length > 0) meta.topics = topics
  }
  const capture = parsePhotoCapture(file.capture)
  if (capture) meta.capture = capture
  const revisionFacts = parseRevisionFacts(file.revision_facts)
  if (revisionFacts) meta.revisionFacts = revisionFacts
  const dossier = parseDossier(file.dossier)
  if (dossier) meta.dossier = dossier
  const docReferences = parseDocumentReferences(file.doc_references)
  if (docReferences) meta.docReferences = docReferences
  const coverage = parseReadingCoverage(file.coverage)
  if (coverage) meta.coverage = coverage
  return Object.keys(meta).length > 0 ? meta : null
}

export interface ListedReading {
  metadata: DocumentMetadata | null
  superseded: boolean
}

export const readCollectionReadings = async (
  collectionName: string,
  refs: readonly CollectionFileRef[]
): Promise<Map<string, ListedReading> | null> => {
  const files = await loadCollectionFilesFresh(collectionName)
  if (!files || files.readingUnavailable) return null
  return readingsIn(files, collectionName, refs)
}

function readingsIn(
  files: CollectionFiles,
  collectionName: string,
  refs: readonly CollectionFileRef[]
): Map<string, ListedReading> {
  const readings = new Map<string, ListedReading>()
  for (const ref of refs) {
    if (ref.collectionName !== collectionName || files.ambiguousNames.has(ref.filename)) continue
    const file = files.byName.get(ref.filename)
    if (!file) continue
    readings.set(ref.filename, { metadata: extractMetadata(files, ref), superseded: Boolean(file.revision?.supersededBy) })
  }
  return readings
}

interface ReplacedVersions {
  collectionName: string
  files: CollectionFiles
  names: readonly string[]
}

async function projectReplacedDocuments(
  organizationId: string,
  replaced: readonly ReplacedVersions[]
): Promise<void> {
  const byCollection = new Map<string, { files: CollectionFiles; names: Set<string> }>()
  for (const { collectionName, files, names } of replaced) {
    if (files.readingUnavailable) continue
    const group = byCollection.get(collectionName) ?? { files, names: new Set<string>() }
    for (const name of names) group.names.add(name)
    byCollection.set(collectionName, group)
  }
  for (const [collectionName, { files, names }] of byCollection) {
    const documents = await listCollectionDocumentsForProjection(organizationId, collectionName, [...names])
    const refs = documents.flatMap((document) => {
      const ref = collectionFileRef(document)
      return ref ? [{ id: document.id, ref }] : []
    })
    const readings = readingsIn(
      files,
      collectionName,
      refs.map((entry) => entry.ref)
    )
    await projectReadings(
      organizationId,
      refs.flatMap((entry) => {
        const reading = readings.get(entry.ref.filename)
        return reading ? [{ documentId: entry.id, ...reading }] : []
      })
    )
  }
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
