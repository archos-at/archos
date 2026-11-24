import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { personalShelf } from '@/lib/documents/shelf'
import {
  createShelfFolder,
  deleteShelfFolder,
  ensureShelfFolderPaths,
  listShelfFolders,
  updateShelfFolder,
} from '@/lib/documents/shelf-folders'

const ownShelf = (session: AuthorizedSession) => personalShelf(session.userId)

export function listPersonalShelfFolders(session: AuthorizedSession) {
  return listShelfFolders(session, ownShelf(session))
}

export function createPersonalShelfFolder(
  session: AuthorizedSession,
  input: { parentId?: string | null; name: string; description?: string | null },
) {
  return createShelfFolder(session, ownShelf(session), input)
}

export function updatePersonalShelfFolder(
  session: AuthorizedSession,
  input: { folderId: string; name?: string; parentId?: string | null; description?: string | null },
) {
  return updateShelfFolder(session, ownShelf(session), input)
}

export function deletePersonalShelfFolder(session: AuthorizedSession, folderId: string) {
  return deleteShelfFolder(session, ownShelf(session), folderId)
}

export function ensurePersonalShelfFolderPaths(
  session: AuthorizedSession,
  input: { parentId: string | null; paths: readonly string[] },
) {
  return ensureShelfFolderPaths(session, ownShelf(session), input)
}
