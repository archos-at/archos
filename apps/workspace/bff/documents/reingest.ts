import 'server-only'
import { getBackendUrl } from '@/lib/backend-proxy'
import { ConflictError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import { documentStatusFacts } from './document-status'
import { IN_FLIGHT_DOCUMENT_STATUSES } from './document-status'
import { INGEST_ALREADY_DONE, INGEST_NOT_ELIGIBLE, INGEST_RUNNING, INGEST_WOULD_FAIL_AGAIN } from './reingest-codes'
import { canRetry, contentHashChanged, CURRENT_INGEST_READER_VERSION, type RetryFacts } from './retry-policy'
import type { AuthorizedSession } from '@/lib/auth/types'
import { onDocumentsSettled } from '@/lib/upload-batches/settle'
import { cancelledResolution, describeBackendIngestState, extractIngestJobId } from './reconcile-status'
import { resolveDocumentFolderPath } from './folder-path'
import { setDocumentReconciledStatus } from './repository'
import type { CancelIngestOutcome, CancelIngestResult } from './cancel-wire'

export type { CancelIngestOutcome, CancelIngestResult } from './cancel-wire'
import { getAccessibleDocument } from './access'
import { type DispatchDocumentResult, dispatchDocument } from './document-dispatch'
import { BACKEND_FETCH_TIMEOUT_MS, type IngestPriority } from './ingest-dispatch'

export interface ReingestDocumentResult {
  id: string
  status: DispatchDocumentResult['status']
  jobId: string | null
}

export async function reingestDocument(
  session: AuthorizedSession,
  documentId: string,
  options: { priority?: IngestPriority } = {}
): Promise<ReingestDocumentResult> {
  const doc = await getAccessibleDocument(session, documentId, 'write')

  if (!doc.storageKey) throw new NotFoundError('File not available')

  const variant = documentStatusFacts(doc.status)?.variant
  const isIndexed = variant === 'success'
  const isRetryable = variant === 'destructive' || doc.status === 'uploaded'
  const isInFlight = IN_FLIGHT_DOCUMENT_STATUSES.has(doc.status)

  if (isIndexed && doc.authoredBy !== 'user') {
    throw new ConflictError('Only documents a person uploaded can be re-read once indexed', {
      status: doc.status,
      code: INGEST_NOT_ELIGIBLE,
    })
  }
  if (!isIndexed && !isRetryable && !isInFlight) {
    throw new ConflictError('This document is not in a state that can be re-ingested', {
      status: doc.status,
      code: INGEST_NOT_ELIGIBLE,
    })
  }

  let failure: RetryFacts | null = isRetryable
    ? {
        status: doc.status,
        ingestFailureCategory: doc.ingestFailureCategory,
        ingestRetryable: doc.ingestRetryable,
        ingestReaderVersion: doc.ingestReaderVersion,
      }
    : null

  if (isInFlight) {
    const knowledge = await describeBackendIngestState({
      metadata: doc.metadata,
      id: doc.id,
      collectionName: doc.collectionName,
      filename: doc.filename,
      authoredBy: doc.authoredBy,
      authoredByProducer: doc.authoredByProducer,
      publishedVersionId: doc.publishedVersionId,
    })
    if (knowledge.state === 'in-progress') {
      throw new ConflictError('Ingestion is still running for this document', {
        status: doc.status,
        code: INGEST_RUNNING,
      })
    }
    if (knowledge.state === 'unreachable') {
      throw new UpstreamError('The ingestion backend could not be reached, so a retry cannot be verified as safe')
    }
    if (knowledge.state === 'terminal') {
      const moved = await setDocumentReconciledStatus(doc.id, session.organizationId, knowledge.resolution, {
        status: doc.status,
        jobId: extractIngestJobId(doc.metadata),
      })
      if (knowledge.resolution.status !== 'failed') {
        if (moved) {
          await onDocumentsSettled(session.organizationId, [{ id: doc.id, status: knowledge.resolution.status }])
        }
        throw new ConflictError(`Ingestion already ${knowledge.resolution.status} for this document`, {
          status: knowledge.resolution.status,
          code: INGEST_ALREADY_DONE,
        })
      }
      failure = {
        status: knowledge.resolution.status,
        ingestFailureCategory: knowledge.resolution.failure?.category ?? null,
        ingestRetryable: knowledge.resolution.failure?.retryable ?? null,
        ingestReaderVersion: knowledge.resolution.failure?.readerVersion ?? null,
      }
    }
  }

  if (
    failure &&
    !canRetry(failure, {
      currentReaderVersion: CURRENT_INGEST_READER_VERSION,
      contentHashChanged: contentHashChanged(doc),
    })
  ) {
    throw new ConflictError('Reading this file again would fail the same way', {
      status: failure.status,
      code: INGEST_WOULD_FAIL_AGAIN,
    })
  }

  const { jobId, status } = await dispatchDocument({
    organizationId: session.organizationId,
    projectId: doc.projectId,
    documentId: doc.id,
    filename: doc.filename,
    storageKey: doc.storageKey,
    storageBucket: doc.storageBucket,
    collectionName: doc.collectionName,
    folderPath: await resolveDocumentFolderPath(doc, session.organizationId),
    priority: options.priority,
  })
  return { id: doc.id, status, jobId }
}

async function requestIngestCancel(jobId: string, organizationId: string): Promise<CancelIngestOutcome> {
  let response: Response
  try {
    response = await fetch(`${getBackendUrl()}/v1/documents/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      headers: { 'x-organization-id': organizationId },
      signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    throw new UpstreamError(
      'The ingestion backend could not be reached to stop this job',
      error instanceof Error ? error.message : undefined
    )
  }
  if (!response.ok) throw new UpstreamError(`Stopping this job returned ${response.status}`)
  const body: unknown = await response.json().catch(() => null)
  const result =
    typeof body === 'object' && body !== null ? (body as { result?: unknown }).result : null
  if (result === 'cancelled' || result === 'finished' || result === 'unavailable') return result
  throw new UpstreamError('Stopping this job returned an unexpected shape')
}

export async function cancelDocumentIngest(
  session: AuthorizedSession,
  documentId: string
): Promise<CancelIngestResult> {
  const doc = await getAccessibleDocument(session, documentId, 'write')

  if (!IN_FLIGHT_DOCUMENT_STATUSES.has(doc.status)) {
    return { id: doc.id, result: 'finished', status: doc.status }
  }

  const jobId = extractIngestJobId(doc.metadata)
  if (!jobId) {
    return { id: doc.id, result: 'unavailable', status: doc.status }
  }

  const result = await requestIngestCancel(jobId, session.organizationId)
  if (result !== 'cancelled') return { id: doc.id, result, status: doc.status }

  const moved = await setDocumentReconciledStatus(doc.id, session.organizationId, cancelledResolution(), {
    status: doc.status,
    jobId,
  })
  if (moved) {
    await onDocumentsSettled(session.organizationId, [{ id: doc.id, status: 'cancelled' }])
    return { id: doc.id, result, status: 'cancelled' }
  }
  const settled = await getAccessibleDocument(session, documentId, 'write').catch(() => doc)
  return { id: doc.id, result, status: settled.status }
}
