/**
 * The folders of the office's base knowledge: the standards root on the office
 * shelf and its subfolders (`@/lib/office-shelf/standards-folder`). They are
 * office shelf folders, read and changed through the shelf's own folder core,
 * so the Büroablage shows the same tree and a rename or delete of a subfolder
 * is the shelf's operation. This module adds the two things only base knowledge
 * needs: the subtree on its own, and the root created on first use.
 *
 * Reads are any member's, as the shelf's are; creating takes
 * `org:office_shelf:manage`, checked by the shelf folder core.
 */

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

/** The standards root and every folder below it; the root is null until somebody files the first entry. */
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

/** The standards root, created on first use. Does not authorize: callers have. */
export async function standardsRoot(organizationId: string): Promise<FolderRow> {
  return getOrCreateShelfRootFolder(OFFICE_SHELF, organizationId, STANDARDS_FOLDER_NAME)
}

/**
 * Whether `folderId` is the root or one of its subfolders; an upload or a move
 * into base knowledge lands only there.
 */
export async function isStandardsFolder(session: AuthorizedSession, folderId: string): Promise<boolean> {
  const { root, folders } = await standardsFolderRows(session)
  return root?.id === folderId || folders.some((folder) => folder.id === folderId)
}

/** A folder under the standards root, or under one of its subfolders. */
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
