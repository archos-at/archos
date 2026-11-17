import { ForbiddenError } from '@/lib/api/api-error'

export type FolderGrantLevel = 'read' | 'write'

export type FolderLevel = 'none' | FolderGrantLevel

export const DELETED_FOLDER_CONTENT_POLICIES = ['unchanged', 'project', 'admins', 'remove'] as const
export type DeletedFolderContentPolicy = (typeof DELETED_FOLDER_CONTENT_POLICIES)[number]

export interface AccessFolder {
  id: string
  parentId: string | null
  accessMode: 'inherit' | 'custom'
  everyoneReads: boolean
  deleted?: boolean
  purgedAt?: Date | null
  purgedContent?: DeletedFolderContentPolicy
}

export interface FolderClearance {
  levels: Readonly<Record<string, FolderGrantLevel>>
  seesEverything: boolean
}

export const DOCUMENT_WRITE_PERMISSIONS = ['project:documents:write', 'project:edit'] as const

export const FOLDER_READ_ONLY_REASON = 'folder-read-only'

const RANK: Readonly<Record<FolderLevel, number>> = { none: 0, read: 1, write: 2 }

const lower = (a: FolderLevel, b: FolderLevel): FolderLevel => (RANK[a] <= RANK[b] ? a : b)
const higher = (a: FolderLevel, b: FolderLevel): FolderLevel => (RANK[a] >= RANK[b] ? a : b)

export function atLeast(level: FolderLevel, needed: FolderGrantLevel): boolean {
  return RANK[level] >= RANK[needed]
}

export function listLevel(folder: AccessFolder, clearance: FolderClearance): FolderLevel {
  const held: FolderLevel = clearance.levels[folder.id] ?? 'none'
  return folder.everyoneReads ? higher(held, 'read') : held
}

export type FolderTree = ReadonlyMap<string, AccessFolder>

export function folderTree(folders: readonly AccessFolder[]): FolderTree {
  return new Map(folders.map((folder) => [folder.id, folder]))
}

export function effectiveFolderLevel(tree: FolderTree, clearance: FolderClearance, folderId: string | null): FolderLevel {
  if (folderId === null) return 'write'
  const target = tree.get(folderId)
  if (!target) return 'none'
  if (clearance.seesEverything) return 'write'
  const purgedPolicy = target.purgedAt ? (target.purgedContent ?? 'unchanged') : 'unchanged'
  if (purgedPolicy === 'project') return 'read'
  if (purgedPolicy === 'admins' || purgedPolicy === 'remove') return 'none'
  let level: FolderLevel = 'write'
  const seen = new Set<string>()
  for (let current = tree.get(folderId); current; ) {
    if (seen.has(current.id)) return 'none'
    seen.add(current.id)
    if (current.accessMode === 'custom') level = lower(level, listLevel(current, clearance))
    if (level === 'none' || current.parentId === null) return level
    const parent = tree.get(current.parentId)
    if (!parent) return 'none'
    current = parent
  }
  return level
}

export function unreadableFoldersBelow(tree: FolderTree, clearance: FolderClearance, folderId: string): string[] {
  const isBelow = (folder: AccessFolder): boolean => {
    const seen = new Set<string>([folder.id])
    for (let parent = folder.parentId; parent !== null && !seen.has(parent); parent = tree.get(parent)?.parentId ?? null) {
      if (parent === folderId) return true
      seen.add(parent)
    }
    return false
  }
  return [...tree.values()]
    .filter((folder) => !folder.deleted && isBelow(folder))
    .filter((folder) => !atLeast(effectiveFolderLevel(tree, clearance, folder.id), 'read'))
    .map((folder) => folder.id)
}

export function withProjectCeiling(level: FolderLevel, projectMayWrite: boolean): FolderLevel {
  return level === 'write' && !projectMayWrite ? 'read' : level
}

export function restrictsReading(folder: AccessFolder): boolean {
  return folder.accessMode === 'custom' && !folder.everyoneReads
}

export const ANY_MEMBER: FolderClearance = { levels: {}, seesEverything: false }

export const EVERY_FOLDER: FolderClearance = { levels: {}, seesEverything: true }

export function readableByEveryMember(tree: FolderTree, folderId: string): boolean {
  return atLeast(effectiveFolderLevel(tree, ANY_MEMBER, folderId), 'read')
}

export function readRestrictingFoldersOnPath(tree: FolderTree, folderId: string | null): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (let current = folderId ? tree.get(folderId) : undefined; current && !seen.has(current.id); ) {
    seen.add(current.id)
    if (restrictsReading(current)) found.push(current.id)
    current = current.parentId ? tree.get(current.parentId) : undefined
  }
  return found
}

