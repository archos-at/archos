import 'server-only'
import { ingestScreeningFor } from '@/lib/upload-screening/service'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { presignForBackend, buildThumbnailStorageKey } from '@/lib/s3'
import { resolveDocumentBucket } from '@/lib/storage/bucket'
import { getBackendUrl } from '@/lib/backend-proxy'
import { projectFactsForIngest } from '@/lib/cross-project/project-facts-mirror'
import { findDocumentInOrg, markDocumentIngestFailed, setDocumentIngestJob, type DispatchStart } from './repository'
import { extractIngestJobId } from './lost-job'
import { internalRead } from './document-reader'
import { announceIngestStarted } from '@/lib/analytics/ingest-events'
import { filingChoiceRecord } from './filing-choice'
import type { DocumentTypeTag } from './tag-vocabulary'
import type { MailOriginIngestFacts, MailThreadIngestFacts } from '@/lib/mail-thread/ingest-facts'
import { copyMarkForIngest, licenceMarkFields } from '@/lib/base-knowledge/text-guard'
import { ingestAllowanceSpent } from '@/lib/budgets/ingest-allowance'

export const BACKEND_FETCH_TIMEOUT_MS = 10_000

export const INGEST_DISPATCH_FAILED_MESSAGE = 'Ingestion could not be started'

export const INGEST_ALLOWANCE_SPENT_MESSAGE = 'The ingestion allowance of this month is used up'

async function requestIngestJob(
  body: string,
  organizationId: string
): Promise<{ jobId: string | null; timedOut: boolean }> {
  try {
    const response = await fetch(`${getBackendUrl()}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-organization-id': organizationId },
      body,
      signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return { jobId: null, timedOut: false }
    const result: unknown = await response.json()
    const jobId =
      typeof result === 'object' && result !== null ? (result as { job_id?: unknown }).job_id : null
    return { jobId: typeof jobId === 'string' && jobId ? jobId : null, timedOut: false }
  } catch (error) {
    return { jobId: null, timedOut: isTimeoutError(error) }
  }
}

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'TimeoutError'
  )
}

export const INGEST_JOB_REF_TTL_SECONDS = 86_400

export const RENDITION_REQUIRED_MESSAGE = 'The PDF version of this file could not be created'

export const DRAWING_UNREADABLE_MESSAGE = 'This DXF drawing could not be read'

export interface DispatchIngestExtras {
  fileName?: string | null
  provenance?: AgentDocumentProvenance | null
  previewRef?: string | null
  extractionRef?: string | null
  priority?: IngestPriority
  revisionOf?: string | null
  revisionOfId?: string | null
  documentType?: DocumentTypeTag | null
  mailThread?: MailThreadIngestFacts | null
  mailOrigin?: MailOriginIngestFacts | null
}

export const INGEST_PRIORITIES = ['interactive', 'bulk'] as const

export type IngestPriority = (typeof INGEST_PRIORITIES)[number]

export interface AgentDocumentProvenance {
  authored_by: 'agent'
  approved_by: string | null
  approved_at: string | null
  producer: string | null
}

async function knowledgeMarkForIngest(organizationId: string, documentId: string): Promise<Record<string, string | number | boolean>> {
  const mark = await copyMarkForIngest(organizationId, documentId).catch(() => null)
  return mark ? { ...licenceMarkFields(mark), knowledge_edition_id: mark.editionId } : {}
}

export async function dispatchIngest(
  documentId: string,
  collectionName: string,
  storageKey: string,
  organizationId: string,
  storageBucket: string | null = null,
  folderPath: string | null = null,
  extras: DispatchIngestExtras = {}
): Promise<{ jobId: string | null; status: 'pending' | 'failed' }> {
  const bucket = resolveDocumentBucket(storageBucket)
  const presignedUrl = await presignForBackend(
    new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
    INGEST_JOB_REF_TTL_SECONDS
  )

  const thumbnailUploadKey = buildThumbnailStorageKey(storageKey)
  const thumbnailUploadUrl = thumbnailUploadKey
    ? await presignForBackend(
        new PutObjectCommand({
          Bucket: bucket,
          Key: thumbnailUploadKey,
          ContentType: 'image/jpeg',
        }),
        INGEST_JOB_REF_TTL_SECONDS
      )
    : null

  const attribution = await findDocumentInOrg(documentId, organizationId, internalRead('ingest')).catch(() => null)
  const start: DispatchStart | undefined = attribution
    ? { ingestJobId: extractIngestJobId(attribution.metadata), storageKey: attribution.storageKey }
    : undefined
  if (await ingestAllowanceSpent(organizationId)) {
    await markDocumentIngestFailed(documentId, organizationId, INGEST_ALLOWANCE_SPENT_MESSAGE, start)
    return { jobId: null, status: 'failed' }
  }
  const projectFacts = await projectFactsForIngest(attribution?.projectId, organizationId)
  let screening: Awaited<ReturnType<typeof ingestScreeningFor>>
  try {
    screening = await ingestScreeningFor(organizationId, attribution)
  } catch {
    await markDocumentIngestFailed(documentId, organizationId, INGEST_DISPATCH_FAILED_MESSAGE, start)
    return { jobId: null, status: 'failed' }
  }

  const body = JSON.stringify({
    file_ref: presignedUrl,
    collection: collectionName,
    document_id: documentId,
    byte_size: attribution?.storageKey === storageKey ? (attribution?.fileSize ?? null) : null,
    project_id: attribution?.projectId ?? null,
    user_id: attribution?.createdBy ?? null,
    project_facts: projectFacts,
    thumbnail_upload_url: thumbnailUploadUrl,
    preview_ref: extras.previewRef ?? null,
    extraction_ref: extras.extractionRef ?? null,
    folder_path: folderPath,
    ...(await knowledgeMarkForIngest(organizationId, documentId)),
    screening,
    file_name: extras.fileName ?? null,
    ...(extras.priority === 'bulk' ? { priority: 'bulk' } : {}),
    ...(extras.revisionOf ? { revision_of: extras.revisionOf } : {}),
    ...(extras.documentType ? { document_type: extras.documentType } : {}),
    ...(extras.mailThread ? { mail_thread: extras.mailThread } : {}),
    ...(extras.mailOrigin && !extras.mailThread ? { mail_origin: extras.mailOrigin } : {}),
    ...(extras.provenance ?? {}),
  })

  let attempt = await requestIngestJob(body, organizationId)
  if (attempt.timedOut) attempt = await requestIngestJob(body, organizationId)
  const ingestJobId = attempt.jobId

  if (ingestJobId) {
    const filingChoice = filingChoiceRecord({
      documentType: extras.documentType,
      revisionOfId: extras.revisionOf ? extras.revisionOfId : null,
      mailThread: extras.mailThread,
      mailOrigin: extras.mailThread ? null : extras.mailOrigin,
    })
    const moved = await setDocumentIngestJob(documentId, organizationId, ingestJobId, filingChoice, start)
    if (moved) {
      announceIngestStarted(organizationId, {
        documentId,
        filename: attribution?.filename ?? extras.fileName ?? '',
        attempt: (attribution?.ingestAttempts ?? 0) + 1,
        jobId: ingestJobId,
      })
    }
    return { jobId: ingestJobId, status: 'pending' }
  }
  await markDocumentIngestFailed(documentId, organizationId, INGEST_DISPATCH_FAILED_MESSAGE, start)
  return { jobId: null, status: 'failed' }
}
