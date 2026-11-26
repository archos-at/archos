import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { OFFICE_SHELF } from '@/lib/documents/shelf'
import {
  createShelfFolder,
  deleteShelfFolder,
  ensureShelfFolderPaths,
  findShelfFolder,
  listShelfFolders,
  updateShelfFolder,
  type DeleteFolderResult,
  type ShelfFolderVisibility,
} from '@/lib/documents/shelf-folders'
import { moveFolderToBin, type BinFolderResult } from '@/lib/projects/folder-bin'
import { isStandardsRoot, isUnderStandardsRoot, ORDNER_FOLDER_STAYS_OUT, STANDARDS_ROOT_FIXED } from './standards-folder'

async function isFixedFolder(session: AuthorizedSession, folderId: string): Promise<boolean> {
  const folder = await findShelfFolder(OFFICE_SHELF, session.organizationId, folderId)
  return folder !== undefined && isStandardsRoot(folder)
}

export function listOfficeShelfFolders(session: AuthorizedSession) {
  return listShelfFolders(session, OFFICE_SHELF)
}

export function hiddenOfficeShelfFolderIds(
  session: AuthorizedSession,
  folders: ReadonlyArray<{ id: string; path: string }>,
): string[] {
  if (!isOfficeStandardsEnabled(session)) return []
  return folders.filter((folder) => isUnderStandardsRoot(folder.path)).map((folder) => folder.id)
}

export async function officeShelfHiddenFolderIds(session: AuthorizedSession): Promise<string[]> {
  if (!isOfficeStandardsEnabled(session)) return []
  return hiddenOfficeShelfFolderIds(session, await listOfficeShelfFolders(session))
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
  if (input.parentId && (await movesIntoStandards(session, input.folderId, input.parentId))) {
    return { ok: false as const, error: ORDNER_FOLDER_STAYS_OUT }
  }
  return updateShelfFolder(session, OFFICE_SHELF, input)
}

async function movesIntoStandards(session: AuthorizedSession, folderId: string, parentId: string): Promise<boolean> {
  const hidden = await officeShelfHiddenFolderIds(session)
  return hidden.includes(parentId) && !hidden.includes(folderId)
}

export type OfficeShelfFolderDeletion = DeleteFolderResult | BinFolderResult

export async function deleteOfficeShelfFolder(
  session: AuthorizedSession,
  folderId: string,
  request?: Request,
): Promise<{ ok: true; result: OfficeShelfFolderDeletion } | { ok: false; error: string }> {
  const folder = await findShelfFolder(OFFICE_SHELF, session.organizationId, folderId)
  if (folder && isStandardsRoot(folder)) return { ok: false, error: STANDARDS_ROOT_FIXED }
  if (folder && isUnderStandardsRoot(folder.path)) return deleteShelfFolder(session, OFFICE_SHELF, folderId)
  return { ok: true, result: await moveFolderToBin(session, { shelf: OFFICE_SHELF, folderId }, request) }
}

export async function ensureOfficeShelfFolderPaths(
  session: AuthorizedSession,
  input: { parentId: string | null; paths: readonly string[] },
) {
  const hidden = new Set(await officeShelfHiddenFolderIds(session))
  const outsideStandards: ShelfFolderVisibility = {
    isVisible: (folderId) => !hidden.has(folderId),
    assertMayCreateIn: () => undefined,
    recheckVisible: async (folderId) => !hidden.has(folderId),
  }
  return ensureShelfFolderPaths(session, OFFICE_SHELF, input, hidden.size === 0 ? undefined : outsideStandards)
}
