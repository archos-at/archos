import 'server-only'
import { getCached } from '@/lib/cache'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getWorkOS } from '@/lib/workos/client'
import { rolesHoldPermission } from './org-role-permissions'
import { ORG_PERMISSIONS, type ProjectPermission } from './permissions'
import { findProjectTenancy } from '@/lib/projects/repository'
import { CLOSED_PROJECT_KEEPS, CLOSED_PROJECT_OPEN_TO_ORGANIZATION, isProjectClosed } from '@/lib/projects/project-status'
import { inPool } from '@/lib/utils/in-pool'
import { effectiveResourcePermissions } from './resource-check'

export const MEMBERSHIP_TTL_MS = 60 * 1000
const MEMBERSHIP_NEGATIVE_TTL_MS = 30 * 1000

export interface SubjectMembership {
  organizationMembershipId: string
  roles: string[]
  role: string | null
}

export function rolesOfMembership(membership: {
  role?: { slug?: string | null } | null
  roles?: ReadonlyArray<{ slug?: string | null }> | null
}): string[] {
  const listed = (membership.roles ?? []).map((role) => role.slug).filter((slug): slug is string => Boolean(slug))
  if (listed.length > 0) return [...new Set(listed)]
  return membership.role?.slug ? [membership.role.slug] : []
}

export async function lookupSubjectMembership(organizationId: string, userId: string): Promise<SubjectMembership | null> {
  return getCached(
    `org-membership:${organizationId}:${userId}`,
    MEMBERSHIP_TTL_MS,
    async () => {
      const memberships = await getWorkOS().userManagement.listOrganizationMemberships({
        userId,
        organizationId,
        statuses: ['active'],
        limit: 1,
      })
      const membership = memberships.data[0]
      if (!membership) return null
      const roles = rolesOfMembership(membership)
      return { organizationMembershipId: membership.id, roles, role: roles[0] ?? null } satisfies SubjectMembership
    },
    { negativeTtlMs: MEMBERSHIP_NEGATIVE_TTL_MS }
  )
}

export async function resolveSubjectMembership(organizationId: string, userId: string): Promise<SubjectMembership | null> {
  try {
    return await lookupSubjectMembership(organizationId, userId)
  } catch (error) {
    console.warn(`[project-membership] lookup failed for ${userId}:`, error)
    return null
  }
}

export async function isUserInOrganization(
  session: AuthorizedSession,
  targetUserId: string
): Promise<boolean> {
  return (await resolveSubjectMembership(session.organizationId, targetUserId)) !== null
}

export async function canUserAccessProject(
  session: AuthorizedSession,
  projectId: string,
  targetUserId: string
): Promise<boolean> {
  return userHoldsProjectPermission(session, projectId, targetUserId, 'project:view')
}

export async function userHoldsProjectPermission(
  session: Pick<AuthorizedSession, 'organizationId'>,
  projectId: string,
  targetUserId: string,
  permission: ProjectPermission
): Promise<boolean> {
  return holdsProjectPermission(session, projectId, targetUserId, permission, false)
}

export async function userHoldsProjectPermissionStrict(
  session: Pick<AuthorizedSession, 'organizationId'>,
  projectId: string,
  targetUserId: string,
  permission: ProjectPermission
): Promise<boolean> {
  return holdsProjectPermission(session, projectId, targetUserId, permission, true)
}

async function holdsProjectPermission(
  session: Pick<AuthorizedSession, 'organizationId'>,
  projectId: string,
  targetUserId: string,
  permission: ProjectPermission,
  strict: boolean
): Promise<boolean> {
  const membership = strict
    ? await lookupSubjectMembership(session.organizationId, targetUserId)
    : await resolveSubjectMembership(session.organizationId, targetUserId)
  if (!membership) return false

  const project = await findProjectTenancy(projectId)
  if (!project || project.organizationId !== session.organizationId || project.deletedAt) return false
  if (isProjectClosed(project)) {
    if (!CLOSED_PROJECT_KEEPS.has(permission)) return false
    if (CLOSED_PROJECT_OPEN_TO_ORGANIZATION.has(permission)) return true
  }

  if (await rolesHoldPermission(session.organizationId, membership.roles, ORG_PERMISSIONS.projectsAdminister)) {
    return true
  }

  const held = await effectiveResourcePermissions(
    {
      organizationMembershipId: membership.organizationMembershipId,
      organizationId: session.organizationId,
      resourceExternalId: projectId,
      resourceTypeSlug: 'project',
    },
    { strict }
  )
  return held.has(permission)
}

export async function filterUsersWithProjectAccess(
  session: AuthorizedSession,
  projectId: string,
  candidateUserIds: readonly string[]
): Promise<Set<string>> {
  return filterUsersWithProjectPermission(session, projectId, candidateUserIds, 'project:view')
}

export const PERMISSION_CHECKS_AT_ONCE = 8

export async function filterUsersWithProjectPermission(
  session: AuthorizedSession,
  projectId: string,
  candidateUserIds: readonly string[],
  permission: ProjectPermission
): Promise<Set<string>> {
  const results = await inPool(candidateUserIds, PERMISSION_CHECKS_AT_ONCE, async (userId) => ({
    userId,
    allowed: await userHoldsProjectPermission(session, projectId, userId, permission),
  }))
  return new Set(results.filter((result) => result.allowed).map((result) => result.userId))
}
