import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { OFFICE_SHELF } from '@/lib/documents/shelf'
import {
  createShelfFolder,
  deleteShelfFolder,
  ensureShelfFolderPaths,
  findShelfFolder,
  listShelfFolders,
  updateShelfFolder,
} from '@/lib/documents/shelf-folders'
import { isStandardsRoot, STANDARDS_ROOT_FIXED } from './standards-folder'

async function isFixedFolder(session: AuthorizedSession, folderId: string): Promise<boolean> {
  const folder = await findShelfFolder(OFFICE_SHELF, session.organizationId, folderId)
  return folder !== undefined && isStandardsRoot(folder)
}

export function listOfficeShelfFolders(session: AuthorizedSession) {
  return listShelfFolders(session, OFFICE_SHELF)
}

export function createOfficeShelfFolder(
  session: AuthorizedSession,
  input: { parentId?: string | null; name: string; description?: string | null },
) {
  return createShelfFolder(session, OFFICE_SHELF, input)
}

export async function updateOfficeShelfFolder(
  session: AuthorizedSession,
  input: { folderId: string; name?: string; parentId?: string | null; description?: string | null },
) {
  const moves = input.name !== undefined || input.parentId !== undefined
  if (moves && (await isFixedFolder(session, input.folderId))) return { ok: false as const, error: STANDARDS_ROOT_FIXED }
  return updateShelfFolder(session, OFFICE_SHELF, input)
}

export async function deleteOfficeShelfFolder(session: AuthorizedSession, folderId: string) {
  if (await isFixedFolder(session, folderId)) return { ok: false as const, error: STANDARDS_ROOT_FIXED }
  return deleteShelfFolder(session, OFFICE_SHELF, folderId)
}

export function ensureOfficeShelfFolderPaths(
  session: AuthorizedSession,
  input: { parentId: string | null; paths: readonly string[] },
) {
  return ensureShelfFolderPaths(session, OFFICE_SHELF, input)
}
