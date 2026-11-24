import 'server-only'
import { recordAuditEvent } from '@/lib/audit/service'
import { getBackendUrl } from '@/lib/backend-proxy'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import type { DocumentAuthor } from '@/lib/db/schema/documents'
import { collectionFileRef, purgeIngestedChunks } from '@/lib/documents/collection-file-ref'
import { memberReader, type ShelfReader } from '@/lib/documents/document-reader'
import type { DocumentLevelQuery } from '@/lib/documents/list-query'
import type { RevisionCandidateMatch } from '@/lib/documents/name-probe-types'
import { eraseDocumentObjectsOrKeepRow } from '@/lib/documents/object-cleanup'
import {
  findDocumentsByFilenames,
  findDocumentsByNames,
  listDocumentLevelPage,
  type DocumentNameMatchRow,
} from '@/lib/documents/repository'
import { revisionCandidatesOnShelf } from '@/lib/documents/revision-candidates'
import { personalShelf, type PersonalShelf } from '@/lib/documents/shelf'
import { publishShelfChanged } from '@/lib/documents/shelf-live'
import { toListedDocuments, toListedLevelPage, type ListedDocument } from '@/lib/documents/shelf-listing'
import { uploadToShelf, type ShelfUploadInput, type UploadDocumentResult } from '@/lib/documents/shelf-upload'
import { personalShelfCollectionName } from './collection'
import { deletePersonalShelfDocumentRow, findPersonalShelfDocument } from './repository'

const BACKEND_FETCH_TIMEOUT_MS = 10_000

export interface PersonalShelfListResult {
  documents: ListedDocument[]
  nextCursor: string | null
  collectionName: string
  canManage: true
}

const ownShelf = (session: AuthorizedSession): PersonalShelf => personalShelf(session.userId)
const ownReader = (session: AuthorizedSession): ShelfReader => memberReader(session.userId)

export async function listPersonalShelf(
  session: AuthorizedSession,
  options: { authoredBy?: DocumentAuthor; includeArchived?: boolean; level: DocumentLevelQuery },
): Promise<PersonalShelfListResult> {
  const reader = ownReader(session)
  const page = await listDocumentLevelPage(ownShelf(session), session.organizationId, { ...options, reader })
  return {
    ...(await toListedLevelPage(session, page, reader)),
    collectionName: personalShelfCollectionName(session.organizationId, session.userId),
    canManage: true,
  }
}

export async function resolvePersonalShelfDocumentsByName(
  session: AuthorizedSession,
  filenames: readonly string[],
): Promise<ListedDocument[]> {
  const reader = ownReader(session)
  const rows = await findDocumentsByFilenames(ownShelf(session), session.organizationId, filenames, { reader })
  return toListedDocuments(session, rows, reader)
}

export function probePersonalShelfDocumentNames(
  session: AuthorizedSession,
  names: readonly string[],
): Promise<DocumentNameMatchRow[]> {
  return findDocumentsByNames(ownShelf(session), session.organizationId, names, { reader: ownReader(session) })
}

export function probePersonalShelfRevisionCandidates(
  session: AuthorizedSession,
  names: readonly string[],
): Promise<RevisionCandidateMatch[]> {
  return revisionCandidatesOnShelf(ownShelf(session), session.organizationId, names, { reader: ownReader(session) })
}

export interface PersonalShelfUploadInput extends Omit<ShelfUploadInput, 'file' | 'folderId'> {
  folderId?: string | null
}

export function uploadToPersonalShelf(
  session: AuthorizedSession,
  file: File,
  request: Request,
  { folderId = null, ...input }: PersonalShelfUploadInput = {},
): Promise<UploadDocumentResult> {
  return uploadToShelf(session, ownShelf(session), { ...input, file, folderId }, request)
}

export async function deletePersonalShelfDocument(
  session: AuthorizedSession,
  documentId: string,
  request: Request,
): Promise<void> {
  const doc = await findPersonalShelfDocument(documentId, session.organizationId, session.userId, ownReader(session))
  if (!doc) throw new NotFoundError()
  await assertNoActiveHold(session.organizationId, 'document', documentId)

  const purgeRef = collectionFileRef(doc)
  if (purgeRef) await purgeIngestedChunks(getBackendUrl(), purgeRef, BACKEND_FETCH_TIMEOUT_MS, { permanent: true })
  await eraseDocumentObjectsOrKeepRow(doc, session.organizationId)
  await deletePersonalShelfDocumentRow(documentId, session.organizationId, session.userId)
  publishShelfChanged(session.organizationId, ownShelf(session))
  if (purgeRef) await purgeIngestedChunks(getBackendUrl(), purgeRef, BACKEND_FETCH_TIMEOUT_MS, { permanent: true })

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'personal_shelf.document.deleted',
    targetType: 'document',
    targetId: documentId,
    metadata: {},
    request,
  })
}
