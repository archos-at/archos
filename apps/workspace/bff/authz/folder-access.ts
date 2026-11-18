import 'server-only'
import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { hasPermission, ORG_PERMISSIONS } from './permissions'
import { rolesHoldPermission } from './org-role-permissions'
import { resolveMembershipRoles } from '@/lib/auth/membership-roles'
import { requireProjectAccess } from './projects'
import { effectiveResourcePermissions } from './resource-check'
import { resolveSubjectMembership } from './project-membership'
import { findProjectTenancy } from '@/lib/projects/repository'
import { isProjectClosed, isProjectClosedError } from '@/lib/projects/project-status'
import {
  listCustomFolderNames,
  listProjectFolderTree,
  listProjectsWithCustomOrBinnedFolders,
  projectHasCustomFolders,
  projectHasCustomOrBinnedFolders,
} from './folder-access-repository'
import { heldFolderLevels } from './folder-roles'
import {
  ANY_MEMBER,
  atLeast,
  computeFolderAccess,
  DOCUMENT_WRITE_PERMISSIONS,
  effectiveFolderLevel,
  EVERY_FOLDER,
  folderReadOnlyError,
  folderTree,
  OPEN_ACCESS,
  type AccessFolder,
  type FolderClearance,
  type ProjectFolderAccess,
} from './folder-access-rule'

export * from './folder-access-rule'

function anyRoleAdministers(organizationId: string, roles: readonly string[]): Promise<boolean> {
  return rolesHoldPermission(organizationId, roles, ORG_PERMISSIONS.projectsAdminister)
}

export async function seesEveryFolder(session: AuthorizedSession): Promise<boolean> {
  const current = await resolveMembershipRoles(session.organizationId, session.userId)
  return current === null
    ? hasPermission(session, ORG_PERMISSIONS.projectsAdminister)
    : anyRoleAdministers(session.organizationId, current)
}

async function folderLevelsIn(
  organizationId: string,
  organizationMembershipId: string | null,
  projectId: string
): Promise<FolderClearance['levels']> {
  if (!organizationMembershipId) return {}
  if (!(await projectHasCustomFolders(organizationId, projectId))) return {}
  return heldFolderLevels(organizationId, organizationMembershipId, projectId)
}

export async function clearanceOf(session: AuthorizedSession, projectId: string): Promise<FolderClearance> {
  if (await seesEveryFolder(session)) return EVERY_FOLDER
  const outsider = await readsOnlyBecauseClosed(session.organizationId, projectId, session.organizationMembershipId)
  if (outsider) return ANY_MEMBER
  return {
    levels: await folderLevelsIn(session.organizationId, session.organizationMembershipId, projectId),
    seesEverything: false,
  }
}

async function readsOnlyBecauseClosed(
  organizationId: string,
  projectId: string,
  organizationMembershipId: string | null
): Promise<boolean> {
  const project = await findProjectTenancy(projectId)
  if (!isProjectClosed(project)) return false
  if (!organizationMembershipId) return true
  const held = await effectiveResourcePermissions({
    organizationMembershipId,
    organizationId,
    resourceExternalId: projectId,
    resourceTypeSlug: 'project',
  })
  return !held.has('project:view')
}

export async function loadCustomFolderTree(organizationId: string, projectId: string): Promise<AccessFolder[] | null> {
  if (!(await projectHasCustomOrBinnedFolders(organizationId, projectId))) return null
  return listProjectFolderTree(organizationId, projectId)
}

export async function getProjectFolderAccess(
  session: AuthorizedSession,
  projectId: string,
  projectCollection: string
): Promise<ProjectFolderAccess> {
  const folders = await loadCustomFolderTree(session.organizationId, projectId)
  if (!folders) return OPEN_ACCESS(projectCollection)
  return computeFolderAccess(folders, await clearanceOf(session, projectId), projectCollection)
}

export async function getHiddenFolderIds(session: AuthorizedSession, projectId: string): Promise<string[]> {
  const folders = await loadCustomFolderTree(session.organizationId, projectId)
  if (!folders) return []
  return [...computeFolderAccess(folders, await clearanceOf(session, projectId), '').hiddenFolderIds]
}

