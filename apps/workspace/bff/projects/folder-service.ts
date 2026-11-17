import type { AuthorizedSession } from '@/lib/auth/types'
import { recordAuditEvent } from '@/lib/audit/service'
import {
  clearanceOf,
  computeFolderAccess,
  folderReadOnlyError,
  folderSubtreeUnreadableError,
  getProjectFolderAccess,
  projectMayWriteDocuments,
  requireFolderWrite,
  unreadableFoldersBelow,
  withProjectCeiling,
  type AccessFolder,
} from '@/lib/authz/folder-access'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import { requireProjectAccess } from '@/lib/authz/projects'
import { projectShelf } from '@/lib/documents/shelf'
import {
  createShelfFolder,
  ensureShelfFolderPaths,
  findShelfFolder,
  findShelfRootFolder,
  getOrCreateShelfRootFolder,
  listShelfFolders,
  mirrorShelfFolderPathRewrite,
  updateShelfFolder,
  type FolderRow,
  type ShelfFolderVisibility,
} from '@/lib/documents/shelf-folders'
import { findProjectInOrg } from '@/lib/projects/repository'
import { placeProjectDocuments } from './collection-placement'
import type { BinFolderResult } from './folder-bin'
import { assertFolderMoveKeepsIfcOpen } from './ifc-folder-guard'

export { toFolderRow } from '@/lib/documents/shelf-folders'
export type { FolderRow } from '@/lib/documents/shelf-folders'

export interface CreateFolderInput {
  projectId: string
  parentId?: string | null
  name: string
  description?: string | null
}

export interface UpdateFolderInput {
  projectId: string
  folderId: string
  name?: string
  parentId?: string | null
  description?: string | null
}

export interface DeleteFolderInput {
  projectId: string
  folderId: string
}

export interface EnsureFolderPathsInput {
  projectId: string
  parentId: string | null
  paths: readonly string[]
}

export interface ProjectFolderRow extends FolderRow {
  ownAccess: { everyoneReads: boolean } | null
  access: 'read' | 'write'
}

const DOCUMENT_WRITE = ['project:documents:write', 'project:edit'] as const

async function folderAccessFor(session: AuthorizedSession, projectId: string) {
  const project = await findProjectInOrg(projectId, session.organizationId)
  return getProjectFolderAccess(session, projectId, project?.collectionName ?? '')
}

export async function listProjectFolders(projectId: string, session: AuthorizedSession): Promise<ProjectFolderRow[]> {
  const [rows, project, tree, projectWrite] = await Promise.all([
    listShelfFolders(session, projectShelf(projectId)),
    findProjectInOrg(projectId, session.organizationId),
    listProjectFolderTree(session.organizationId, projectId),
    projectMayWriteDocuments(session, projectId),
  ])
  const access = computeFolderAccess(tree, await clearanceOf(session, projectId), project?.collectionName ?? '')
  const byId = new Map(tree.map((folder) => [folder.id, folder]))
  return rows
    .filter((row) => access.isVisible(row.id))
    .map((row) => {
      const own = byId.get(row.id)
      return {
        ...row,
        ownAccess: own?.accessMode === 'custom' ? { everyoneReads: own.everyoneReads } : null,
        access: withProjectCeiling(access.levelOf(row.id), projectWrite) === 'write' ? 'write' : 'read',
      }
    })
}

export async function projectRootAccess(session: AuthorizedSession, projectId: string): Promise<'read' | 'write'> {
  return (await projectMayWriteDocuments(session, projectId)) ? 'write' : 'read'
}

export async function createProjectFolder(input: CreateFolderInput, session: AuthorizedSession) {
  await requireFolderWrite(session, input.projectId, [input.parentId ?? null])
  return createShelfFolder(session, projectShelf(input.projectId), input)
}

export function findRootProjectFolderByName(
  projectId: string,
  name: string,
  organizationId: string,
): Promise<FolderRow | null> {
  return findShelfRootFolder(projectShelf(projectId), organizationId, name)
}

export function getOrCreateProjectFolderByName(
  projectId: string,
  name: string,
  organizationId: string,
): Promise<FolderRow> {
  return getOrCreateShelfRootFolder(projectShelf(projectId), organizationId, name)
}

