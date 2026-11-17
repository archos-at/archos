import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import { projectShelf } from './shelf'
import { uploadToShelf, type UploadDocumentResult } from './shelf-upload'
import { findDocumentInOrg, markDocumentNotIndexed, markDocumentIngestFailed, markDocumentProcessing, setDocumentBackgroundJob } from './repository'
import { withTenant } from '@/lib/db/tenant-context'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { findOpenJobId } from '@/lib/jobs-queue/repository'
import { BFF_JOB_PRIORITY, type BffJobPriority } from '@/lib/jobs-queue/types'
import { internalRead } from './document-reader'
import { isIfcFilename } from '@/lib/bim/types'
import { extractsFromRendition, isRenditionEnabledFor } from './rendition'
import { servedAsRendition } from './document-delivery'
import type { DocumentTypeTag } from './tag-vocabulary'
import type { MailOriginIngestFacts, MailThreadIngestFacts } from '@/lib/mail-thread/ingest-facts'
import { type AgentDocumentProvenance, INGEST_DISPATCH_FAILED_MESSAGE, type IngestPriority, RENDITION_REQUIRED_MESSAGE, dispatchIngest } from './ingest-dispatch'
import { isTextHeld } from '@/lib/base-knowledge/text-guard'

export interface UploadDocumentInput {
  projectId: string
  folderId: string | null
  file: File
  originPath?: string | null
  screeningRelease?: boolean
  uploadBatchId?: string | null
  revisionOf?: string | null
  priority?: IngestPriority
  documentType?: DocumentTypeTag
  mailThread?: MailThreadIngestFacts
  mailOrigin?: MailOriginIngestFacts
}

export type { UploadDocumentResult }

export function uploadDocument(
  session: AuthorizedSession,
  input: UploadDocumentInput,
  request: Request
): Promise<UploadDocumentResult> {
  return uploadToShelf(session, projectShelf(input.projectId), input, request)
}

export interface BeginModelExtractionInput {
  organizationId: string
  projectId: string | null
  documentId: string
  filename: string
  storageKey: string
  storageBucket: string | null
  collectionName: string
  folderPath?: string | null
  priority?: IngestPriority
}

export interface DispatchDocumentInput extends BeginModelExtractionInput {
  versionId?: string | null
  provenance?: AgentDocumentProvenance | null
  revisionOf?: string | null
  revisionOfId?: string | null
  documentType?: DocumentTypeTag | null
  mailThread?: MailThreadIngestFacts | null
  mailOrigin?: MailOriginIngestFacts | null
}

export interface DispatchDocumentResult {
  jobId: string | null
  status: 'pending' | 'uploaded' | 'failed' | 'processing' | 'quarantined' | 'stored'
}

export class AgentAuthoredDocumentNotIndexableError extends Error {
  constructor(readonly documentId: string) {
    super(
      `document ${documentId} was written by a machine and is not a published version, so it must not be indexed`
    )
    this.name = 'AgentAuthoredDocumentNotIndexableError'
  }
}

export async function dispatchDocument(
  input: DispatchDocumentInput
): Promise<DispatchDocumentResult> {
  const row = await findDocumentInOrg(input.documentId, input.organizationId, internalRead('ingest'))
  if (!row || !mayBeIndexed(row, input.versionId ?? null)) {
    throw new AgentAuthoredDocumentNotIndexableError(input.documentId)
  }
  if (row.status === 'quarantined') return { jobId: null, status: 'quarantined' }
  if (row.lifecycle === 'archived') {
    await markDocumentNotIndexed(row.id, input.organizationId)
    return { jobId: null, status: 'stored' }
  }
  if (row.scope === 'office_shelf' && (await isTextHeld(input.organizationId, row.id))) {
    await markDocumentNotIndexed(row.id, input.organizationId)
    return { jobId: null, status: 'stored' }
  }

  if (isIfcFilename(input.filename)) {
    return beginModelExtraction(input)
  }
  if (servedAsRendition(row) && isRenditionEnabledFor(row)) {
    return beginRenditionIngest(input, row.filename)
  }
  if (servedAsRendition(row) && extractsFromRendition(row.filename)) {
    await markDocumentIngestFailed(input.documentId, input.organizationId, RENDITION_REQUIRED_MESSAGE)
    return { jobId: null, status: 'failed' }
  }
  return dispatchIngest(
    input.documentId,
    input.collectionName,
    input.storageKey,
    input.organizationId,
    input.storageBucket,
    input.folderPath ?? null,
    {
      fileName: row.filename,
      provenance: input.provenance ?? null,
      priority: input.priority,
      revisionOf: input.revisionOf ?? null,
      revisionOfId: input.revisionOfId ?? null,
      documentType: input.documentType ?? null,
      mailThread: input.mailThread ?? null,
      mailOrigin: input.mailOrigin ?? null,
    }
  )
}

export function mayBeIndexed(
  row: Pick<Document, 'authoredBy' | 'publishedVersionId'>,
  versionId: string | null
): boolean {
  if (row.authoredBy === 'user') return true
  return Boolean(row.publishedVersionId) && row.publishedVersionId === versionId
}

function jobPriorityOf(priority: IngestPriority | undefined): BffJobPriority {
  return BFF_JOB_PRIORITY[priority ?? 'interactive']
}

function documentWorkPayload(input: DispatchDocumentInput) {
  return {
    projectId: input.projectId,
    documentId: input.documentId,
    filename: input.filename,
    storageKey: input.storageKey,
    storageBucket: input.storageBucket,
    collectionName: input.collectionName,
    folderPath: input.folderPath ?? null,
    versionId: input.versionId ?? null,
    priority: input.priority ?? ('interactive' as const),
  }
}

async function queueDocumentWork(
  kind: 'bim_extract' | 'office_rendition',
  input: DispatchDocumentInput,
  payload: Record<string, unknown>
): Promise<DispatchDocumentResult> {
  try {
    await withTenant({ organizationId: input.organizationId }, async () => {
      const matching = { documentId: input.documentId, storageKey: input.storageKey }
      const open = await findOpenJobId({ kind, organizationId: input.organizationId, matching })
      const jobId =
        open ??
        (
          await enqueueJob({
            kind,
            organizationId: input.organizationId,
            priority: jobPriorityOf(input.priority),
            payload,
          })
        ).jobId
      await setDocumentBackgroundJob(input.documentId, input.organizationId, jobId)
    })
    return { jobId: null, status: 'processing' }
  } catch (error) {
    console.warn(
      `[documents] ${kind} could not be queued:`,
      error instanceof Error ? error.message : String(error)
    )
    await markDocumentIngestFailed(input.documentId, input.organizationId, INGEST_DISPATCH_FAILED_MESSAGE).catch(
      () => undefined
    )
    return { jobId: null, status: 'failed' }
  }
}

export async function beginModelExtraction(input: BeginModelExtractionInput): Promise<DispatchDocumentResult> {
  await markDocumentProcessing(input.documentId, input.organizationId)
  return queueDocumentWork('bim_extract', input, documentWorkPayload(input))
}

export async function beginRenditionIngest(
  input: DispatchDocumentInput,
  fileName: string
): Promise<DispatchDocumentResult> {
  await markDocumentProcessing(input.documentId, input.organizationId)
  return queueDocumentWork('office_rendition', input, {
    ...documentWorkPayload(input),
    fileName,
    provenance: input.provenance ?? null,
    revisionOf: input.revisionOf ?? null,
    revisionOfId: input.revisionOfId ?? null,
    documentType: input.documentType ?? null,
    mailThread: input.mailThread ?? null,
    mailOrigin: input.mailOrigin ?? null,
  })
}
