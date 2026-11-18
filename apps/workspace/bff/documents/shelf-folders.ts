import { isUniqueViolation } from '@/lib/db/errors'
import { and, eq, isNull, like, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { getBackendUrl } from '@/lib/backend-proxy'
import { listProjectDocumentCollections } from '@/lib/authz/folder-access-repository'
import {
  buildFolderPath,
  FOLDER_DESCRIPTION_MAX_LENGTH,
  folderMatchKey,
  normalizeFolderDescription,
  pathSegments,
  validateFolderName,
} from '@/lib/projects/folders'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireShelfRead, requireShelfWrite } from './shelf-authz'
import { shelfCollectionName } from './shelf-collection'
import { publishShelfChanged } from './shelf-live'
import { shelfDocumentWhere, shelfOwner, shelfFolderWhere, type OfficeShelf, type DocumentShelf } from './shelf'
import { escapeLikePattern } from '@/lib/text/like-pattern'

const BACKEND_MIRROR_TIMEOUT_MS = 5_000

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type FolderRecord = typeof projectFolders.$inferSelect
type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string }

export const FOLDER_NAME_TAKEN = 'A folder with this name already exists here.'

export interface ShelfFolderVisibility {
  isVisible(folderId: string): boolean
  assertMayCreateIn(parentId: string): void
  recheckVisible(folderId: string): Promise<boolean>
}

export interface FolderRow {
  id: string
  projectId: string | null
  parentId: string | null
  name: string
  path: string
  description: string | null
  createdAt: Date
  updatedAt: Date
}

