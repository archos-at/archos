import type { AuthorizedSession } from '@/lib/auth/types'
import { NotFoundError } from '@/lib/api/errors'
import { findProjectTenancy } from '@/lib/projects/repository'
import {
  isProjectClosed,
  keptWhenClosed,
  openToOrganizationWhenClosed,
  projectClosedError,
} from '@/lib/projects/project-status'
import { hasPermission, ORG_PERMISSIONS } from './permissions'
import { effectiveResourcePermissions } from './resource-check'

export type ProjectPermission =
  | 'project:view'
  | 'project:edit'
  | 'project:manage'
  | 'project:chat'
  | 'project:documents:write'
  | 'project:documents:generate'
  | 'project:memory:write'
  | 'project:members:manage'
  | 'project:skills:manage'

export type ProjectRole = 'project-viewer' | 'project-editor' | 'project-admin'

const PROJECT_WRITE_PERMISSIONS: readonly ProjectPermission[] = ['project:edit', 'project:documents:write', 'project:memory:write']


export interface ProjectAccess {
  role: ProjectRole
  closed: boolean
  readsBecauseClosed: boolean
}

export async function requireProjectAccess(
  session: AuthorizedSession,
  projectId: string,
  permission: ProjectPermission | readonly ProjectPermission[] = 'project:view',
  options: {
    includeDeleted?: boolean
    evenWhenClosed?: boolean
  } = {}
): Promise<ProjectAccess> {
  const requested: readonly ProjectPermission[] = Array.isArray(permission)
    ? permission
    : [permission as ProjectPermission]
  const project = await findProjectTenancy(projectId)

  if (
    !project ||
    project.organizationId !== session.organizationId ||
    (project.deletedAt && !options.includeDeleted)
  ) {
    throw new NotFoundError()
  }

  const closed = isProjectClosed(project)
  const readOnly = closed && !options.evenWhenClosed
  const accepted = readOnly ? keptWhenClosed(requested) : requested
  if (accepted.length === 0) throw projectClosedError()

  if (hasPermission(session, ORG_PERMISSIONS.projectsAdminister)) {
    return { role: 'project-admin', closed, readsBecauseClosed: false }
  }

  const effective = await effectiveResourcePermissions({
    organizationMembershipId: session.organizationMembershipId,
    organizationId: session.organizationId,
    resourceExternalId: projectId,
    resourceTypeSlug: 'project',
  })

  if (!accepted.some((permission) => effective.has(permission))) {
    if (readOnly && openToOrganizationWhenClosed(accepted)) {
      return { role: 'project-viewer', closed, readsBecauseClosed: true }
    }
    throw new NotFoundError()
  }

  const asMember = (role: ProjectRole): ProjectAccess => ({ role, closed, readsBecauseClosed: false })
  if (effective.has('project:manage')) return asMember('project-admin')

  if (PROJECT_WRITE_PERMISSIONS.some((permission) => effective.has(permission))) {
    return asMember('project-editor')
  }
  return asMember('project-viewer')
}
