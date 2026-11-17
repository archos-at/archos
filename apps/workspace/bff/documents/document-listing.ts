import 'server-only'
import { getHiddenFolderIds } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentAuthor } from '@/lib/db/schema/documents'
import { toListedDocuments, toListedLevelPage, type ListedDocument } from './shelf-listing'
import { projectShelf } from './shelf'
import type { DocumentLevelQuery } from './list-query'
import { listDocumentLevelPage, findProjectDocumentsByFilenames, findProjectDocumentsByNames, type DocumentNameMatchRow } from './repository'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'

export async function listDocumentsPage(
  session: AuthorizedSession,
  projectId: string,
  options: { authoredBy?: DocumentAuthor; includeArchived?: boolean; level: DocumentLevelQuery }
): Promise<{ documents: ListedDocument[]; nextCursor: string | null }> {
  await requireProjectAccess(session, projectId, 'project:view')
  const reader = await shelfReaderFor(session, { scope: 'project', projectId })
  const levelPage = await listDocumentLevelPage(projectShelf(projectId), session.organizationId, {
    hiddenFolderIds: await getHiddenFolderIds(session, projectId),
    reader,
    authoredBy: options.authoredBy,
    includeArchived: options.includeArchived,
    level: options.level,
  })
  return toListedLevelPage(session, levelPage, reader)
}

export async function resolveProjectDocumentsByName(
  session: AuthorizedSession,
  projectId: string,
  filenames: readonly string[]
): Promise<ListedDocument[]> {
  await requireProjectAccess(session, projectId, 'project:view')
  const reader = await shelfReaderFor(session, { scope: 'project', projectId })
  const rows = await findProjectDocumentsByFilenames(projectId, session.organizationId, filenames, {
    hiddenFolderIds: await getHiddenFolderIds(session, projectId),
    reader,
  })
  return toListedDocuments(session, rows, reader)
}

export async function probeProjectDocumentNames(
  session: AuthorizedSession,
  projectId: string,
  names: readonly string[]
): Promise<DocumentNameMatchRow[]> {
  await requireProjectAccess(session, projectId, 'project:view')
  return findProjectDocumentsByNames(projectId, session.organizationId, names, {
    hiddenFolderIds: await getHiddenFolderIds(session, projectId),
    reader: await shelfReaderFor(session, { scope: 'project', projectId }),
  })
}

export type { ListedDocument }