export function toFolderRow(row: FolderRecord): FolderRow {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    name: row.name,
    path: row.path,
    description: row.description ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export interface DeleteFolderResult {
  documentsMoved: number
  foldersMoved: number
}

const folderOnShelf = (shelf: DocumentShelf, organizationId: string, folderId: string) =>
  and(eq(projectFolders.id, folderId), shelfFolderWhere(shelf, organizationId))

export async function findShelfFolder(
  shelf: DocumentShelf,
  organizationId: string,
  folderId: string,
  db: Db | Tx = getDb(),
): Promise<FolderRecord | undefined> {
  const [row] = await db
    .select()
    .from(projectFolders)
    .where(folderOnShelf(shelf, organizationId, folderId))
    .limit(1)
  return row
}

export async function listShelfFolders(
  session: AuthorizedSession,
  shelf: DocumentShelf,
): Promise<FolderRow[]> {
  await requireShelfRead(session, shelf)
  const rows = await getDb()
    .select()
    .from(projectFolders)
    .where(shelfFolderWhere(shelf, session.organizationId))
    .orderBy(projectFolders.path)
  return rows.map(toFolderRow)
}

export async function createShelfFolder(
  session: AuthorizedSession,
  shelf: DocumentShelf,
  input: { parentId?: string | null; name: string; description?: string | null },
): Promise<Outcome<{ folder: FolderRow }>> {
  await requireShelfWrite(session, shelf)
  const organizationId = session.organizationId
  const validation = validateFolderName(input.name)
  if (!validation.ok) return { ok: false, error: validation.error! }
  const description = checkedDescription(input.description)
  if (!description.ok) return { ok: false, error: description.error }

  let parentPath = ''
  if (input.parentId) {
    const parent = await findShelfFolder(shelf, organizationId, input.parentId)
    if (!parent) return { ok: false, error: 'Parent folder not found.' }
    parentPath = parent.path
  }

  const inserted = await insertFolderRow(getDb(), shelf, organizationId, {
    parentId: input.parentId ?? null,
    name: validation.name!,
    path: buildFolderPath(parentPath, validation.name!),
    ...(description.value ? { description: description.value } : {}),
  })
  if ('conflict' in inserted) return { ok: false, error: FOLDER_NAME_TAKEN }
  return { ok: true, folder: toFolderRow(inserted.row) }
}

async function insertFolderRow(
  db: Db,
  shelf: DocumentShelf,
  organizationId: string,
  folder: { parentId: string | null; name: string; path: string; description?: string | null },
): Promise<{ row: FolderRecord } | { conflict: unknown }> {
  try {
    const [row] = await db
      .insert(projectFolders)
      .values({ ...shelfOwner(shelf, organizationId), ...folder })
      .returning()
    publishShelfChanged(organizationId, shelf, { folders: true })
    return { row }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    return { conflict: error }
  }
}

async function findSibling(
  db: Db,
  shelf: DocumentShelf,
  organizationId: string,
  parentId: string | null,
  name: string,
): Promise<FolderRecord | undefined> {
  const [row] = await db
    .select()
    .from(projectFolders)
    .where(
      and(
        shelfFolderWhere(shelf, organizationId),
        parentId ? eq(projectFolders.parentId, parentId) : isNull(projectFolders.parentId),
        eq(projectFolders.name, name),
      ),
    )
    .limit(1)
  return row
}

export async function findShelfRootFolder(
  shelf: DocumentShelf,
  organizationId: string,
  name: string,
): Promise<FolderRow | null> {
  const row = await findSibling(getDb(), shelf, organizationId, null, name)
  return row ? toFolderRow(row) : null
}

export async function getOrCreateShelfRootFolder(
  shelf: DocumentShelf,
  organizationId: string,
  name: string,
): Promise<FolderRow> {
  const db = getDb()
  const existing = await findSibling(db, shelf, organizationId, null, name)
  if (existing) return toFolderRow(existing)

  const inserted = await insertFolderRow(db, shelf, organizationId, {
    parentId: null,
    name,
    path: buildFolderPath('', name),
  })
  if ('row' in inserted) return toFolderRow(inserted.row)
  const winner = await findSibling(db, shelf, organizationId, null, name)
  if (winner) return toFolderRow(winner)
  throw inserted.conflict

}

export interface EnsureFolderPathsInput {
  parentId: string | null
  paths: readonly string[]
}

const MAX_ENSURE_PATHS = 300

const MAX_ENSURE_DEPTH = 12

export async function ensureShelfFolderPaths(
  session: AuthorizedSession,
  shelf: DocumentShelf,
  input: EnsureFolderPathsInput,
  visibility?: ShelfFolderVisibility,
): Promise<Outcome<{ folders: FolderRow[]; folderIdByPath: Record<string, string> }>> {
  await requireShelfWrite(session, shelf)
  const organizationId = session.organizationId
  if (input.paths.length > MAX_ENSURE_PATHS) {
    return { ok: false, error: `A folder upload may create at most ${MAX_ENSURE_PATHS} folders.` }
  }
  const db = getDb()

  let root: FolderRow | null = null
  if (input.parentId) {
    if (visibility && !visibility.isVisible(input.parentId)) return { ok: false, error: 'Parent folder not found.' }
    const parent = await findShelfFolder(shelf, organizationId, input.parentId, db)
    if (!parent) return { ok: false, error: 'Parent folder not found.' }
    root = toFolderRow(parent)
  }

  const existing = await db.select().from(projectFolders).where(shelfFolderWhere(shelf, organizationId))
  const walk: FolderWalk = { byParentAndKey: new Map(), hiddenNames: new Set(), createdHere: new Set(), visibility }
  const index = (row: FolderRow): void => {
    walk.byParentAndKey.set(`${row.parentId ?? ''}\u0000${folderMatchKey(row.name)}`, row)
  }
  for (const row of existing) {
    if (!visibility || visibility.isVisible(row.id)) index(toFolderRow(row))
    else walk.hiddenNames.add(`${row.parentId ?? ''}\u0000${row.name}`)
  }

  const touched = new Map<string, FolderRow>()
  const folderIdByPath: Record<string, string> = {}

  for (const requested of input.paths) {
    const resolved = await resolvePath(db, shelf, organizationId, root, requested, walk, (created) => {
      index(created)
      touched.set(created.id, created)
    })
    if (!resolved.ok) return resolved
    if (resolved.folder) folderIdByPath[requested] = resolved.folder.id
  }

  return { ok: true, folders: [...touched.values()], folderIdByPath }
}

interface FolderWalk {
  byParentAndKey: Map<string, FolderRow>
  hiddenNames: Set<string>
  createdHere: Set<string>
  visibility: ShelfFolderVisibility | undefined
}

async function resolvePath(
  db: Db,
  shelf: DocumentShelf,
  organizationId: string,
  root: FolderRow | null,
  requested: string,
  walk: FolderWalk,
  onCreated: (folder: FolderRow) => void,
): Promise<Outcome<{ folder: FolderRow | null }>> {
  const segments = pathSegments(requested)
  if (segments.length > MAX_ENSURE_DEPTH) {
    return { ok: false, error: `A folder path may be at most ${MAX_ENSURE_DEPTH} levels deep.` }
  }

  let current = root
  for (const segment of segments) {
    const validation = validateFolderName(segment)
    if (!validation.ok) return { ok: false, error: validation.error! }
    const name = validation.name!

    const match = walk.byParentAndKey.get(`${current?.id ?? ''}\u0000${folderMatchKey(name)}`)
    if (match) {
      current = match
      continue
    }
    if (walk.hiddenNames.has(`${current?.id ?? ''}\u0000${name}`)) return { ok: false, error: FOLDER_NAME_TAKEN }
    if (current && !walk.createdHere.has(current.id)) walk.visibility?.assertMayCreateIn(current.id)
    const created = await getOrCreateChild(db, shelf, organizationId, current, name)
    if (!created.ok) return created
    if (!created.raced) walk.createdHere.add(created.folder.id)
    if (created.raced && walk.visibility && !(await walk.visibility.recheckVisible(created.folder.id))) {
      return { ok: false, error: FOLDER_NAME_TAKEN }
    }
    onCreated(created.folder)
    current = created.folder
  }
  return { ok: true, folder: segments.length > 0 ? current : null }
}

async function getOrCreateChild(
  db: Db,
  shelf: DocumentShelf,
  organizationId: string,
  parent: FolderRow | null,
  name: string,
): Promise<Outcome<{ folder: FolderRow; raced: boolean }>> {
  const inserted = await insertFolderRow(db, shelf, organizationId, {
    parentId: parent?.id ?? null,
    name,
    path: buildFolderPath(parent?.path ?? '', name),
  })
  if ('row' in inserted) return { ok: true, folder: toFolderRow(inserted.row), raced: false }
  const winner = await findSibling(db, shelf, organizationId, parent?.id ?? null, name)
  if (winner) return { ok: true, folder: toFolderRow(winner), raced: true }
  return { ok: false, error: FOLDER_NAME_TAKEN }
}

async function rewriteDescendantPaths(
  tx: Tx,
  shelf: DocumentShelf,
  organizationId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  if (oldPath === newPath) return
  await tx
    .update(projectFolders)
    .set({
      path: sql`${newPath} || substring(${projectFolders.path} from char_length(${oldPath}::text) + 1)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        shelfFolderWhere(shelf, organizationId),
        like(projectFolders.path, `${escapeLikePattern(oldPath)}/%`),
      ),
    )
}

export async function mirrorShelfFolderPathRewrite(
  shelf: DocumentShelf,
  organizationId: string,
  fromPath: string,
  toPath: string,
): Promise<void> {
  if (fromPath === toPath) return
  try {
    const collectionName = await shelfCollectionName(shelf, organizationId)
    if (!collectionName) return
    const others =
      shelf.kind === 'project'
        ? await listProjectDocumentCollections(organizationId, shelf.projectId).catch(() => [])
        : []
    const collections = new Set([collectionName, ...others])
    await Promise.all(
      [...collections].map((collection) =>
        fetch(`${getBackendUrl()}/v1/collections/${encodeURIComponent(collection)}/folder-paths`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from_path: fromPath, to_path: toPath || null }),
          signal: AbortSignal.timeout(BACKEND_MIRROR_TIMEOUT_MS),
        }).catch(() => undefined),
      ),
    )
  } catch {
    // ignore — see the note above; the folder rows are the durable truth.
  }
}

function checkedDescription(raw: string | null | undefined): Outcome<{ value: string | null }> {
  const value = normalizeFolderDescription(raw)
  if (value && value.length > FOLDER_DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: `A folder description may be at most ${FOLDER_DESCRIPTION_MAX_LENGTH} characters.` }
  }
  return { ok: true, value }
}

async function resolveNewParent(
  db: Db,
  shelf: DocumentShelf,
  organizationId: string,
  folder: FolderRecord,
  requestedParentId: string | null | undefined,
): Promise<Outcome<{ parentId: string | null; parentPath: string }>> {
  const parentId = requestedParentId === undefined ? folder.parentId : requestedParentId
  if (!parentId) return { ok: true, parentId: null, parentPath: '' }
  if (parentId === folder.id) return { ok: false, error: 'A folder cannot be moved into itself.' }

  const parent = await findShelfFolder(shelf, organizationId, parentId, db)
  if (!parent) {
    return requestedParentId === undefined
      ? { ok: true, parentId, parentPath: '' }
      : { ok: false, error: 'Parent folder not found.' }
  }
  if (requestedParentId !== undefined && (parent.path === folder.path || parent.path.startsWith(`${folder.path}/`))) {
    return { ok: false, error: 'A folder cannot be moved into its own subfolder.' }
  }
  return { ok: true, parentId, parentPath: parent.path }
}

export async function updateShelfFolder(
  session: AuthorizedSession,
  shelf: DocumentShelf,
  input: { folderId: string; name?: string; parentId?: string | null; description?: string | null },
): Promise<Outcome<{ folder: FolderRow }>> {
  await requireShelfWrite(session, shelf)
  const organizationId = session.organizationId
  const db = getDb()
  const folder = await findShelfFolder(shelf, organizationId, input.folderId, db)
  if (!folder) return { ok: false, error: 'Folder not found.' }
  const description = checkedDescription(input.description)
  if (!description.ok) return { ok: false, error: description.error }
  const nextDescription = input.description === undefined ? folder.description : description.value

  let name = folder.name
  if (input.name !== undefined) {
    const validation = validateFolderName(input.name)
    if (!validation.ok) return { ok: false, error: validation.error! }
    name = validation.name!
  }

  const target = await resolveNewParent(db, shelf, organizationId, folder, input.parentId)
  if (!target.ok) return target

  const path = buildFolderPath(target.parentPath, name)
  const unmoved = path === folder.path && target.parentId === folder.parentId
  if (unmoved && nextDescription === folder.description) {
    return { ok: true, folder: toFolderRow(folder) }
  }
  if (unmoved) {
    const [row] = await db
      .update(projectFolders)
      .set({ description: nextDescription, updatedAt: new Date() })
      .where(folderOnShelf(shelf, organizationId, folder.id))
      .returning()
    publishShelfChanged(organizationId, shelf, { folders: true })
    return { ok: true, folder: toFolderRow(row) }
  }

  let updated: FolderRecord
  try {
    updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(projectFolders)
        .set({ name, parentId: target.parentId, path, description: nextDescription, updatedAt: new Date() })
        .where(folderOnShelf(shelf, organizationId, folder.id))
        .returning()
      await rewriteDescendantPaths(tx, shelf, organizationId, folder.path, path)
      return row
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: FOLDER_NAME_TAKEN }
    throw error
  }
  publishShelfChanged(organizationId, shelf, { folders: true })

  await mirrorShelfFolderPathRewrite(shelf, organizationId, folder.path, path)

  return { ok: true, folder: toFolderRow(updated) }
}

export async function deleteShelfFolder(
  session: AuthorizedSession,
  shelf: OfficeShelf,
  folderId: string,
): Promise<Outcome<{ result: DeleteFolderResult }>> {
  await requireShelfWrite(session, shelf)
  const organizationId = session.organizationId
  const db = getDb()
  const folder = await findShelfFolder(shelf, organizationId, folderId, db)
  if (!folder) return { ok: false, error: 'Folder not found.' }

  const parent = folder.parentId ? await findShelfFolder(shelf, organizationId, folder.parentId, db) : undefined
  const parentPath = parent?.path ?? ''

  const result = await db.transaction(async (tx) => {
    const moved = await tx
      .update(documents)
      .set({ folderId: folder.parentId, updatedAt: new Date() })
      .where(and(eq(documents.folderId, folder.id), shelfDocumentWhere(shelf, organizationId)))
      .returning({ id: documents.id })

    const children = await tx
      .select()
      .from(projectFolders)
      .where(and(eq(projectFolders.parentId, folder.id), shelfFolderWhere(shelf, organizationId)))

    for (const child of children) {
      const childPath = buildFolderPath(parentPath, child.name)
      await tx
        .update(projectFolders)
        .set({ parentId: folder.parentId, path: childPath, updatedAt: new Date() })
        .where(eq(projectFolders.id, child.id))
      await rewriteDescendantPaths(tx, shelf, organizationId, child.path, childPath)
    }

    await tx.delete(projectFolders).where(folderOnShelf(shelf, organizationId, folder.id))

    return { documentsMoved: moved.length, foldersMoved: children.length }
  })
  publishShelfChanged(organizationId, shelf, { folders: true })

  await mirrorShelfFolderPathRewrite(shelf, organizationId, folder.path, parentPath)

  return { ok: true, result }
}
