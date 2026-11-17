import 'server-only'
import { ForbiddenError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { OFFICE_SHELF } from '@/lib/documents/shelf'
import { getOrCreateShelfRootFolder, type FolderRow } from '@/lib/documents/shelf-folders'
import { createOfficeShelfFolder, listOfficeShelfFolders } from '@/lib/office-shelf/folder-service'
import { isUnderStandardsRoot, STANDARDS_FOLDER_NAME } from '@/lib/office-shelf/standards-folder'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { FOLDER_PAGE, type BaseKnowledgeFolder, type BaseKnowledgeFolders, type CreateFolderBody, type ListFoldersQuery } from '../wire'

function toFolder(row: FolderRow): BaseKnowledgeFolder {
  return { id: row.id, parentId: row.parentId, name: row.name, path: row.path, description: row.description }
}

export async function standardsFolderRows(session: AuthorizedSession): Promise<{ root: FolderRow | null; folders: FolderRow[] }> {
  const rows = await listOfficeShelfFolders(session)
  const root = rows.find((row) => row.parentId === null && row.name === STANDARDS_FOLDER_NAME) ?? null
  return { root, folders: rows.filter((row) => row !== root && isUnderStandardsRoot(row.path)) }
}

export async function listBaseKnowledgeFolders(
  session: AuthorizedSession,
  query: Partial<ListFoldersQuery> = {},
): Promise<BaseKnowledgeFolders> {
  const { root, folders } = await standardsFolderRows(session)
  const start = query.cursor ? Number(query.cursor) : 0
  const end = start + (query.limit ?? FOLDER_PAGE)
  return {
    rootId: root?.id ?? null,
    folders: folders.slice(start, end).map(toFolder),
    nextCursor: end < folders.length ? String(end) : null,
  }
}

export async function standardsRoot(organizationId: string): Promise<FolderRow> {
  return getOrCreateShelfRootFolder(OFFICE_SHELF, organizationId, STANDARDS_FOLDER_NAME)
}

export async function isStandardsFolder(session: AuthorizedSession, folderId: string): Promise<boolean> {
  const { root, folders } = await standardsFolderRows(session)
  return root?.id === folderId || folders.some((folder) => folder.id === folderId)
}

export async function createBaseKnowledgeFolder(session: AuthorizedSession, body: CreateFolderBody): Promise<BaseKnowledgeFolder> {
  if (!canManageOfficeShelf(session)) throw new ForbiddenError()
  const parentId = body.parentId ?? (await standardsRoot(session.organizationId)).id
  if (body.parentId && !(await isStandardsFolder(session, body.parentId))) {
    throw new UnprocessableError('parentId is not a base-knowledge folder; take one from base-knowledge-folder-list.')
  }
  const created = await createOfficeShelfFolder(session, { parentId, name: body.name, description: body.description ?? null })
  if (!created.ok) throw new UnprocessableError(created.error)
  return toFolder(created.folder)
}