export async function ensureProjectFolderPaths(input: EnsureFolderPathsInput, session: AuthorizedSession) {
  const access = await folderAccessFor(session, input.projectId)
  const visibility: ShelfFolderVisibility = {
    isVisible: (folderId) => access.isVisible(folderId),
    assertMayCreateIn: (parentId) => {
      if (access.levelOf(parentId) !== 'write') throw folderReadOnlyError()
    },
    recheckVisible: async (folderId) => (await folderAccessFor(session, input.projectId)).isVisible(folderId),
  }
  return ensureShelfFolderPaths(session, projectShelf(input.projectId), input, visibility)
}

function restrictionsAt(tree: ReadonlyMap<string, AccessFolder>, folderId: string | null): AccessFolder[] {
  const chain: AccessFolder[] = []
  const seen = new Set<string>()
  for (let current = folderId ? tree.get(folderId) : undefined; current && !seen.has(current.id); ) {
    seen.add(current.id)
    if (current.accessMode === 'custom') chain.unshift(current)
    current = current.parentId ? tree.get(current.parentId) : undefined
  }
  return chain
}

function describeRestrictions(chain: readonly AccessFolder[]): string {
  return chain.map((folder) => `folder:${folder.id}${folder.everyoneReads ? '+*' : ''}`).join(';')
}

async function folderTree(organizationId: string, projectId: string): Promise<Map<string, AccessFolder>> {
  return new Map((await listProjectFolderTree(organizationId, projectId)).map((entry) => [entry.id, entry]))
}

async function recordFolderAccessChange(
  session: AuthorizedSession,
  projectId: string,
  folderId: string,
  grants: string,
  documentsMoved: number,
  request: Request | undefined,
): Promise<void> {
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'project.folder.access_changed',
    targetType: 'project',
    targetId: projectId,
    metadata: { folderId, grants, roles: '', documentsMoved },
    request,
  })
}

async function checkMove(
  session: AuthorizedSession,
  projectId: string,
  folder: { id: string; parentId: string | null },
  parentId: string | null,
): Promise<AccessFolder[] | null> {
  const tree = await folderTree(session.organizationId, projectId)
  const before = restrictionsAt(tree, folder.parentId)
  const after = restrictionsAt(tree, parentId)
  const unchanged = before.length === after.length && before.every((entry, i) => entry.id === after[i].id)
  let accessAfter: AccessFolder[] | null = null
  if (!unchanged) {
    await requireProjectAccess(session, projectId, 'project:manage')
    if (unreadableFoldersBelow(tree, await clearanceOf(session, projectId), folder.id).length > 0) {
      throw folderSubtreeUnreadableError()
    }
    const own = tree.get(folder.id)
    accessAfter = [...after, ...(own && own.accessMode === 'custom' ? [own] : [])]
  }
  await assertFolderMoveKeepsIfcOpen(session.organizationId, projectId, folder.id, parentId)
  return accessAfter
}

export async function updateProjectFolder(input: UpdateFolderInput, session: AuthorizedSession, request?: Request) {
  const shelf = projectShelf(input.projectId)
  const folder = await findShelfFolder(shelf, session.organizationId, input.folderId)
  if (!folder) {
    await requireProjectAccess(session, input.projectId, [...DOCUMENT_WRITE])
    return { ok: false as const, error: 'Folder not found.' }
  }
  const moving = input.parentId !== undefined && input.parentId !== folder.parentId
  await requireFolderWrite(session, input.projectId, moving ? [folder.id, input.parentId ?? null] : [folder.id])
  const accessAfter = moving ? await checkMove(session, input.projectId, folder, input.parentId ?? null) : null

  const result = await updateShelfFolder(session, shelf, input)
  if (!result.ok || !moving || result.folder.parentId === folder.parentId) return result
  const placement = await placeProjectDocuments(session.organizationId, input.projectId)
  if (accessAfter) {
    const grants = describeRestrictions(accessAfter)
    await recordFolderAccessChange(session, input.projectId, folder.id, grants, placement.moved, request)
  }
  return result
}

export async function deleteProjectFolder(
  input: DeleteFolderInput,
  session: AuthorizedSession,
  request?: Request,
): Promise<BinFolderResult> {
  const { moveFolderToBin } = await import('./folder-bin')
  return moveFolderToBin(session, input, request)
}

export function mirrorFolderPathRewrite(
  projectId: string,
  organizationId: string,
  fromPath: string,
  toPath: string,
): Promise<void> {
  return mirrorShelfFolderPathRewrite(projectShelf(projectId), organizationId, fromPath, toPath)
}
