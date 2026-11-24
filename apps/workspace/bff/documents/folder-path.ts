import type { Document } from '@/lib/db/schema/documents'
import { documentShelf, type DocumentShelf } from './shelf'
import { findFolderPathInOfficeShelf, findFolderPathInProject, findFolderPathOnShelf } from './repository'

export function resolveShelfFolderPath(
  shelf: DocumentShelf,
  folderId: string,
  organizationId: string,
): Promise<string | null> {
  switch (shelf.kind) {
    case 'project':
      return findFolderPathInProject(folderId, shelf.projectId, organizationId)
    case 'office_shelf':
      return findFolderPathInOfficeShelf(folderId, organizationId)
    case 'personal':
      return findFolderPathOnShelf(shelf, folderId, organizationId)
  }
}

export async function resolveDocumentFolderPath(
  doc: Pick<Document, 'folderId' | 'projectId' | 'scope' | 'ownerUserId'>,
  organizationId: string,
): Promise<string | null> {
  const shelf = documentShelf(doc)
  if (!doc.folderId || !shelf) return null
  return resolveShelfFolderPath(shelf, doc.folderId, organizationId)
}
