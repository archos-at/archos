import 'server-only'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import {
  atLeast,
  clearanceOf,
  computeFolderAccess,
  effectiveFolderLevel,
  EVERY_FOLDER,
  folderReadOnlyError,
  folderTree,
  loadCustomFolderTree,
  projectMayWriteDocuments,
  requireFolderWrite,
  type FolderLevel,
} from '@/lib/authz/folder-access'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { requireProjectAccess } from '@/lib/authz/projects'
import { entryIdsForDocuments } from '@/lib/base-knowledge/store/repository'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import { getDb } from '@/lib/db'
import type { Document } from '@/lib/db/schema/documents'
import { withTenant } from '@/lib/db/tenant-context'
import { OFFICE_SHELF, projectShelf, type SharedShelf } from '@/lib/documents/shelf'
import { createShelfFolder, findShelfFolder } from '@/lib/documents/shelf-folders'
import { isUnderStandardsRoot } from '@/lib/office-shelf/standards-folder'
import type { FolderBinAuditAction } from './folder-bin'
import { findFolderInOrg, listDocumentIdsInFolders, type BinFolderRow } from './folder-bin-repository'
import { NORM_HAS_NO_BIN_REASON, type RestoreBlocked } from './folder-bin-wire'
import { createProjectFolder } from './folder-service'
import { findProjectInOrg } from './repository'

export const FOLDER_CONTENTS_PROTECTED_REASON = 'folder-contents-protected'

export interface ShelfBinAccess {
  levelOf(folderId: string): FolderLevel
  mayRestore(): Promise<boolean>
  restoreBlocked: Exclude<RestoreBlocked, 'folder_read_only'>
  mayPurge(): Promise<boolean>
}

export interface ShelfBinAudit {
  targetType: 'project' | 'organization'
  targetId: string
  binned: FolderBinAuditAction
  restored: FolderBinAuditAction
  purged: FolderBinAuditAction
}

export interface ShelfBinPolicy {
  assertMayDelete(session: AuthorizedSession): Promise<void>
  assertMayBinDocument(session: AuthorizedSession, doc: Document): Promise<void>
  createHolder(session: AuthorizedSession, parentId: string | null, name: string): Promise<CreatedHolder>
  assertMayBinSubtree(session: AuthorizedSession, root: BinFolderRow, subtree: readonly string[]): Promise<void>
  access(session: AuthorizedSession): Promise<ShelfBinAccess>
  assertMayPurge(session: AuthorizedSession): Promise<void>
  requesterMayRestore(session: AuthorizedSession): Promise<boolean>
  collectionFor(organizationId: string): Promise<(doc: Document) => string>
  audit(organizationId: string): ShelfBinAudit
}

type CreatedHolder = { ok: true; folder: { id: string } } | { ok: false; error: string }

const PROJECT_WRITE = ['project:documents:write', 'project:edit'] as const

function contentsProtectedError(): ForbiddenError {
  return new ForbiddenError('This folder holds content you may not delete.', { reason: FOLDER_CONTENTS_PROTECTED_REASON })
}

async function passes(check: () => Promise<unknown>): Promise<boolean> {
  try {
    await check()
    return true
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return false
    throw error
  }
}

async function requireProject(organizationId: string, projectId: string) {
  const project = await findProjectInOrg(projectId, organizationId)
  if (!project) throw new NotFoundError('Project not found')
  return project
}

