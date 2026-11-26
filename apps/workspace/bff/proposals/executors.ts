import 'server-only'
import { captureServer } from '@/lib/analytics/posthog-server'
import type { AuthorizedSession } from '@/lib/auth/types'
import { addResourceAssignment, listAssignmentCandidates } from '@/lib/assignments/service'
import { ensureOfficeShelfFolderPaths, listOfficeShelfFolders, updateOfficeShelfFolder } from '@/lib/office-shelf/folder-service'
import { assertMoveKeepsOutOfStandards, resolveOfficeShelfDocumentsByName } from '@/lib/office-shelf/service'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { renameDocument } from '@/lib/documents/document-edits'
import { NameConflictError, nameConflictMessage } from '@/lib/documents/name-conflict'
import { resolveProjectDocumentsByName, type ListedDocument } from '@/lib/documents/document-listing'
import { resolveShelfDocumentsById } from '@/lib/documents/resolve-by-id'
import { OFFICE_SHELF, projectShelf, type DocumentShelf } from '@/lib/documents/shelf'
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

function shelfFor(shelf: Shelf, projectId: string | null): DocumentShelf {
  return shelf === 'office' ? OFFICE_SHELF : projectShelf(requireProject(projectId))
}

function resolveByName(session: AuthorizedSession, shelf: Shelf, projectId: string | null, names: readonly string[]): Promise<ListedDocument[]> {
  return shelf === 'office'
    ? resolveOfficeShelfDocumentsByName(session, names)
    : resolveProjectDocumentsByName(session, requireProject(projectId), names)
}

type NameMatch = { kind: 'found'; id: string } | { kind: 'missing' } | { kind: 'ambiguous' }

function onlyNamed(rows: readonly ListedDocument[], name: string): NameMatch {
  const wanted = nameKey(name)
  const matches = [...new Set(rows.filter((row) => nameKey(row.filename) === wanted).map((row) => row.id))]
  if (matches.length === 0) return { kind: 'missing' }
  return matches.length === 1 ? { kind: 'found', id: matches[0] } : { kind: 'ambiguous' }
}

async function documentIdFor(item: FileOperationItem, { session, projectId }: ExecutionContext): Promise<string> {
  const name = item.document ?? ''
  const shelf = shelfOf(item)
  if (item.document_id) {
    const [row] = await resolveShelfDocumentsById(session, shelfFor(shelf, projectId), [item.document_id])
    if (!row) throw new Error(`„${name || item.document_id}“ wurde nicht gefunden`)
    return row.id
  }
  const match = onlyNamed(await resolveByName(session, shelf, projectId, [name]), name)
  if (match.kind === 'missing') throw new Error(`„${name}“ wurde nicht gefunden`)
  if (match.kind === 'ambiguous') {
    throw new Error(`„${name}“ liegt mehrmals in verschiedenen Ordnern; der Vorschlag sagt nicht, welches Dokument gemeint ist`)
  }
  return match.id
}

export async function resolveItemDocuments(
  session: AuthorizedSession,
  projectId: string | null,
  items: readonly FileOperationItem[]
): Promise<Array<{ id: string; name: string }> | null> {
  const named = items.filter((item) => item.document_id || (item.document ?? '').trim().length > 0)
  if (!projectId && named.some((item) => shelfOf(item) === 'project')) return null
  const resolved = new Map<string, { id: string; name: string }>()
  for (const shelf of ['project', 'office'] as const) {
    const onShelf = named.filter((item) => shelfOf(item) === shelf)
    if (onShelf.length === 0) continue
    const ids = [...new Set(onShelf.flatMap((item) => item.document_id ?? []))]
    const names = [...new Set(onShelf.filter((item) => !item.document_id).map((item) => item.document ?? ''))]
    const [byId, byName] = await Promise.all([
      ids.length > 0 ? resolveShelfDocumentsById(session, shelfFor(shelf, projectId), ids) : Promise.resolve([]),
      names.length > 0 ? resolveByName(session, shelf, projectId, names) : Promise.resolve([]),
    ])
    const visible = new Set(byId.map((row) => row.id))
    for (const item of onShelf) {
      const name = item.document ?? ''
      if (item.document_id) {
        if (!visible.has(item.document_id)) return null
        resolved.set(item.document_id, { id: item.document_id, name })
        continue
      }
      const match = onlyNamed(byName, name)
      if (match.kind === 'missing') return null
      if (match.kind === 'found') resolved.set(match.id, { id: match.id, name })
    }
  }
  return [...resolved.values()]
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
    if (!result.ok) throw result.conflict ? new NameConflictError(result.conflict) : new Error(result.error)
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
      results.push(
        error instanceof NameConflictError
          ? { label, ok: false, reason: nameConflictMessage(error.conflict), conflict: error.conflict }
          : { label, ok: false, reason: error instanceof Error ? error.message : String(error) }
      )
    }
  }
  return results
}
