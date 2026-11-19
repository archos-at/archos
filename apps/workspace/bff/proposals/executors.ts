import 'server-only'
import { captureServer } from '@/lib/analytics/posthog-server'
import type { AuthorizedSession } from '@/lib/auth/types'
import { addResourceAssignment, listAssignmentCandidates } from '@/lib/assignments/service'
import { ensureOfficeShelfFolderPaths, listOfficeShelfFolders, updateOfficeShelfFolder } from '@/lib/office-shelf/folder-service'
import { assertMoveKeepsOutOfStandards, resolveOfficeShelfDocumentsByName } from '@/lib/office-shelf/service'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { renameDocument } from '@/lib/documents/document-edits'
import { resolveProjectDocumentsByName } from '@/lib/documents/document-listing'
import type { FolderRow } from '@/lib/documents/shelf-folders'
import {
  createProjectFolder,
  ensureProjectFolderPaths,
  listProjectFolders,
  updateProjectFolder,
} from '@/lib/projects/folder-service'
import { folderPathKey } from '@/lib/projects/folders'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import type { FileOperationItem, FileOperationPayload, NewFolder, ProposedChangeResult } from './types'

type Shelf = 'project' | 'office'

export interface ExecutionContext {
  session: AuthorizedSession
  projectId: string | null
  request: Request
  folders: (shelf: Shelf) => Promise<FolderRow[]>
  createTarget: ((shelf: Shelf) => Promise<string>) | null
  newFolder: NewFolder | null
}

type Executor = (item: FileOperationItem, context: ExecutionContext) => Promise<void>

const nameKey = (name: string): string => name.normalize('NFC').trim().toLowerCase()

const pathKey = folderPathKey

const shelfOf = (item: FileOperationItem): Shelf => (item.source === 'office' ? 'office' : 'project')

function folderIdForPath(folders: readonly FolderRow[], path: string | null | undefined): string | null {
  const wanted = pathKey(path ?? '')
  if (!wanted) return null
  const hit = folders.find((folder) => pathKey(folder.path) === wanted)
  if (!hit) throw new Error(`Ordner „${path}“ existiert nicht (mehr)`)
  return hit.id
}

async function documentIdFor(item: FileOperationItem, { session, projectId }: ExecutionContext): Promise<string> {
  const name = item.document ?? ''
  const rows =
    shelfOf(item) === 'office'
      ? await resolveOfficeShelfDocumentsByName(session, [name])
      : await resolveProjectDocumentsByName(session, requireProject(projectId), [name])
  const wanted = nameKey(name)
  const newest = rows
    .filter((row) => nameKey(row.filename) === wanted)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
  if (!newest) throw new Error(`„${name}“ wurde nicht gefunden`)
  return newest.id
}

export async function resolveItemDocuments(
  session: AuthorizedSession,
  projectId: string | null,
  items: readonly FileOperationItem[]
): Promise<Array<{ id: string; name: string }> | null> {
  const named = items.filter((item) => (item.document ?? '').trim().length > 0)
  const byShelf = (shelf: Shelf) => [...new Set(named.filter((item) => shelfOf(item) === shelf).map((item) => item.document ?? ''))]
  const [projekt, office] = [byShelf('project'), byShelf('office')]
  if (projekt.length > 0 && !projectId) return null
  const rows = [
    ...(projekt.length > 0 && projectId ? await resolveProjectDocumentsByName(session, projectId, projekt) : []),
    ...(office.length > 0 ? await resolveOfficeShelfDocumentsByName(session, office) : []),
  ]
  const newest = new Map<string, { id: string; createdAt: number }>()
  for (const row of rows) {
    const key = nameKey(row.filename)
    const at = new Date(row.createdAt).getTime()
    const held = newest.get(key)
    if (!held || at > held.createdAt) newest.set(key, { id: row.id, createdAt: at })
  }
  const resolved: Array<{ id: string; name: string }> = []
  for (const name of new Set(named.map((item) => item.document ?? ''))) {
    const hit = newest.get(nameKey(name))
    if (!hit) return null
    resolved.push({ id: hit.id, name })
  }
  return resolved
}

async function memberFor(item: FileOperationItem, documentId: string, { session }: ExecutionContext): Promise<string> {
  const candidates = await listAssignmentCandidates(session, 'document', documentId)
  const self = (await loadOrganizationDirectory(session.organizationId)).get(session.userId)
  const wanted = (item.member ?? '').trim().toLowerCase()
  const people = self ? [self, ...candidates] : candidates
  const matches = people.filter(
    (person) =>
      (person.name ?? '').trim().toLowerCase() === wanted || (person.email ?? '').trim().toLowerCase() === wanted
  )
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `„${item.member}“ ist kein Mitglied dieses Projekts`
        : `„${item.member}“ ist im Projekt mehrfach vergeben`
    )
  }
  return matches[0].userId
}

function requireProject(projectId: string | null): string {
  if (!projectId) throw new Error('Dieser Vorschlag gehört zu keinem Projekt')
  return projectId
}