export async function getRestrictedFolderIds(organizationId: string, projectId: string): Promise<string[]> {
  const folders = await loadCustomFolderTree(organizationId, projectId)
  if (!folders) return []
  return [...computeFolderAccess(folders, ANY_MEMBER, '').hiddenFolderIds]
}

export async function isFolderVisibleTo(
  session: AuthorizedSession,
  projectId: string,
  folderId: string | null
): Promise<boolean> {
  if (folderId === null) return true
  return isFolderVisibleToClearance(session.organizationId, projectId, folderId, await clearanceOf(session, projectId))
}

export async function isFolderVisibleToClearance(
  organizationId: string,
  projectId: string,
  folderId: string | null,
  clearance: FolderClearance
): Promise<boolean> {
  if (folderId === null) return true
  const folders = await loadCustomFolderTree(organizationId, projectId)
  if (!folders) return true
  return computeFolderAccess(folders, clearance, '').isVisible(folderId)
}

export async function filterUsersWhoMayReadFolder(
  organizationId: string,
  projectId: string,
  folderId: string | null,
  userIds: readonly string[]
): Promise<Set<string>> {
  return filterUsersByFolderLevel(organizationId, projectId, folderId, userIds, 'read')
}

export async function filterUsersWhoMayWriteFolder(
  organizationId: string,
  projectId: string,
  folderId: string | null,
  userIds: readonly string[]
): Promise<Set<string>> {
  return filterUsersByFolderLevel(organizationId, projectId, folderId, userIds, 'write')
}

async function filterUsersByFolderLevel(
  organizationId: string,
  projectId: string,
  folderId: string | null,
  userIds: readonly string[],
  needed: 'read' | 'write'
): Promise<Set<string>> {
  if (folderId === null || userIds.length === 0) return new Set(userIds)
  const folders = await loadCustomFolderTree(organizationId, projectId)
  if (!folders) return new Set(userIds)
  const clearances = await Promise.all(userIds.map((userId) => clearanceOfMember(organizationId, userId, projectId)))
  return new Set(
    userIds.filter((_userId, index) => {
      const access = computeFolderAccess(folders, clearances[index], '')
      return access.isVisible(folderId) && (needed === 'read' || access.levelOf(folderId) === 'write')
    })
  )
}

export async function projectMayWriteDocuments(session: AuthorizedSession, projectId: string): Promise<boolean> {
  try {
    await requireProjectAccess(session, projectId, DOCUMENT_WRITE_PERMISSIONS)
    return true
  } catch (error) {
    if (error instanceof NotFoundError || isProjectClosedError(error)) return false
    throw error
  }
}

export async function requireFolderWrite(
  session: AuthorizedSession,
  projectId: string,
  folderIds: readonly (string | null)[]
): Promise<void> {
  await requireProjectAccess(session, projectId, DOCUMENT_WRITE_PERMISSIONS)
  const touched = [...new Set(folderIds)].filter((folderId): folderId is string => folderId !== null)
  if (touched.length === 0) return
  const folders = await loadCustomFolderTree(session.organizationId, projectId)
  const access = folders ? computeFolderAccess(folders, await clearanceOf(session, projectId), '') : OPEN_ACCESS('')
  for (const folderId of touched) {
    if (!access.isVisible(folderId)) throw new NotFoundError('Folder not found')
  }
  if (touched.some((folderId) => access.levelOf(folderId) !== 'write')) throw folderReadOnlyError()
}

export async function canWriteFolder(
  session: AuthorizedSession,
  projectId: string,
  folderId: string | null
): Promise<boolean> {
  try {
    await requireFolderWrite(session, projectId, [folderId])
    return true
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return false
    throw error
  }
}

export async function placementCollectionFor(
  organizationId: string,
  projectId: string,
  projectCollection: string,
  folderId: string | null
): Promise<string> {
  if (folderId === null) return projectCollection
  const folders = await loadCustomFolderTree(organizationId, projectId)
  if (!folders) return projectCollection
  return computeFolderAccess(folders, EVERY_FOLDER, projectCollection).collectionFor(folderId)
}

