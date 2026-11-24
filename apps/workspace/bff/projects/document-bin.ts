import 'server-only'
import { BadRequestError, ConflictError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import { getDb } from '@/lib/db'
import type { Document } from '@/lib/db/schema/documents'
import { withTenant } from '@/lib/db/tenant-context'
import { findDocumentForSession } from '@/lib/documents/access'
import { documentDisplayName } from '@/lib/documents/display-name'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { documentShelf, type SharedShelf } from '@/lib/documents/shelf'
import { FOLDER_NAME_TAKEN } from '@/lib/documents/shelf-folders'
import { publishShelfChanged } from '@/lib/documents/shelf-live'
import { binPolicyOf } from './bin-shelf'
import { deleteEmptyCreatedFolder } from './cleanup-repository'
import { moveFolderToBin, restoreFolderFromBin } from './folder-bin'
import { findActiveBinEntry, findFolderInOrg, type FolderBinPayload } from './folder-bin-repository'
import {
  BINNED_WITH_FOLDER_REASON,
  DOCUMENT_HAS_NO_BIN_REASON,
  type DocumentBinResult,
  type DocumentRestoreResult,
} from './folder-bin-wire'
import { normalizeFolderName, validateFolderName } from './folders'

export const DOCUMENT_NOT_IN_BIN_REASON = 'document-not-in-bin'

const HOLDER_NAME_MAX = 110

async function shelfDocumentFor(session: AuthorizedSession, documentId: string): Promise<{ doc: Document; shelf: SharedShelf }> {
  const doc = await findDocumentForSession(session, documentId)
  if (!doc) throw new NotFoundError('Document not found')
  const shelf = documentShelf(doc)
  if (!shelf || shelf.kind === 'personal') {
    throw new ConflictError('Only a project or office shelf document can go to the bin; this one is deleted permanently.', {
      reason: DOCUMENT_HAS_NO_BIN_REASON,
    })
  }
  return { doc, shelf }
}

async function folderOf(organizationId: string, shelf: SharedShelf, folderId: string | null) {
  if (!folderId) return null
  return withTenant({ organizationId }, () => findFolderInOrg(getDb(), shelf, organizationId, folderId))
}

function holderName(documentName: string, attempt: number): string {
  const base = normalizeFolderName(documentName).slice(0, HOLDER_NAME_MAX).trim()
  const named = attempt === 1 ? base : `${base} (${attempt})`
  const checked = validateFolderName(named)
  return checked.ok && checked.name ? checked.name : `${attempt}`
}

async function makeHolder(session: AuthorizedSession, shelf: SharedShelf, parentId: string | null, documentName: string) {
  const policy = binPolicyOf(shelf)
  for (let attempt = 1; attempt <= 20; attempt++) {
    const created = await policy.createHolder(session, parentId, holderName(documentName, attempt))
    if (created.ok) return created.folder
    if (created.error !== FOLDER_NAME_TAKEN) throw new BadRequestError(created.error)
  }
  throw new ConflictError('Could not name the folder that takes the document to the bin.')
}

export async function moveDocumentToBin(
  session: AuthorizedSession,
  documentId: string,
  request?: Request
): Promise<DocumentBinResult> {
  const { doc, shelf } = await shelfDocumentFor(session, documentId)
  await binPolicyOf(shelf).assertMayBinDocument(session, doc)
  await assertNoActiveHold(session.organizationId, 'document', documentId)
  const current = await folderOf(session.organizationId, shelf, doc.folderId)
  if (current?.deletedAt) throw new ConflictError('This document is already in the bin.')

  const holder = await makeHolder(session, shelf, doc.folderId, documentDisplayName(doc))
  let moved = false
  try {
    const into = await moveDocumentToFolder({ documentId, folderId: holder.id, expectedFolderId: doc.folderId }, session)
    if (!into.ok) throw new BadRequestError(into.error)
    moved = true
    const binned = await moveFolderToBin(session, { shelf, folderId: holder.id }, request, {
      onlyDocuments: [documentId],
      documentId,
    })
    return { documentId, binEntryId: holder.id, purgeAfter: binned.purgeAfter.toISOString() }
  } catch (error) {
    await undoBin(session, shelf, documentId, doc.folderId, holder.id, moved)
    throw error
  }
}

async function undoBin(
  session: AuthorizedSession,
  shelf: SharedShelf,
  documentId: string,
  folderId: string | null,
  holderId: string,
  moved: boolean
): Promise<void> {
  try {
    if (moved) {
      const back = await moveDocumentToFolder({ documentId, folderId, expectedFolderId: holderId }, session)
      if (!back.ok) throw new Error(back.error)
    }
    if (await deleteEmptyCreatedFolder(session.organizationId, shelf, holderId)) {
      publishShelfChanged(session.organizationId, shelf, { folders: true })
    }
  } catch (error) {
    console.error(`[document-bin] undoing a failed bin of ${documentId} on ${shelf.kind} failed`, error)
  }
}

export async function restoreDocumentFromBin(
  session: AuthorizedSession,
  documentId: string,
  request?: Request
): Promise<DocumentRestoreResult> {
  const { doc, shelf } = await shelfDocumentFor(session, documentId)
  const holder = await folderOf(session.organizationId, shelf, doc.folderId)
  if (!holder?.deletedAt || holder.purgedAt) {
    throw new ConflictError('This document is not in the bin.', { reason: DOCUMENT_NOT_IN_BIN_REASON })
  }
  const rootId = holder.binRootId ?? holder.id
  const entry = await withTenant({ organizationId: session.organizationId }, () =>
    findActiveBinEntry(getDb(), session.organizationId, rootId)
  )
  const payload = (entry?.payload ?? null) as Partial<FolderBinPayload> | null
  if (rootId !== holder.id || payload?.documentId !== documentId) {
    throw new ConflictError('This document went to the bin with its folder; restore the folder instead.', {
      reason: BINNED_WITH_FOLDER_REASON,
      folderId: rootId,
    })
  }

  const { restoredTo } = await restoreFolderFromBin(session, { shelf, folderId: holder.id }, request)
  const target = restoredTo === 'root' ? null : holder.parentId
  const back = await moveDocumentToFolder({ documentId, folderId: target, expectedFolderId: holder.id }, session)
  if (!back.ok) throw new BadRequestError(back.error)
  if (await deleteEmptyCreatedFolder(session.organizationId, shelf, holder.id)) {
    publishShelfChanged(session.organizationId, shelf, { folders: true })
  }
  return { documentId, folderId: target, restoredTo }
}
