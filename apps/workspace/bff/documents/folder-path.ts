import type { Document } from '@/lib/db/schema/documents'
import { documentShelf, type DocumentShelf } from './shelf'
import { findFolderPathInOfficeShelf, findFolderPathInProject } from './repository'

export function resolveShelfFolderPath(
  shelf: DocumentShelf,
  folderId: string,
  organizationId: string,
): Promise<string | null> {
  return shelf.kind === 'project'
    ? findFolderPathInProject(folderId, shelf.projectId, organizationId)
    : findFolderPathInOfficeShelf(folderId, organizationId)
}

export async function resolveDocumentFolderPath(
  doc: Pick<Document, 'folderId' | 'projectId' | 'scope'>,
  organizationId: string,
): Promise<string | null> {
  const shelf = documentShelf(doc)
  if (!doc.folderId || !shelf) return null
  return resolveShelfFolderPath(shelf, doc.folderId, organizationId)
}
