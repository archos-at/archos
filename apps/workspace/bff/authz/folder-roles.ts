import 'server-only'
import { randomUUID } from 'node:crypto'
import { getCached, setCached } from '@/lib/cache'
import { getWorkOS } from '@/lib/workos/client'
import { timedWorkOSCall } from '@/lib/workos/instrumentation'
import { authzCacheTtlMs } from './resource-check'
import { FOLDER_PERMISSIONS } from './permissions'
import type { FolderGrantLevel } from './folder-access-rule'

export const FOLDER_RESOURCE_TYPE = 'folder'

export const FOLDER_ROLE_BY_LEVEL: Readonly<Record<FolderGrantLevel, string>> = {
  read: 'folder-reader',
  write: 'folder-editor',
}

export interface FolderRoleHolder {
  organizationMembershipId: string
  userId: string
  level: FolderGrantLevel
}

const GENERATION_TTL_MS = 24 * 60 * 60 * 1000

const generationKey = (organizationId: string, projectId: string) =>
  `authz:folder-levels-generation:${organizationId}:${projectId}`

async function levelsGeneration(organizationId: string, projectId: string): Promise<string> {
  return getCached(generationKey(organizationId, projectId), GENERATION_TTL_MS, async () => randomUUID())
}

export async function bumpFolderLevels(organizationId: string, projectId: string): Promise<void> {
  await setCached(generationKey(organizationId, projectId), randomUUID(), GENERATION_TTL_MS)
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404
}

async function folderIdsWith(
  organizationMembershipId: string,
  projectId: string,
  permissionSlug: string
): Promise<string[]> {
  const page = await timedWorkOSCall(`authorization.listResourcesForMembership ${permissionSlug}`, () =>
    getWorkOS().authorization.listResourcesForMembership({
      organizationMembershipId,
      permissionSlug,
      parentResourceTypeSlug: 'project',
      parentResourceExternalId: projectId,
    })
  )
  const resources = await page.autoPagination()
  return resources.filter((resource) => resource.resourceTypeSlug === FOLDER_RESOURCE_TYPE).map((resource) => resource.externalId)
}

export async function heldFolderLevels(
  organizationId: string,
  organizationMembershipId: string,
  projectId: string
): Promise<Record<string, FolderGrantLevel>> {
  const load = async (): Promise<Record<string, FolderGrantLevel>> => {
    const [readable, writable] = await Promise.all([
      folderIdsWith(organizationMembershipId, projectId, FOLDER_PERMISSIONS.read),
      folderIdsWith(organizationMembershipId, projectId, FOLDER_PERMISSIONS.write),
    ])
    const levels: Record<string, FolderGrantLevel> = {}
    for (const folderId of readable) levels[folderId] = 'read'
    for (const folderId of writable) levels[folderId] = 'write'
    return levels
  }
  const ttlMs = authzCacheTtlMs()
  try {
    if (ttlMs <= 0) return await load()
    const generation = await levelsGeneration(organizationId, projectId)
    return await getCached(
      `authz:folder-levels:${organizationId}:${projectId}:${generation}:${organizationMembershipId}`,
      ttlMs,
      load
    )
  } catch (error) {
    console.warn(`[authz] folder roles of ${organizationMembershipId} in project ${projectId} could not be read:`, error)
    return {}
  }
}

async function holdersWith(organizationId: string, folderId: string, permissionSlug: string) {
  const page = await timedWorkOSCall(`authorization.listMembershipsForResource ${permissionSlug}`, () =>
    getWorkOS().authorization.listMembershipsForResourceByExternalId({
      organizationId,
      resourceTypeSlug: FOLDER_RESOURCE_TYPE,
      externalId: folderId,
      permissionSlug,
      assignment: 'direct',
    })
  )
  return page.autoPagination()
}

export async function listFolderRoleHolders(organizationId: string, folderId: string): Promise<FolderRoleHolder[]> {
  try {
    const [readers, writers] = await Promise.all([
      holdersWith(organizationId, folderId, FOLDER_PERMISSIONS.read),
      holdersWith(organizationId, folderId, FOLDER_PERMISSIONS.write),
    ])
    const holders = new Map<string, FolderRoleHolder>()
    for (const membership of readers) {
      holders.set(membership.id, { organizationMembershipId: membership.id, userId: membership.userId, level: 'read' })
    }
    for (const membership of writers) {
      holders.set(membership.id, { organizationMembershipId: membership.id, userId: membership.userId, level: 'write' })
    }
    return [...holders.values()]
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
}

export async function ensureFolderResource(
  organizationId: string,
  projectId: string,
  folderId: string,
  name: string
): Promise<void> {
  const workos = getWorkOS()
  try {
    await timedWorkOSCall('authorization.getResourceByExternalId folder', () =>
      workos.authorization.getResourceByExternalId({ organizationId, resourceTypeSlug: FOLDER_RESOURCE_TYPE, externalId: folderId })
    )
    return
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
  await timedWorkOSCall('authorization.createResource folder', () =>
    workos.authorization.createResource({
      resourceTypeSlug: FOLDER_RESOURCE_TYPE,
      externalId: folderId,
      organizationId,
      name,
      parentResourceTypeSlug: 'project',
      parentResourceExternalId: projectId,
    })
  )
}

export async function replaceFolderRoleHolders(
  organizationId: string,
  projectId: string,
  folderId: string,
  wanted: readonly { organizationMembershipId: string; level: FolderGrantLevel }[]
): Promise<void> {
  try {
    await reconcileFolderRoleHolders(organizationId, folderId, wanted)
  } finally {
    await bumpFolderLevels(organizationId, projectId)
  }
}

async function reconcileFolderRoleHolders(
  organizationId: string,
  folderId: string,
  wanted: readonly { organizationMembershipId: string; level: FolderGrantLevel }[]
): Promise<void> {
  const workos = getWorkOS()
  const resource = { resourceExternalId: folderId, resourceTypeSlug: FOLDER_RESOURCE_TYPE }
  const current = await listFolderRoleHolders(organizationId, folderId)
  const wantedLevel = new Map(wanted.map((holder) => [holder.organizationMembershipId, holder.level]))
  const currentLevel = new Map(current.map((holder) => [holder.organizationMembershipId, holder.level]))

  for (const holder of current) {
    if (wantedLevel.get(holder.organizationMembershipId) === holder.level) continue
    for (const roleSlug of Object.values(FOLDER_ROLE_BY_LEVEL)) {
      try {
        await timedWorkOSCall('authorization.removeRole folder', () =>
          workos.authorization.removeRole({ organizationMembershipId: holder.organizationMembershipId, roleSlug, ...resource })
        )
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    }
  }
  for (const holder of wanted) {
    if (currentLevel.get(holder.organizationMembershipId) === holder.level) continue
    await timedWorkOSCall('authorization.assignRole folder', () =>
      workos.authorization.assignRole({
        organizationMembershipId: holder.organizationMembershipId,
        roleSlug: FOLDER_ROLE_BY_LEVEL[holder.level],
        ...resource,
      })
    )
  }
}

export async function removeFolderResource(organizationId: string, projectId: string, folderId: string): Promise<void> {
  try {
    await timedWorkOSCall('authorization.deleteResourceByExternalId folder', () =>
      getWorkOS().authorization.deleteResourceByExternalId({
        organizationId,
        resourceTypeSlug: FOLDER_RESOURCE_TYPE,
        externalId: folderId,
        cascadeDelete: true,
      })
    )
  } catch (error) {
    if (!isNotFound(error)) throw error
  } finally {
    await bumpFolderLevels(organizationId, projectId)
  }
}
