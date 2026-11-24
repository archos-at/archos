import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { documents } from '@/lib/db/schema/documents'
import { projectFolders } from '@/lib/db/schema/project-folders'

export type DocumentShelf =
  | { kind: 'project'; projectId: string }
  | { kind: 'office_shelf' }
  | { kind: 'personal'; userId: string }

export type OfficeShelf = Extract<DocumentShelf, { kind: 'office_shelf' }>
export type PersonalShelf = Extract<DocumentShelf, { kind: 'personal' }>
export type ShelfKind = DocumentShelf['kind']
export type SharedShelf = Exclude<DocumentShelf, PersonalShelf>
export type ProjectShelf = Extract<DocumentShelf, { kind: 'project' }>

export const OFFICE_SHELF: OfficeShelf = { kind: 'office_shelf' }

export function projectShelf(projectId: string): ProjectShelf {
  return { kind: 'project', projectId }
}

export function personalShelf(userId: string): PersonalShelf {
  return { kind: 'personal', userId }
}

export function shelfScope(shelf: DocumentShelf): ShelfKind {
  return shelf.kind
}

export function shelfProjectId(shelf: DocumentShelf): string | null {
  return shelf.kind === 'project' ? shelf.projectId : null
}

export function shelfOwnerUserId(shelf: DocumentShelf): string | null {
  return shelf.kind === 'personal' ? shelf.userId : null
}

export function shelfKey(shelf: DocumentShelf): string {
  switch (shelf.kind) {
    case 'project':
      return `project:${shelf.projectId}`
    case 'office_shelf':
      return 'office_shelf'
    case 'personal':
      return `personal:${shelf.userId}`
  }
}

export function documentShelf(doc: {
  scope?: string
  projectId: string | null
  ownerUserId: string | null
}): DocumentShelf | null {
  if (doc.projectId) return projectShelf(doc.projectId)
  if (doc.scope === 'office_shelf') return OFFICE_SHELF
  if (doc.scope === 'personal' && doc.ownerUserId) return personalShelf(doc.ownerUserId)
  return null
}

export function binShelfOf(folder: { scope: string; projectId: string | null }): SharedShelf | null {
  if (folder.scope === 'project' && folder.projectId) return projectShelf(folder.projectId)
  if (folder.scope === 'office_shelf') return OFFICE_SHELF
  return null
}

export function shelfDocumentsOf(shelf: DocumentShelf, organizationId: string): SQL {
  return and(
    eq(documents.organizationId, organizationId),
    eq(documents.scope, shelfScope(shelf)),
    ...(shelf.kind === 'project' ? [eq(documents.projectId, shelf.projectId)] : []),
    ...(shelf.kind === 'personal' ? [eq(documents.ownerUserId, shelf.userId)] : []),
  ) as SQL
}

export function outsideTheBin(): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM project_folders bin_folder WHERE bin_folder.id = ${documents.folderId} AND bin_folder.deleted_at IS NOT NULL)`
}

export function shelfDocumentWhere(shelf: DocumentShelf, organizationId: string): SQL {
  return and(shelfDocumentsOf(shelf, organizationId), outsideTheBin()) as SQL
}

export function shelfFoldersOf(shelf: DocumentShelf, organizationId: string): SQL {
  return and(
    eq(projectFolders.organizationId, organizationId),
    eq(projectFolders.scope, shelfScope(shelf)),
    ...(shelf.kind === 'project' ? [eq(projectFolders.projectId, shelf.projectId)] : []),
    ...(shelf.kind === 'personal' ? [eq(projectFolders.ownerUserId, shelf.userId)] : []),
  ) as SQL
}

export function shelfFolderWhere(shelf: DocumentShelf, organizationId: string): SQL {
  return and(shelfFoldersOf(shelf, organizationId), isNull(projectFolders.deletedAt)) as SQL
}

export function shelfOwner(
  shelf: DocumentShelf,
  organizationId: string,
): { organizationId: string; scope: ShelfKind; projectId: string | null; ownerUserId: string | null } {
  return {
    organizationId,
    scope: shelfScope(shelf),
    projectId: shelfProjectId(shelf),
    ownerUserId: shelfOwnerUserId(shelf),
  }
}
