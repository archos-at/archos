import 'server-only'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { s3Client, bucketAdminS3Client, buildOfficeShelfStorageKey, buildStorageKey } from '@/lib/s3'
import { ensureTenantBucketChecked } from '@/lib/storage/bucket'
import { ConflictError, NotFoundError } from '@/lib/api/errors'
import { folderReadOnlyError, getProjectFolderAccess } from '@/lib/authz/folder-access'
import { assertIfcMayBeFiledIn } from '@/lib/projects/ifc-folder-guard'
import { acceptedUploadBatchId } from '@/lib/upload-batches/service'
import { auditScreeningOverride, type NameGateResult } from '@/lib/upload-screening/service'
import { assertMayReplaceHeld } from '@/lib/upload-screening/quarantine-reviewers'
import { recordAuditEvent } from '@/lib/audit/service'
import { admitOrDiscard, admitReplacementOrDiscard } from '@/lib/storage/admission'
import { publishShelfChanged } from './shelf-live'
import { announceDocumentUploaded } from '@/lib/analytics/ingest-events'
import type { AuthorizedSession } from '@/lib/auth/types'
import { contentDigest } from './content-digest'
import { documentReadFamily } from './document-status'
import { nextVersionNumber, recordUploadedVersionOrDiscard } from './lifecycle'
import { resolveRevisionOf, type RevisionOfIgnoredReason } from './revision-upload'
import { documentNameKey } from './name-match'
import { NAME_TAKEN_DETAILS, nameTakenMessage } from './name-taken'
import { normalizeOriginPath, sanitizeOriginPath } from './origin-path'
import { resolveShelfFolderPath } from './folder-path'
import { findLiveDocumentByFilename, findProjectCollectionsHoldingFilename } from './repository'
import { retryRacedUpload } from './unique-conflicts'
import { newVersionWriteId, versionWriteKey } from './version-content'
import { shelfOwner, type DocumentShelf } from './shelf'
import type { IngestPriority } from './ingest-dispatch'
import { requireShelfWrite } from './shelf-authz'
import { admitUpload } from './upload-admission'
import { storedContentType } from './preview-types'
import { shelfCollectionName } from './shelf-collection'
import type { DispatchDocumentResult } from './document-dispatch'
import type { DocumentTypeTag } from './tag-vocabulary'
import type { MailOriginIngestFacts, MailThreadIngestFacts } from '@/lib/mail-thread/ingest-facts'

export interface ShelfUploadInput {
  beforeDispatch?: (documentId: string) => Promise<void>
  file: File
  folderId: string | null
  originPath?: string | null
  screeningRelease?: boolean
  uploadBatchId?: string | null
  revisionOf?: string | null
  priority?: IngestPriority
  documentType?: DocumentTypeTag
  mailThread?: MailThreadIngestFacts
  mailOrigin?: MailOriginIngestFacts
}

export interface UploadDocumentResult {
  documentId: string
  jobId: string | null
  status: DispatchDocumentResult['status']
  filename: string
  unchanged?: true
  revisionOfIgnored?: RevisionOfIgnoredReason
}

function uploadStorageKey(
  shelf: DocumentShelf,
  organizationId: string,
  documentId: string,
  filename: string,
  folderPath: string | null,
): string {
  return shelf.kind === 'project'
    ? buildStorageKey(organizationId, shelf.projectId, documentId, filename, folderPath)
    : buildOfficeShelfStorageKey(organizationId, documentId, filename, folderPath)
}

async function uploadAuditEvent(
  session: AuthorizedSession,
  shelf: DocumentShelf,
  request: Request,
  event: {
    documentId: string
    filename: string
    fileSize: number
    collectionName: string
    folderId: string | null
    replaced: boolean
    revisionOf: string | null
    revisionOfIgnored: RevisionOfIgnoredReason | null
  },
): Promise<void> {
  const located =
    shelf.kind === 'project' ? { projectId: shelf.projectId } : { collectionName: event.collectionName }
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: shelf.kind === 'project' ? 'document.uploaded' : 'office_shelf.document.uploaded',
    targetType: 'document',
    targetId: event.documentId,
    filedIn: shelf.kind === 'project' ? { projectId: shelf.projectId, folderId: event.folderId } : null,
    metadata: {
      ...located,
      filename: event.filename.slice(0, 200),
      fileSize: event.fileSize,
      ...(event.replaced ? { replaced: true } : {}),
      ...(event.revisionOf ? { revisionOf: event.revisionOf.slice(0, 200) } : {}),
      ...(event.revisionOfIgnored ? { revisionOfIgnored: event.revisionOfIgnored } : {}),
    },
    request,
  })
}