export async function currentRestrictedCollections(
  organizationId: string,
  projectId: string,
  projectCollection: string
): Promise<string[]> {
  const folders = await loadCustomFolderTree(organizationId, projectId)
  if (!folders) return []
  return [
    ...computeFolderAccess(folders, EVERY_FOLDER, projectCollection).clearedRestrictedCollections,
  ]
}

export async function customFolderNames(organizationId: string, projectId: string): Promise<Map<string, string>> {
  const folders = await listCustomFolderNames(organizationId, projectId)
  return new Map(folders.map((folder) => [folder.id, folder.name]))
}

export async function clearanceOfMember(
  organizationId: string,
  userId: string,
  projectId: string
): Promise<FolderClearance> {
  const roles = await resolveMembershipRoles(organizationId, userId)
  if (!roles || roles.length === 0) return ANY_MEMBER
  if (await anyRoleAdministers(organizationId, roles)) return EVERY_FOLDER
  const membership = await resolveSubjectMembership(organizationId, userId)
  const membershipId = membership?.organizationMembershipId ?? null
  if (!membershipId) return ANY_MEMBER
  const project = await findProjectTenancy(projectId)
  if (isProjectClosed(project) && (await readsOnlyBecauseClosed(organizationId, projectId, membershipId))) {
    return ANY_MEMBER
  }
  return { levels: await folderLevelsIn(organizationId, membershipId, projectId), seesEverything: false }
}

export async function isFolderVisibleToMember(
  organizationId: string,
  projectId: string,
  folderId: string | null,
  userId: string
): Promise<boolean> {
  if (folderId === null) return true
  const folders = await loadCustomFolderTree(organizationId, projectId)
  if (!folders) return true
  const clearance = await clearanceOfMember(organizationId, userId, projectId)
  return computeFolderAccess(folders, clearance, '').isVisible(folderId)
}

export async function readableFolderIdsFor(
  organizationId: string,
  projectId: string,
  clearance: FolderClearance
): Promise<string[]> {
  const folders = await listProjectFolderTree(organizationId, projectId)
  const tree = folderTree(folders)
  return folders
    .filter((folder) => atLeast(effectiveFolderLevel(tree, clearance, folder.id), 'read'))
    .map((folder) => folder.id)
}

export const RESTRICTED_PROJECT_READS_AT_ONCE = 4

export async function readableFoldersOfRestrictedProjects(session: AuthorizedSession): Promise<string[]> {
  const { organizationId } = session
  const projectIds = await listProjectsWithCustomOrBinnedFolders(organizationId)
  const readable: string[][] = []
  let next = 0
  const reader = async (): Promise<void> => {
    for (let index = next++; index < projectIds.length; index = next++) {
      const projectId = projectIds[index]
      readable[index] = await readableFolderIdsFor(organizationId, projectId, await clearanceOf(session, projectId))
    }
  }
  const readers = Math.min(RESTRICTED_PROJECT_READS_AT_ONCE, projectIds.length)
  await Promise.all(Array.from({ length: readers }, reader))
  return readable.flat()
}

export async function sourceFoldersOfCollections(
  organizationId: string,
  projectId: string,
  projectCollection: string,
  collections: readonly string[]
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  if (collections.length === 0) return found
  const folders = await loadCustomFolderTree(organizationId, projectId)
  if (!folders) return found
  const access = computeFolderAccess(folders, EVERY_FOLDER, projectCollection)
  for (const collection of collections) {
    const folderId = access.sourceFolderOf(collection)
    if (folderId) found.set(collection, folderId)
  }
  return found
}

export async function purgedFolderDates(organizationId: string, projectId: string): Promise<Map<string, Date>> {
  const folders = await listProjectFolderTree(organizationId, projectId)
  return new Map(folders.flatMap((folder) => (folder.purgedAt ? [[folder.id, folder.purgedAt] as const] : [])))
}
