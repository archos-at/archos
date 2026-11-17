import { auditScreeningOverride } from '@/lib/upload-screening/service'
import { normalizeOriginPath } from '@/lib/documents/origin-path'
import { assertMayReplaceHeld, shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { acceptedUploadBatchId } from '@/lib/upload-batches/service'
import { announceDocumentUploaded } from '@/lib/analytics/ingest-events'
import 'server-only'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { s3Client, bucketAdminS3Client, buildSessionStorageKey } from '@/lib/s3'
import { ensureTenantBucketChecked } from '@/lib/storage/bucket'
import { recordAuditEvent } from '@/lib/audit/service'
import { NotFoundError, UpstreamError } from '@/lib/api/errors'
import { sessionCollectionName } from '@/lib/retrieval-scope/collection-scope'
import { requireResourceAccess } from '@/lib/sharing/access'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import { assertConversationAcceptsUploads, createConversation } from '@/lib/conversations/service'
import { dispatchDocument, type DispatchDocumentResult } from '@/lib/documents/document-dispatch'
import { admitUpload } from '@/lib/documents/upload-admission'
import { admitOrDiscard, admitReplacementOrDiscard } from '@/lib/storage/admission'
import { contentDigest } from '@/lib/documents/content-digest'
import { documentNameKey } from '@/lib/documents/name-match'
import { reconcileDocumentStatuses, type DocumentMetadata } from '@/lib/documents/reconcile-status'
import { findLiveDocumentByFilename, type DocumentListRow } from '@/lib/documents/repository'
import { keepReadable } from '@/lib/documents/document-reader'
import { deleteDocumentObjects } from '@/lib/documents/object-cleanup'
import {
  nextVersionNumber,
  recordUploadedVersionOrDiscard,
} from '@/lib/documents/lifecycle'
import { newVersionWriteId, versionWriteKey } from '@/lib/documents/version-content'
import { retryRacedUpload } from '@/lib/documents/unique-conflicts'
import { listDocumentVersionObjects } from '@/lib/documents/version-repository'
import type { AuthorizedSession } from '@/lib/auth/types'
import { purgeCollectionChunks } from './cleanup'
import { collectionFileRef } from '@/lib/documents/collection-file-ref'
import { storedContentType } from '@/lib/documents/preview-types'
import { quarantineVerdictOf, type QuarantineVerdict } from '@/lib/upload-screening/quarantine'
import {
  deleteSessionDocument as deleteSessionDocumentRow,
  findSessionDocument,
  listSessionDocuments as listSessionDocumentRows,
  SESSION_DOCUMENT_LIST_LIMIT,
} from './repository'

export interface SessionDocumentListResult {
  documents: Array<
    Omit<
      DocumentListRow,
      'projectId' | 'scope' | 'metadata' | 'createdBy' | 'screeningOutcome' | 'screenedHash' | 'quarantine'
    > &
      DocumentMetadata & {
        quarantine: QuarantineVerdict | null
      }
  >
  collectionName: string
}

export async function listSessionDocuments(
  session: AuthorizedSession,
  conversationId: string,
): Promise<SessionDocumentListResult> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')

  const reader = await shelfReaderFor(session, { scope: 'session', projectId: null })
  const rows = await listSessionDocumentRows(conversationId, session.organizationId, reader, SESSION_DOCUMENT_LIST_LIMIT)
  const reconciled = keepReadable(await reconcileDocumentStatuses(rows, session.organizationId, 'read'), reader)

  return {
    documents: reconciled.map(
      ({
        metadata: _metadata,
        createdBy: _createdBy,
        projectId: _projectId,
        scope: _scope,
        screeningOutcome: _screening,
        screenedHash: _screened,
        quarantine,
        ...row
      }) => ({ ...row, quarantine: quarantineVerdictOf({ quarantine, errorMessage: row.errorMessage }) })
    ),
    collectionName: sessionCollectionName(conversationId),
  }
}

export interface UploadSessionDocumentInput {
  conversationId: string
  projectId?: string | null
  file: File
  screeningRelease?: boolean
  uploadBatchId?: string | null
  originPath?: string | null
}

export interface UploadSessionDocumentResult {
  documentId: string
  jobId: string | null
  status: DispatchDocumentResult['status']
  filename: string
  collectionName: string
}