interface PlaceUploadInput {
  shelf: DocumentShelf
  collectionName: string
  filename: string
  folderId: string | null
  folderPath: string | null
  originPath: string | null
  file: File
  bytes: Buffer
  contentHash: string
  storageBucket: string
  uploadBatchId: string | null
  revisionOf: string | null
  revisionOfId: string | null
  revisionOfIgnored: RevisionOfIgnoredReason | null
  mayWriteFolder: (folderId: string | null) => boolean
  screeningOverridden: NameGateResult['overridden']
}

type Placed =
  | { unchanged: true; documentId: string }
  | { unchanged: false; documentId: string; storageKey: string; replaced: boolean }

function placeUpload(session: AuthorizedSession, input: PlaceUploadInput): Promise<Placed> {
  const { shelf, collectionName, filename, folderId, file, contentHash, storageBucket } = input
  return retryRacedUpload(async (): Promise<Placed> => {
    const superseded = await findLiveDocumentByFilename(session.organizationId, collectionName, filename)
    if (superseded && !input.mayWriteFolder(superseded.folderId ?? null)) throw folderReadOnlyError()
    if (superseded) await assertMayReplaceHeld(session, superseded, filename)
    const documentId = superseded?.id ?? crypto.randomUUID()
    const baseKey = uploadStorageKey(shelf, session.organizationId, documentId, filename, input.folderPath)
    const storageKey = superseded
      ? versionWriteKey(baseKey, await nextVersionNumber(documentId, session.organizationId), newVersionWriteId())
      : baseKey

    if (
      superseded &&
      superseded.contentHash === contentHash &&
      documentReadFamily(superseded.status) === 'readable' &&
      (superseded.folderId ?? null) === (folderId ?? null)
    ) {
      return { unchanged: true, documentId }
    }

    await s3Client.send(
      new PutObjectCommand({
        Bucket: storageBucket,
        Key: storageKey,
        Body: input.bytes,
        ContentType: storedContentType(file) ?? 'application/octet-stream',
      }),
    )

    await admitRow(session, input, { superseded: Boolean(superseded), documentId, storageKey })
    return { unchanged: false, documentId, storageKey, replaced: Boolean(superseded) }
  })
}

async function admitRow(
  session: AuthorizedSession,
  input: PlaceUploadInput,
  placed: { superseded: boolean; documentId: string; storageKey: string },
): Promise<void> {
  const { file, storageBucket, contentHash, folderId } = input
  const { documentId, storageKey } = placed
  if (placed.superseded) {
    await admitReplacementOrDiscard(storageBucket, storageKey, session.organizationId, documentId, {
      storageKey,
      storageBucket,
      fileSize: file.size,
      contentType: storedContentType(file),
      contentHash,
      folderId: folderId ?? null,
      createdBy: session.userId,
      uploadBatchId: input.uploadBatchId,
    })
    publishShelfChanged(session.organizationId, input.shelf)
    return
  }
  await admitOrDiscard(storageBucket, storageKey, {
    id: documentId,
    ...shelfOwner(input.shelf, session.organizationId),
    folderId: folderId ?? null,
    createdBy: session.userId,
    filename: input.filename,
    storageKey,
    storageBucket,
    collectionName: input.collectionName,
    fileSize: file.size,
    contentType: storedContentType(file),
    contentHash,
    originPath: input.originPath,
    uploadBatchId: input.uploadBatchId,
    status: 'uploaded',
  })
}

async function prepareUpload(
  session: AuthorizedSession,
  shelf: DocumentShelf,
  input: ShelfUploadInput,
): Promise<PlaceUploadInput> {
  const { file, folderId } = input

  await requireShelfWrite(session, shelf)
  const shelfCollection = await shelfCollectionName(shelf, session.organizationId)
  if (!shelfCollection) throw new NotFoundError('Project not found')
  const gate = await projectFolderGate(session, shelf, folderId, file.name, shelfCollection)
  const collectionName = gate.collectionName

  let folderPath: string | null = null
  if (folderId) {
    folderPath = await resolveShelfFolderPath(shelf, folderId, session.organizationId)
    if (folderPath === null) {
      throw new NotFoundError(`Folder not found in ${shelf.kind === 'project' ? 'project' : 'Archiv'}`)
    }
  }
  const originPath = sanitizeOriginPath(input.originPath)
  const nameGate = await admitUpload(session, {
    filename: file.name,
    size: file.size,
    originPath: normalizeOriginPath(input.originPath),
    folderPath,
    projectId: shelf.kind === 'project' ? shelf.projectId : null,
    screeningRelease: input.screeningRelease === true,
  })
  const uploadBatchId = await acceptedUploadBatchId(session, input.uploadBatchId, shelfOwner(shelf, session.organizationId))
  const filename = documentNameKey(file.name)
  if (shelf.kind === 'project') {
    await assertNameFreeElsewhereInProject(session.organizationId, shelf.projectId, collectionName, filename)
  }
  const revision = await resolveRevisionOf(session, input.revisionOf, { shelf, collectionName, filename })

  const storageBucket = await ensureTenantBucketChecked(bucketAdminS3Client, session.organizationId)

  const bytes = Buffer.from(await file.arrayBuffer())
  return {
    shelf,
    collectionName,
    filename,
    folderId,
    folderPath,
    originPath,
    file,
    bytes,
    contentHash: contentDigest(bytes),
    storageBucket,
    uploadBatchId,
    revisionOf: revision.revisionOf,
    revisionOfId: revision.revisionOf ? (input.revisionOf ?? null) : null,
    revisionOfIgnored: revision.ignored,
    mayWriteFolder: gate.mayWriteFolder,
    screeningOverridden: nameGate.overridden,
  }
}

