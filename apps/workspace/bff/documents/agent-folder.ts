import 'server-only'
import { UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { listProjectFolders } from '@/lib/projects/folder-service'
import { getAccessibleDocument } from './access'

export const MAX_NAMED_FOLDERS = 40

const ROOT_NAMES: ReadonlySet<string> = new Set(['', 'alle dateien', 'all files', 'projekt', 'project'])

const folderKey = (value: string): string =>
  value.normalize('NFC').trim().replace(/^\/+|\/+$/g, '').replace(/\s*\/\s*/g, '/').toLocaleLowerCase('de')

export class UnknownFolderError extends UnprocessableError {
  constructor(named: string, folders: readonly string[]) {
    super(`There is no folder „${named}“ in this project`, {
      reason: 'folder-unknown',
      folder: named,
      folders: folders.slice(0, MAX_NAMED_FOLDERS),
    })
  }
}

export async function resolveNamedFolder(
  session: AuthorizedSession,
  projectId: string,
  named: string,
): Promise<string | null> {
  const key = folderKey(named)
  if (ROOT_NAMES.has(key)) return null
  const folders = await listProjectFolders(projectId, session)
  const byPath = folders.filter((folder) => folderKey(folder.path) === key)
  const byName = byPath.length > 0 ? byPath : folders.filter((folder) => folderKey(folder.name) === key)
  if (byName.length === 1) return byName[0].id
  throw new UnknownFolderError(named, folders.map((folder) => folder.path).sort((a, b) => a.localeCompare(b, 'de')))
}

export async function folderOfSource(
  session: AuthorizedSession,
  projectId: string,
  sourceDocumentId: string,
): Promise<string | null | undefined> {
  try {
    const source = await getAccessibleDocument(session, sourceDocumentId)
    return source.projectId === projectId ? source.folderId : undefined
  } catch {
    return undefined
  }
}

export async function agentDestination(
  session: AuthorizedSession,
  projectId: string,
  named: { folder?: string; sourceDocumentId?: string },
): Promise<string | null | undefined> {
  if (named.folder !== undefined) return resolveNamedFolder(session, projectId, named.folder)
  if (named.sourceDocumentId !== undefined) return folderOfSource(session, projectId, named.sourceDocumentId)
  return undefined
}
