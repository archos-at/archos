import 'server-only'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { recordAuditEvent } from '@/lib/audit/service'
import { getBackendUrl } from '@/lib/backend-proxy'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { collectionFileRef, purgeIngestedChunks } from '@/lib/documents/collection-file-ref'
import { OFFICE_SHELF } from '@/lib/documents/shelf'
import { publishShelfChanged } from '@/lib/documents/shelf-live'
import { toListedDocuments, toListedLevelPage, type ListedDocument } from '@/lib/documents/shelf-listing'
import { uploadToShelf, type ShelfUploadInput, type UploadDocumentResult } from '@/lib/documents/shelf-upload'
import type { DocumentLevelQuery } from '@/lib/documents/list-query'
import { findLiveDocumentByFilename, type DocumentNameMatchRow } from '@/lib/documents/repository'
import { documentNameKey } from '@/lib/documents/name-match'
import { NAME_TAKEN_DETAILS } from '@/lib/documents/name-taken'
import { revisionCandidatesOnShelf } from '@/lib/documents/revision-candidates'
import type { RevisionCandidateMatch } from '@/lib/documents/name-probe-types'
import { eraseDocumentObjectsOrKeepRow } from '@/lib/documents/object-cleanup'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import type { DocumentAuthor } from '@/lib/db/schema/documents'
import type { AuthorizedSession } from '@/lib/auth/types'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import type { ShelfReader } from '@/lib/documents/document-reader'
import { officeShelfCollectionName } from './collection'
import { officeShelfHiddenFolderIds } from './folder-service'
import { STANDARDS_FOLDER_NAME } from './standards-folder'
import {
  deleteOfficeShelfDocument as deleteOfficeShelfDocumentRow,
  findOfficeShelfDocument,
  findOfficeShelfDocumentsByFilenames,
  findOfficeShelfDocumentsByNames,
  listOfficeShelfDocumentLevel,
} from './repository'

const BACKEND_FETCH_TIMEOUT_MS = 10_000

export interface OfficeShelfListResult {
  documents: ListedDocument[]
  nextCursor: string | null
  collectionName: string
  canManage: boolean
}

function officeShelfReader(session: AuthorizedSession): Promise<ShelfReader> {
  return shelfReaderFor(session, { scope: 'office_shelf', projectId: null })
}

export async function listOfficeShelf(
  session: AuthorizedSession,
  {
    includeStandards = false,
    ...options
  }: { authoredBy?: DocumentAuthor; includeArchived?: boolean; includeStandards?: boolean; level: DocumentLevelQuery },
): Promise<OfficeShelfListResult> {
  const [reader, hiddenFolderIds] = await Promise.all([
    officeShelfReader(session),
    includeStandards ? [] : officeShelfHiddenFolderIds(session),
  ])
  const page = await listOfficeShelfDocumentLevel(session.organizationId, { ...options, hiddenFolderIds, reader })
  return {
    ...(await toListedLevelPage(session, page, reader)),
    collectionName: officeShelfCollectionName(session.organizationId),
    canManage: canManageOfficeShelf(session),
  }
}

export async function resolveOfficeShelfDocumentsByName(
  session: AuthorizedSession,
  filenames: readonly string[],
): Promise<ListedDocument[]> {
  const reader = await officeShelfReader(session)
  const rows = await findOfficeShelfDocumentsByFilenames(session.organizationId, filenames, { reader })
  return toListedDocuments(session, rows, reader)
}

export async function probeOfficeShelfDocumentNames(
  session: AuthorizedSession,
  names: readonly string[],
): Promise<DocumentNameMatchRow[]> {
  const [reader, hiddenFolderIds] = await Promise.all([officeShelfReader(session), officeShelfHiddenFolderIds(session)])
  return findOfficeShelfDocumentsByNames(session.organizationId, names, { hiddenFolderIds, reader })
}

export async function probeOfficeShelfRevisionCandidates(
  session: AuthorizedSession,
  names: readonly string[],
): Promise<RevisionCandidateMatch[]> {
  const [reader, hiddenFolderIds] = await Promise.all([officeShelfReader(session), officeShelfHiddenFolderIds(session)])
  return revisionCandidatesOnShelf(OFFICE_SHELF, session.organizationId, names, { hiddenFolderIds, reader })
}

export type UploadOfficeShelfDocumentResult = UploadDocumentResult

async function assertNameFreeOfStandards(session: AuthorizedSession, file: File, folderId: string | null): Promise<void> {
  const hidden = await officeShelfHiddenFolderIds(session)
  if (hidden.length === 0 || (folderId !== null && hidden.includes(folderId))) return
  const filename = documentNameKey(file.name)
  const holder = await findLiveDocumentByFilename(session.organizationId, officeShelfCollectionName(session.organizationId), filename)
  if (holder?.folderId && hidden.includes(holder.folderId)) {
    throw new ConflictError(
      `A document named "${filename}" is already filed under ${STANDARDS_FOLDER_NAME}. Rename the file to upload it here.`,
      NAME_TAKEN_DETAILS,
    )
  }
}

export async function uploadOfficeShelfDocument(
  session: AuthorizedSession,
  file: File,
  request: Request,
  {
    folderId = null,
    originPath = null,
    screeningRelease,
    uploadBatchId,
    revisionOf,
    beforeDispatch,
  }: Omit<ShelfUploadInput, 'file' | 'folderId'> & { folderId?: string | null } = {},
): Promise<UploadOfficeShelfDocumentResult> {
  await assertNameFreeOfStandards(session, file, folderId)
  return uploadToShelf(
    session,
    OFFICE_SHELF,
    { file, folderId, originPath, screeningRelease, uploadBatchId, revisionOf, beforeDispatch },
    request,
  )
}

export interface OfficeShelfRemoval {
  database: 'removed'
  search: 'removed' | 'failed' | 'none'
  objects: 'removed' | 'partial'
}

export async function deleteOfficeShelfDocument(
  session: AuthorizedSession,
  documentId: string,
  request: Request,
): Promise<OfficeShelfRemoval> {
  if (!canManageOfficeShelf(session)) throw new ForbiddenError()

  const doc = await findOfficeShelfDocument(documentId, session.organizationId, await officeShelfReader(session))
  if (!doc) throw new NotFoundError()
  await assertNoActiveHold(session.organizationId, 'document', documentId)

  // Purging by bare filename once deleted a human document's chunks; collectionFileRef returns null for a row that owns none.
  const purgeRef = collectionFileRef(doc)
  const chunksPurged = purgeRef
    ? // Permanent: the document is gone, and its Fassung links with it (ADR-0099).
      await purgeIngestedChunks(getBackendUrl(), purgeRef, BACKEND_FETCH_TIMEOUT_MS, { permanent: true })
    : null

  const { versionsLeft } = await eraseDocumentObjectsOrKeepRow(doc, session.organizationId)

  await deleteOfficeShelfDocumentRow(documentId, session.organizationId)
  publishShelfChanged(session.organizationId, OFFICE_SHELF)

  const purgedAgain = purgeRef
    ? await purgeIngestedChunks(getBackendUrl(), purgeRef, BACKEND_FETCH_TIMEOUT_MS, { permanent: true })
    : null

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'office_shelf.document.deleted',
    targetType: 'document',
    targetId: documentId,
    metadata: { filename: doc.filename.slice(0, 200), collectionName: doc.collectionName, chunksPurged, purgedAgain },
    request,
  })
  const search = purgeRef ? (purgedAgain ? 'removed' : 'failed') : 'none'
  return { database: 'removed', search, objects: versionsLeft > 0 ? 'partial' : 'removed' }
}