interface FolderGate {
  collectionName: string
  mayWriteFolder: (folderId: string | null) => boolean
}

async function projectFolderGate(
  session: AuthorizedSession,
  shelf: DocumentShelf,
  folderId: string | null,
  fileName: string,
  shelfCollection: string,
): Promise<FolderGate> {
  if (shelf.kind !== 'project') return { collectionName: shelfCollection, mayWriteFolder: () => true }
  const access = await getProjectFolderAccess(session, shelf.projectId, shelfCollection)
  if (!access.isVisible(folderId)) throw new NotFoundError('Folder not found in project')
  if (access.levelOf(folderId) !== 'write') throw folderReadOnlyError()
  const collectionName = access.collectionFor(folderId)
  assertIfcMayBeFiledIn(fileName, collectionName, shelfCollection)
  return { collectionName, mayWriteFolder: (id) => access.levelOf(id) === 'write' }
}

async function assertNameFreeElsewhereInProject(
  organizationId: string,
  projectId: string,
  collectionName: string,
  filename: string,
): Promise<void> {
  const holders = await findProjectCollectionsHoldingFilename(organizationId, projectId, filename)
  if (holders.some((holder) => holder !== collectionName)) {
    throw new ConflictError(nameTakenMessage(filename), NAME_TAKEN_DETAILS)
  }
}

export async function uploadToShelf(
  session: AuthorizedSession,
  shelf: DocumentShelf,
  input: ShelfUploadInput,
  request: Request,
): Promise<UploadDocumentResult> {
  const { dispatchDocument } = await import('./document-dispatch')
  const upload = await prepareUpload(session, shelf, input)
  const { file, filename, collectionName, folderPath, storageBucket, contentHash } = upload

  const ignored = upload.revisionOfIgnored ? { revisionOfIgnored: upload.revisionOfIgnored } : {}
  const placed = await placeUpload(session, upload)
  if (placed.unchanged) {
    return { documentId: placed.documentId, jobId: null, status: 'uploaded', filename, unchanged: true, ...ignored }
  }
  const { documentId, storageKey } = placed

  await recordUploadedVersionOrDiscard(session, documentId, request, {
    storageKey,
    storageBucket,
    contentType: storedContentType(file),
    fileSize: file.size,
    contentHash,
  })

  await input.beforeDispatch?.(documentId)
  const { jobId, status } = await dispatchDocument({
    organizationId: session.organizationId,
    projectId: shelf.kind === 'project' ? shelf.projectId : null,
    documentId,
    filename,
    storageKey,
    storageBucket,
    collectionName,
    folderPath,
    priority: input.priority,
    revisionOf: upload.revisionOf,
    revisionOfId: upload.revisionOfId,
    documentType: input.documentType,
    mailThread: input.mailThread,
    mailOrigin: input.mailOrigin,
  })

  announceDocumentUploaded(session.organizationId, session.userId, {
    source: input.priority === 'bulk' ? 'mail' : 'web',
    filename,
    documentId,
    uploadId: upload.uploadBatchId,
    replaced: placed.replaced,
  })

  await uploadAuditEvent(session, shelf, request, {
    documentId,
    filename,
    fileSize: file.size,
    collectionName,
    folderId: upload.folderId,
    replaced: placed.replaced,
    revisionOf: upload.revisionOfId,
    revisionOfIgnored: upload.revisionOfIgnored,
  })
  await auditScreeningOverride(
    session,
    {
      documentId,
      projectId: shelf.kind === 'project' ? shelf.projectId : null,
      folderId: upload.folderId,
      filename,
      overridden: upload.screeningOverridden,
    },
    request,
  )

  return { documentId, jobId, status, filename, ...ignored }
}
