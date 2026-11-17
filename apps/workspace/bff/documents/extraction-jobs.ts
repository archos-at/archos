import 'server-only'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { presignForBackend } from '@/lib/s3'
import { resolveDocumentBucket } from '@/lib/storage/bucket'
import { findDocumentInOrg, markDocumentIngestFailed } from './repository'
import { runBimExtraction } from '@/lib/bim/service'
import type { BimExtractPayload, JobAttempt, OfficeRenditionPayload } from '@/lib/jobs-queue/types'
import { internalRead } from './document-reader'
import { projectShelf } from './shelf'
import { publishShelfChanged } from './shelf-live'
import { localWorkOwnsRow, type LocalWorkOwnership } from './local-work-ownership'
import { documentTypeOf } from './tag-vocabulary'
import { mailOriginIngestFactsSchema, mailThreadIngestFactsSchema } from '@/lib/mail-thread/ingest-facts'
import { RenditionFailedError, ensureRendition, extractsFromRendition } from './rendition'
import { type DispatchDocumentInput, mayBeIndexed } from './document-dispatch'
import {
  DRAWING_UNREADABLE_MESSAGE,
  INGEST_DISPATCH_FAILED_MESSAGE,
  INGEST_JOB_REF_TTL_SECONDS,
  RENDITION_REQUIRED_MESSAGE,
  dispatchIngest,
} from './ingest-dispatch'

export async function runBimExtractJob(
  organizationId: string,
  payload: BimExtractPayload,
  attempt: JobAttempt
): Promise<void> {
  const input = dispatchInputOf(organizationId, payload)
  if (!(await jobStillOwnsRow(input, attempt))) return

  await failRowOnLastAttempt(input, attempt, 'IFC extraction failed', async () => {
    const outcome = await runBimExtraction({
      organizationId,
      projectId: input.projectId,
      documentId: input.documentId,
      filename: input.filename,
      storageKey: input.storageKey,
      storageBucket: input.storageBucket,
      dispatchDigest: (digestStorageKey) =>
        dispatchIngest(
          input.documentId,
          input.collectionName,
          digestStorageKey,
          organizationId,
          input.storageBucket,
          input.folderPath ?? null,
          { priority: input.priority }
        ),
    })
    if (outcome.status === 'failed') {
      const reason = outcome.error ?? 'IFC extraction failed'
      await markDocumentIngestFailed(input.documentId, organizationId, reason, ownershipOf(input, attempt))
    }
    if (outcome.status === 'ready' && input.projectId) publishShelfChanged(organizationId, projectShelf(input.projectId))
  })
}

function dispatchInputOf(organizationId: string, payload: BimExtractPayload): DispatchDocumentInput {
  return {
    organizationId,
    projectId: payload.projectId,
    documentId: payload.documentId,
    filename: payload.filename,
    storageKey: payload.storageKey,
    storageBucket: payload.storageBucket,
    collectionName: payload.collectionName,
    folderPath: payload.folderPath ?? null,
    versionId: payload.versionId ?? null,
    priority: payload.priority,
  }
}

async function jobStillOwnsRow(input: DispatchDocumentInput, attempt: JobAttempt): Promise<boolean> {
  const row = await findDocumentInOrg(input.documentId, input.organizationId, internalRead('ingest'))
  if (!row) return false
  if (!localWorkOwnsRow(row, ownershipOf(input, attempt))) return false
  return mayBeIndexed(row, input.versionId ?? null)
}

function ownershipOf(input: DispatchDocumentInput, attempt: JobAttempt): LocalWorkOwnership {
  return { storageKey: input.storageKey, backgroundJobId: attempt.jobId ?? null, unnamedCounts: true }
}

async function failRowOnLastAttempt(
  input: DispatchDocumentInput,
  attempt: JobAttempt,
  message: string,
  work: () => Promise<void>
): Promise<void> {
  try {
    await work()
  } catch (error) {
    if (attempt.last) {
      await markDocumentIngestFailed(input.documentId, input.organizationId, message, ownershipOf(input, attempt)).catch(
        () => undefined
      )
    }
    throw error
  }
}

export async function runOfficeRenditionJob(
  organizationId: string,
  payload: OfficeRenditionPayload,
  attempt: JobAttempt
): Promise<void> {
  const input = {
    ...dispatchInputOf(organizationId, payload),
    provenance: payload.provenance ?? null,
    revisionOf: payload.revisionOf ?? payload.fassungOf ?? null,
    revisionOfId: payload.revisionOfId ?? null,
    documentType: documentTypeOf([payload.documentType ?? '']) ?? null,
    mailThread: mailThreadIngestFactsSchema.safeParse(payload.mailThread).data ?? null,
    mailOrigin: mailOriginIngestFactsSchema.safeParse(payload.mailOrigin).data ?? null,
  }
  if (!(await jobStillOwnsRow(input, attempt))) return

  await failRowOnLastAttempt(input, attempt, INGEST_DISPATCH_FAILED_MESSAGE, () =>
    ingestThroughRendition(input, payload.fileName, attempt)
  )
}

async function ingestThroughRendition(
  input: DispatchDocumentInput,
  fileName: string,
  attempt: JobAttempt
): Promise<void> {
  const { ref: renditionRef, refusedFile } = await signedRenditionRef(input, fileName)
  const indexesRendition = extractsFromRendition(fileName)
  if (indexesRendition && !renditionRef) {
    const message = refusedFile ? DRAWING_UNREADABLE_MESSAGE : RENDITION_REQUIRED_MESSAGE
    await markDocumentIngestFailed(input.documentId, input.organizationId, message, ownershipOf(input, attempt))
    return
  }
  await dispatchIngest(
    input.documentId,
    input.collectionName,
    input.storageKey,
    input.organizationId,
    input.storageBucket,
    input.folderPath ?? null,
    {
      fileName,
      provenance: input.provenance ?? null,
      previewRef: renditionRef,
      extractionRef: indexesRendition ? renditionRef : null,
      priority: input.priority,
      revisionOf: input.revisionOf ?? null,
      revisionOfId: input.revisionOfId ?? null,
      documentType: input.documentType ?? null,
      mailThread: input.mailThread ?? null,
      mailOrigin: input.mailOrigin ?? null,
    }
  )
}

async function signedRenditionRef(
  input: DispatchDocumentInput,
  fileName: string
): Promise<{ ref: string | null; refusedFile: boolean }> {
  const bucket = resolveDocumentBucket(input.storageBucket)
  try {
    const renditionKey = await ensureRendition({ bucket, storageKey: input.storageKey, filename: fileName })
    const ref = await presignForBackend(new GetObjectCommand({ Bucket: bucket, Key: renditionKey }), INGEST_JOB_REF_TTL_SECONDS)
    return { ref, refusedFile: false }
  } catch (error) {
    console.warn('[documents] rendition at ingest failed:', error instanceof Error ? error.message : String(error))
    return { ref: null, refusedFile: error instanceof RenditionFailedError && error.refusedFile }
  }
}
