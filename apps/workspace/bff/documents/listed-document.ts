import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getHiddenFolderIds } from '@/lib/authz/folder-access'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { getAccessibleDocument } from './access'
import { findShelfDocumentListRow } from './repository'
import { documentShelf } from './shelf'
import { toListedDocuments, type ListedDocument } from './shelf-listing'

export async function getListedDocument(
  session: AuthorizedSession,
  documentId: string,
): Promise<ListedDocument & { projectId: string | null }> {
  const doc = await getAccessibleDocument(session, documentId)
  const shelf = documentShelf(doc)
  if (!shelf) throw new NotFoundError()
  const reader = await shelfReaderFor(session, doc)
  const row = await findShelfDocumentListRow(shelf, session.organizationId, documentId, {
    hiddenFolderIds: shelf.kind === 'project' ? await getHiddenFolderIds(session, shelf.projectId) : undefined,
    reader,
    includeArchived: true,
  })
  if (!row) throw new NotFoundError()
  const [listed] = await toListedDocuments(session, [row], reader)
  if (!listed) throw new NotFoundError()
  return { ...listed, projectId: shelf.kind === 'project' ? shelf.projectId : null }
}