export function isUnderOwnList(tree: FolderTree, folderId: string | null): boolean {
  const seen = new Set<string>()
  for (let current = folderId ? tree.get(folderId) : undefined; current && !seen.has(current.id); ) {
    if (current.accessMode === 'custom') return true
    seen.add(current.id)
    current = current.parentId ? tree.get(current.parentId) : undefined
  }
  return false
}

export interface ProjectFolderAccess {
  readonly hiddenFolderIds: ReadonlySet<string>
  isVisible(folderId: string | null): boolean
  levelOf(folderId: string | null): FolderLevel
  collectionFor(folderId: string | null): string
  sourceFolderOf(collection: string): string | null
  readonly clearedRestrictedCollections: readonly string[]
  readonly anyRestricted: boolean
}

export function restrictedCollectionName(projectCollection: string, folderId: string): string {
  return `${projectCollection}_r${folderId.replace(/-/g, '').slice(0, 12).toLowerCase()}`
}

export function isRestrictedCollectionOf(projectCollection: string, collection: string): boolean {
  return collection.startsWith(`${projectCollection}_r`) && /^[0-9a-f]{12}$/.test(collection.slice(projectCollection.length + 2))
}

export function restrictedCollectionBase(collection: string): string | null {
  const match = /^(.+)_r[0-9a-f]{12}$/.exec(collection)
  return match ? match[1] : null
}

export const OPEN_ACCESS = (projectCollection: string, tree: FolderTree = new Map()): ProjectFolderAccess => ({
  hiddenFolderIds: new Set([...tree.values()].filter((folder) => folder.deleted).map((folder) => folder.id)),
  isVisible: (folderId) => folderId === null || tree.size === 0 || (tree.has(folderId) && !tree.get(folderId)?.deleted),
  levelOf: (folderId) => (folderId === null || tree.size === 0 || tree.has(folderId) ? 'write' : 'none'),
  collectionFor: () => projectCollection,
  sourceFolderOf: () => null,
  clearedRestrictedCollections: [],
  anyRestricted: false,
})

export function computeFolderAccess(
  folders: readonly AccessFolder[],
  clearance: FolderClearance,
  projectCollection: string
): ProjectFolderAccess {
  const tree = folderTree(folders)
  const living = folders.filter((folder) => !folder.deleted)
  if (!folders.some((folder) => folder.accessMode === 'custom' || folder.deleted)) return OPEN_ACCESS(projectCollection, tree)
  const levels = new Map(folders.map((folder) => [folder.id, effectiveFolderLevel(tree, clearance, folder.id)]))
  const levelOf = (folderId: string | null): FolderLevel =>
    folderId === null ? 'write' : (levels.get(folderId) ?? 'none')

  const hidden = new Set(
    folders.filter((folder) => folder.deleted || !atLeast(levelOf(folder.id), 'read')).map((folder) => folder.id)
  )
  const nearestRestricting = new Map(living.map((folder) => [folder.id, readRestrictingFoldersOnPath(tree, folder.id)[0] ?? null]))
  const restricting = living.filter(restrictsReading)
  const bySourceCollection = new Map(
    restricting.map((folder) => [restrictedCollectionName(projectCollection, folder.id), folder.id])
  )

  return {
    hiddenFolderIds: hidden,
    isVisible: (folderId) =>
      folderId === null || (tree.has(folderId) && !tree.get(folderId)?.deleted && !hidden.has(folderId)),
    levelOf,
    collectionFor: (folderId) => {
      const nearest = folderId ? nearestRestricting.get(folderId) : null
      return nearest ? restrictedCollectionName(projectCollection, nearest) : projectCollection
    },
    sourceFolderOf: (collection) => bySourceCollection.get(collection) ?? null,
    clearedRestrictedCollections: restricting
      .filter((folder) => atLeast(levelOf(folder.id), 'read'))
      .map((folder) => restrictedCollectionName(projectCollection, folder.id)),
    anyRestricted: living.some((folder) => folder.accessMode === 'custom') || folders.some((folder) => folder.deleted && !folder.purgedAt),
  }
}

export function unreadableFolderIds(access: ProjectFolderAccess): string[] {
  return [...access.hiddenFolderIds].filter((folderId) => !atLeast(access.levelOf(folderId), 'read'))
}

export const FOLDER_SUBTREE_UNREADABLE_REASON = 'folder-subtree-unreadable'

export function folderSubtreeUnreadableError(): ForbiddenError {
  return new ForbiddenError(
    'This folder contains folders you cannot read, so you cannot change who may read it. Ask an organization admin to move it.',
    { reason: FOLDER_SUBTREE_UNREADABLE_REASON }
  )
}

export function folderReadOnlyError(): ForbiddenError {
  return new ForbiddenError('You can read this folder but not change it.', { reason: FOLDER_READ_ONLY_REASON })
}
