import 'server-only'
import { getHiddenFolderIds } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { AuthorizedSession } from '@/lib/auth/types'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { memberReader } from './document-reader'
import { requirePersonalShelfDoor } from './personal-shelf-door'
import { findDocumentsByIds } from './repository'
import { OFFICE_SHELF, personalShelf, projectShelf, type DocumentShelf } from './shelf'
import { toListedDocuments, type ListedDocument } from './shelf-listing'

async function resolveProjectDocumentsById(
  session: AuthorizedSession,
  projectId: string,
  ids: readonly string[]
): Promise<ListedDocument[]> {
  await requireProjectAccess(session, projectId, 'project:view')
  const reader = await shelfReaderFor(session, { scope: 'project', projectId })
  const rows = await findDocumentsByIds(projectShelf(projectId), session.organizationId, ids, {
    hiddenFolderIds: await getHiddenFolderIds(session, projectId),
    reader,
  })
  return toListedDocuments(session, rows, reader)
}

async function resolveOfficeShelfDocumentsById(session: AuthorizedSession, ids: readonly string[]): Promise<ListedDocument[]> {
  const reader = await shelfReaderFor(session, { scope: 'office_shelf', projectId: null })
  const rows = await findDocumentsByIds(OFFICE_SHELF, session.organizationId, ids, { reader })
  return toListedDocuments(session, rows, reader)
}

async function resolvePersonalShelfDocumentsById(session: AuthorizedSession, ids: readonly string[]): Promise<ListedDocument[]> {
  requirePersonalShelfDoor(session)
  const reader = memberReader(session.userId)
  const rows = await findDocumentsByIds(personalShelf(session.userId), session.organizationId, ids, { reader })
  return toListedDocuments(session, rows, reader)
}

export function resolveShelfDocumentsById(
  session: AuthorizedSession,
  shelf: DocumentShelf,
  ids: readonly string[]
): Promise<ListedDocument[]> {
  switch (shelf.kind) {
    case 'project':
      return resolveProjectDocumentsById(session, shelf.projectId, ids)
    case 'office_shelf':
      return resolveOfficeShelfDocumentsById(session, ids)
    case 'personal':
      return resolvePersonalShelfDocumentsById(session, ids)
  }
}