export async function uploadSessionDocument(
  session: AuthorizedSession,
  input: UploadSessionDocumentInput,
  request: Request,
): Promise<UploadSessionDocumentResult> {
  const { conversationId, file } = input

  await createConversation(session, { id: conversationId, projectId: input.projectId ?? null })

  const nameGate = await admitUpload(session, {
    filename: file.name,
    size: file.size,
    originPath: normalizeOriginPath(input.originPath),
    screeningRelease: input.screeningRelease === true,
  })

  const collectionName = sessionCollectionName(conversationId)
  const uploadBatchId = await acceptedUploadBatchId(session, input.uploadBatchId, { scope: 'session', projectId: null })
  const filename = documentNameKey(file.name)
  const storageBucket = await ensureTenantBucketChecked(bucketAdminS3Client, session.organizationId)

  const bytes = Buffer.from(await file.arrayBuffer())
  const contentHash = contentDigest(bytes)

  const { documentId, storageKey, replaced } = await retryRacedUpload(async () => {
    const superseded = await findLiveDocumentByFilename(session.organizationId, collectionName, filename)
    if (superseded) await assertMayReplaceHeld(session, superseded, filename)
    const documentId = superseded?.id ?? crypto.randomUUID()
    const baseKey = buildSessionStorageKey(session.organizationId, conversationId, documentId, filename)
    const storageKey = superseded
      ? versionWriteKey(baseKey, await nextVersionNumber(documentId, session.organizationId), newVersionWriteId())
      : baseKey

    await assertConversationAcceptsUploads(conversationId, session.organizationId)

    await s3Client.send(
      new PutObjectCommand({
        Bucket: storageBucket,
        Key: storageKey,
        Body: bytes,
        ContentType: storedContentType(file) ?? 'application/octet-stream',
      }),
    )

    if (superseded) {
      await admitReplacementOrDiscard(storageBucket, storageKey, session.organizationId, documentId, {
        storageKey,
        storageBucket,
        fileSize: file.size,
        contentType: storedContentType(file),
        contentHash,
        folderId: null,
        createdBy: session.userId,
        uploadBatchId,
      })
    } else {
      await admitOrDiscard(storageBucket, storageKey, {
        id: documentId,
        organizationId: session.organizationId,
        projectId: null,
        scope: 'session',
        conversationId,
        folderId: null,
        createdBy: session.userId,
        filename,
        storageKey,
        storageBucket,
        collectionName,
        fileSize: file.size,
        contentType: storedContentType(file),
        contentHash,
        uploadBatchId,
        status: 'uploaded',
      })
    }
    return { documentId, storageKey, replaced: Boolean(superseded) }
  })

  await recordUploadedVersionOrDiscard(session, documentId, request, {
    storageKey,
    storageBucket,
    contentType: storedContentType(file),
    fileSize: file.size,
    contentHash,
  })

  const { jobId, status } = await dispatchDocument({
    organizationId: session.organizationId,
    projectId: null,
    documentId,
    filename,
    storageKey,
    storageBucket,
    collectionName,
  })

  announceDocumentUploaded(session.organizationId, session.userId, {
    source: 'chat',
    filename,
    documentId,
    uploadId: uploadBatchId,
    replaced,
  })

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'session.document.uploaded',
    targetType: 'document',
    targetId: documentId,
    metadata: {
      conversationId,
      filename: filename.slice(0, 200),
      fileSize: file.size,
      ...(replaced ? { replaced: true } : {}),
    },
    request,
  })
  await auditScreeningOverride(
    session,
    { documentId, projectId: null, folderId: null, filename, overridden: nameGate.overridden },
    request,
  )

  return { documentId, jobId, status, filename, collectionName }
}

export async function deleteSessionDocument(
  session: AuthorizedSession,
  documentId: string,
  request: Request,
): Promise<void> {
  const doc = await findSessionDocument(
    documentId,
    session.organizationId,
    await shelfReaderFor(session, { scope: 'session', projectId: null })
  )
  if (!doc?.conversationId) throw new NotFoundError()

  await requireResourceAccess(session, 'conversation', doc.conversationId, 'collaborator')
  await assertNoActiveHold(session.organizationId, 'document', documentId)

  const purgeRef = collectionFileRef(doc)
  const chunks = await purgeCollectionChunks(doc.collectionName, purgeRef ? [purgeRef] : [])
  for (const version of await listDocumentVersionObjects(documentId, session.organizationId)) {
    if (version.storageKey === doc.storageKey) continue
    await deleteDocumentObjects(version).catch(() => undefined)
  }
  const objects = await deleteDocumentObjects(doc)
  if (!chunks.ok || !objects.ok) {
    console.error(
      '[session-documents] delete aborted, row retained for retry:',
      documentId,
      [chunks.reason, objects.reason].filter(Boolean).join('; '),
    )
    throw new UpstreamError('Deleting the attachment failed; nothing was removed. Please try again.')
  }

  await deleteSessionDocumentRow(documentId, session.organizationId, doc.conversationId)

  if (purgeRef) {
    const again = await purgeCollectionChunks(doc.collectionName, [purgeRef])
    if (!again.ok) {
      console.warn('[session-documents] second chunk purge after the row delete failed:', documentId, again.reason)
    }
  }

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'session.document.deleted',
    targetType: 'document',
    targetId: documentId,
    metadata: {
      conversationId: doc.conversationId,
      filename: doc.filename.slice(0, 200),
      collectionName: doc.collectionName,
    },
    request,
  })
}
