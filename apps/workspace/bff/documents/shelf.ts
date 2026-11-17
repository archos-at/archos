import { and, eq, isNull, type SQL } from 'drizzle-orm'
import { documents } from '@/lib/db/schema/documents'
import { projectFolders } from '@/lib/db/schema/project-folders'

export type DocumentShelf = { kind: 'project'; projectId: string } | { kind: 'office_shelf' }

export type OfficeShelf = Extract<DocumentShelf, { kind: 'office_shelf' }>

export const OFFICE_SHELF: OfficeShelf = { kind: 'office_shelf' }

export function projectShelf(projectId: string): DocumentShelf {
  return { kind: 'project', projectId }
}

export function shelfScope(shelf: DocumentShelf): 'project' | 'office_shelf' {
  return shelf.kind
}

export function documentShelf(doc: {
  scope?: string
  projectId: string | null
}): DocumentShelf | null {
  if (doc.projectId) return projectShelf(doc.projectId)
  if (doc.scope === 'office_shelf') return OFFICE_SHELF
  return null
}

export function shelfDocumentWhere(shelf: DocumentShelf, organizationId: string): SQL {
  return and(
    eq(documents.organizationId, organizationId),
    eq(documents.scope, shelfScope(shelf)),
    ...(shelf.kind === 'project' ? [eq(documents.projectId, shelf.projectId)] : []),
  ) as SQL
}

export function shelfFolderWhere(shelf: DocumentShelf, organizationId: string): SQL {
  return and(
    eq(projectFolders.organizationId, organizationId),
    eq(projectFolders.scope, shelfScope(shelf)),
    isNull(projectFolders.deletedAt),
    ...(shelf.kind === 'project' ? [eq(projectFolders.projectId, shelf.projectId)] : []),
  ) as SQL
}

export function shelfOwner(
  shelf: DocumentShelf,
  organizationId: string,
): { organizationId: string; scope: 'project' | 'office_shelf'; projectId: string | null } {
  return {
    organizationId,
    scope: shelfScope(shelf),
    projectId: shelf.kind === 'project' ? shelf.projectId : null,
  }
}
