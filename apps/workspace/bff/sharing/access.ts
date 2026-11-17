import 'server-only'
import { NotFoundError, ResourceRightsLostError } from '@/lib/api/errors'
import { isFolderVisibleTo } from '@/lib/authz/folder-access'
import { requireProjectAccess, type ProjectRole } from '@/lib/authz/projects'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { ResourceRole, ResourceVisibility, ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { describeResource, roleSatisfies, strongerRole, type ShareableDescriptor } from './registry'
import { findGrantForSubject } from './repository'

export type AccessReason =
  | 'creator'
  | 'grant'
  | 'visibility-project'
  | 'visibility-organization'

export interface ResourceAccess {
  role: ResourceRole | null
  reason: AccessReason | null
  visibility: ResourceVisibility
  container: { organizationId: string; projectId: string | null }
  canEscalate: boolean
  contentLocked: boolean
}

function roleFromProjectRole(projectRole: ProjectRole): ResourceRole {
  switch (projectRole) {
    case 'project-viewer':
      return 'viewer'
    case 'project-editor':
    case 'project-admin':
      return 'collaborator'
  }
}

export function mayTakeOwnership(projectRole: ProjectRole | null, role: ResourceRole | null): boolean {
  return projectRole === 'project-admin' && role !== null && !roleSatisfies(role, 'owner')
}

async function isContentLocked(
  session: AuthorizedSession,
  descriptor: ShareableDescriptor,
  resourceId: string,
): Promise<boolean> {
  if (!descriptor.readersAmong) return false
  const readers = await descriptor.readersAmong(session.organizationId, resourceId, [session.userId], session)
  return !readers.has(session.userId)
}

export async function resolveResourceAccess(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<ResourceAccess> {
  const descriptor = describeResource(resourceType)

  const probe = await descriptor.probe(resourceId)
  if (!probe || probe.organizationId !== session.organizationId || probe.deletedAt) {
    throw new NotFoundError()
  }

  const container = { organizationId: probe.organizationId, projectId: probe.projectId }
  const visibility = probe.visibility

  let projectRole: ProjectRole | null = null
  if (probe.container.kind === 'project' && probe.container.id) {
    const { role } = await requireProjectAccess(session, probe.container.id, 'project:view')
    projectRole = role
    if (probe.folderId && !(await isFolderVisibleTo(session, probe.container.id, probe.folderId))) {
      throw new NotFoundError()
    }
  }

  let role: ResourceRole | null = null
  let reason: AccessReason | null = null

  if (visibility === 'project' && projectRole) {
    role = roleFromProjectRole(projectRole)
    reason = 'visibility-project'
  } else if (visibility === 'organization') {
    role = 'collaborator'
    reason = 'visibility-organization'
  }

  const grant = await findGrantForSubject(resourceType, resourceId, session.userId)
  if (grant) {
    const merged = strongerRole(role, grant.role)
    if (merged !== role) reason = 'grant'
    role = merged
  }

  if (probe.createdBy && probe.createdBy === session.userId) {
    const merged = strongerRole(role, 'owner')
    if (merged !== role) reason = 'creator'
    role = merged
  }

  const contentLocked = role !== null && (await isContentLocked(session, descriptor, resourceId))

  return {
    role,
    reason,
    visibility,
    container,
    contentLocked,
    canEscalate: mayTakeOwnership(projectRole, role),
  }
}

export async function requireResourceAccess(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  minimum: ResourceRole = 'viewer',
  options: RequireResourceAccessOptions = {},
): Promise<ResourceAccess> {
  const access = await resolveResourceAccess(session, resourceType, resourceId)
  if (!roleSatisfies(access.role, minimum)) {
    throw new NotFoundError()
  }
  if (access.contentLocked && !options.allowLocked) throw new ResourceRightsLostError(resourceType)
  return access
}

export async function requireResourceWriteAccess(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<void> {
  await describeResource(resourceType).requireWriteAccess?.(session, resourceId)
}

export interface RequireResourceAccessOptions {
  allowLocked?: boolean
}

export function isShared(visibility: ResourceVisibility, grantCount: number): boolean {
  return visibility !== 'private' || grantCount > 0
}