function projectBin(projectId: string): ShelfBinPolicy {
  return {
    async assertMayDelete(session) {
      await requireProjectAccess(session, projectId, [...PROJECT_WRITE])
      await requireProject(session.organizationId, projectId)
    },
    async assertMayBinDocument(session, doc) {
      await requireFolderWrite(session, projectId, [doc.folderId])
    },
    createHolder: (session, parentId, name) => createProjectFolder({ projectId, parentId, name }, session),
    async assertMayBinSubtree(session, root, subtree) {
      const folders = await loadCustomFolderTree(session.organizationId, projectId)
      if (!folders) return
      const access = computeFolderAccess(folders, await clearanceOf(session, projectId), '')
      if (!access.isVisible(root.id)) throw new NotFoundError('Folder not found')
      if (access.levelOf(root.id) !== 'write') throw folderReadOnlyError()
      for (const folderId of subtree) {
        if (folderId === root.id) continue
        if (!access.isVisible(folderId) || access.levelOf(folderId) !== 'write') throw contentsProtectedError()
      }
    },
    async access(session) {
      const { closed } = await requireProjectAccess(session, projectId, 'project:view')
      await requireProject(session.organizationId, projectId)
      const [folders, clearance] = await Promise.all([
        listProjectFolderTree(session.organizationId, projectId),
        clearanceOf(session, projectId),
      ])
      const tree = folderTree(folders)
      return {
        levelOf: (folderId) => effectiveFolderLevel(tree, clearance, folderId),
        mayRestore: () =>
          closed
            ? passes(() => requireProjectAccess(session, projectId, 'project:manage', { evenWhenClosed: true }))
            : projectMayWriteDocuments(session, projectId),
        restoreBlocked: closed ? 'project_closed' : 'no_write',
        mayPurge: () => passes(() => requireProjectAccess(session, projectId, 'project:manage')),
      }
    },
    async assertMayPurge(session) {
      await requireProjectAccess(session, projectId, 'project:manage')
    },
    requesterMayRestore: (session) => passes(() => requireProjectAccess(session, projectId, [...PROJECT_WRITE])),
    async collectionFor(organizationId) {
      const project = await requireProject(organizationId, projectId)
      const folders = await loadCustomFolderTree(organizationId, project.id)
      if (!folders) return () => project.collectionName
      const placement = computeFolderAccess(folders, EVERY_FOLDER, project.collectionName)
      return (doc) => placement.collectionFor(doc.folderId)
    },
    audit: () => ({
      targetType: 'project',
      targetId: projectId,
      binned: 'project.folder.binned',
      restored: 'project.folder.restored',
      purged: 'project.folder.purged',
    }),
  }
}

function normHasNoBin(): ConflictError {
  return new ConflictError('A norm is removed in Normen & Richtlinien, not through the bin.', { reason: NORM_HAS_NO_BIN_REASON })
}

function requireOfficeShelfManager(session: AuthorizedSession): void {
  if (!canManageOfficeShelf(session)) throw new ForbiddenError()
}

const officeShelfBin: ShelfBinPolicy = {
  async assertMayDelete(session) {
    requireOfficeShelfManager(session)
  },
  async assertMayBinDocument(session, doc) {
    requireOfficeShelfManager(session)
    const folder = doc.folderId ? await findShelfFolder(OFFICE_SHELF, session.organizationId, doc.folderId) : undefined
    if (folder && isUnderStandardsRoot(folder.path)) throw normHasNoBin()
    if ((await entryIdsForDocuments(session.organizationId, [doc.id])).size > 0) throw normHasNoBin()
  },
  createHolder: (session, parentId, name) => createShelfFolder(session, OFFICE_SHELF, { parentId, name }),
  async assertMayBinSubtree(session, root, subtree) {
    if (isUnderStandardsRoot(root.path)) throw normHasNoBin()
    await assertNoActiveHold(session.organizationId, 'folder', root.id)
    const documentIds = await withTenant({ organizationId: session.organizationId }, () =>
      listDocumentIdsInFolders(getDb(), root.shelf, session.organizationId, subtree)
    )
    if ((await entryIdsForDocuments(session.organizationId, documentIds)).size > 0) throw normHasNoBin()
  },
  async access(session) {
    const manages = canManageOfficeShelf(session)
    return {
      levelOf: () => 'write',
      mayRestore: async () => manages,
      restoreBlocked: 'no_write',
      mayPurge: async () => manages,
    }
  },
  async assertMayPurge(session) {
    requireOfficeShelfManager(session)
  },
  requesterMayRestore: async (session) => canManageOfficeShelf(session),
  collectionFor: async () => (doc) => doc.collectionName,
  audit: (organizationId) => ({
    targetType: 'organization',
    targetId: organizationId,
    binned: 'office_shelf.folder.binned',
    restored: 'office_shelf.folder.restored',
    purged: 'office_shelf.folder.purged',
  }),
}

export function shelfOfBinPayload(payload: { projectId: string | null }): SharedShelf {
  return payload.projectId === null ? OFFICE_SHELF : projectShelf(payload.projectId)
}

export function binPolicyOf(shelf: SharedShelf): ShelfBinPolicy {
  return shelf.kind === 'project' ? projectBin(shelf.projectId) : officeShelfBin
}

export interface BinEntryOf {
  root: BinFolderRow
  access: ShelfBinAccess
  policy: ShelfBinPolicy
}

export async function binEntryFor(session: AuthorizedSession, shelf: SharedShelf, folderId: string): Promise<BinEntryOf> {
  const policy = binPolicyOf(shelf)
  const access = await policy.access(session)
  const root = await withTenant({ organizationId: session.organizationId }, () =>
    findFolderInOrg(getDb(), shelf, session.organizationId, folderId)
  )
  if (!root || !root.deletedAt || root.purgedAt || root.binRootId !== root.id) throw new NotFoundError('Folder not found')
  if (!atLeast(access.levelOf(root.id), 'read')) throw new NotFoundError('Folder not found')
  return { root, access, policy }
}