async function targetFolderId(item: FileOperationItem, context: ExecutionContext): Promise<string | null> {
  const shelf = shelfOf(item)
  const rows = await context.folders(shelf)
  try {
    return folderIdForPath(rows, item.target_folder)
  } catch (missing) {
    const wanted = context.newFolder
    if (!context.createTarget || !wanted || pathKey(wanted.path) !== pathKey(item.target_folder ?? '')) throw missing
    return context.createTarget(shelf)
  }
}

async function makeNewFolder(
  shelf: Shelf,
  folder: NewFolder,
  { session, projectId }: Pick<ExecutionContext, 'session' | 'projectId'>
): Promise<string> {
  const input = { parentId: null, paths: [folder.path] }
  const outcome =
    shelf === 'office'
      ? await ensureOfficeShelfFolderPaths(session, input)
      : await ensureProjectFolderPaths({ ...input, projectId: requireProject(projectId) }, session)
  if (!outcome.ok) throw new Error(outcome.error)
  const id = outcome.folderIdByPath[folder.path]
  if (!id) throw new Error(`Ordner „${folder.path}“ konnte nicht angelegt werden`)
  const madeHere = outcome.folders.some((created) => created.id === id)
  if (madeHere && folder.description) {
    const described =
      shelf === 'office'
        ? await updateOfficeShelfFolder(session, { folderId: id, description: folder.description })
        : await updateProjectFolder(
            { projectId: requireProject(projectId), folderId: id, description: folder.description },
            session
          )
    if (!described.ok) console.warn('[proposals] the new folder kept no description:', described.error)
  }
  return id
}

const EXECUTORS: Record<FileOperationPayload['operation'], Executor> = {
  move: async (item, context) => {
    const [documentId, folderId] = await Promise.all([documentIdFor(item, context), targetFolderId(item, context)])
    if (shelfOf(item) === 'office') await assertMoveKeepsOutOfStandards(context.session, documentId, folderId)
    const result = await moveDocumentToFolder({ documentId, folderId }, context.session)
    if (!result.ok) throw new Error(result.error)
  },

  rename: async (item, context) => {
    const documentId = await documentIdFor(item, context)
    await renameDocument(context.session, documentId, item.new_display_name ?? null, context.request)
  },

  create_folder: async (item, context) => {
    const parentId = folderIdForPath(await context.folders('project'), item.parent_folder)
    const outcome = await createProjectFolder(
      { projectId: requireProject(context.projectId), parentId, name: item.folder_name ?? '' },
      context.session
    )
    if (!outcome.ok) throw new Error(outcome.error)
  },

  assign: async (item, context) => {
    const documentId = await documentIdFor(item, context)
    const userId = await memberFor(item, documentId, context)
    await addResourceAssignment(context.session, 'document', documentId, userId, context.request)
    captureServer({
      event: 'task_assigned',
      distinctId: context.session.userId,
      organizationId: context.session.organizationId,
      properties: { resource_type: 'document' },
    })
  },
}

export function operationLabel(operation: FileOperationPayload['operation'], item: FileOperationItem): string {
  if (operation === 'create_folder') {
    return item.parent_folder ? `${item.parent_folder}/${item.folder_name}` : (item.folder_name ?? '')
  }
  return item.document ?? ''
}

export const REQUIRED_FIELDS: Record<FileOperationPayload['operation'], ReadonlyArray<keyof FileOperationItem>> = {
  move: ['document'],
  rename: ['document', 'new_display_name'],
  create_folder: ['folder_name'],
  assign: ['document', 'member'],
}

export async function applyFileOperations(
  payload: Pick<FileOperationPayload, 'operation' | 'operations' | 'new_folder'>,
  base: Pick<ExecutionContext, 'session' | 'projectId' | 'request'>
): Promise<ProposedChangeResult[]> {
  const { operation, operations: items } = payload
  const cache = new Map<Shelf, Promise<FolderRow[]>>()
  const loadFolders = (shelf: Shelf): Promise<FolderRow[]> =>
    shelf === 'office' ? listOfficeShelfFolders(base.session) : listProjectFolders(requireProject(base.projectId), base.session)
  const made = new Map<Shelf, Promise<string>>()
  const newFolder = operation === 'move' ? (payload.new_folder ?? null) : null
  const context: ExecutionContext = {
    ...base,
    newFolder,
    folders: (shelf) => {
      let pending = cache.get(shelf)
      if (!pending) {
        pending = loadFolders(shelf)
        cache.set(shelf, pending)
      }
      return pending
    },
    createTarget: newFolder
      ? (shelf) => {
          let pending = made.get(shelf)
          if (!pending) {
            pending = makeNewFolder(shelf, newFolder, base)
            made.set(shelf, pending)
          }
          return pending
        }
      : null,
  }
  const execute = EXECUTORS[operation]
  const results: ProposedChangeResult[] = []
  for (const item of items) {
    const label = operationLabel(operation, item)
    try {
      await execute(item, context)
      results.push({ label, ok: true })
    } catch (error) {
      results.push({ label, ok: false, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
