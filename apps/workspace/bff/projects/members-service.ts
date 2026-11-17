import 'server-only'
import { getWorkOS } from '@/lib/workos/client'
import { requireProjectAccess, type ProjectPermission } from '@/lib/authz/projects'
import { findRoleSpec, PROJECT_PERMISSION_SPECS } from '@/lib/authz/catalog'
import { hasPermission, ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { effectiveResourcePermissions, forgetResourceGrants } from '@/lib/authz/resource-check'
import { recordAuditEvent } from '@/lib/audit/service'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { pageOfList, type OffsetPage } from '@/lib/api/offset-page'
import { revokeCollaborationForProjectMember } from '@/lib/collaboration/cleanup'
import type { AuthorizedSession } from '@/lib/auth/types'
import { dateToMonth, type Month } from './month'
import { withProjectMembersLock } from './member-change-lock'
import { findProjectWorkosResourceId } from './repository'
import { recordMemberLeft, recordMemberRejoined } from './project-record-service'

export type ProjectMemberRole =
  | 'project-viewer'
  | 'project-contributor'
  | 'project-editor'
  | 'project-admin'

const PROJECT_ADMIN_ROLE_SLUG = 'project-admin'

const LAST_ADMIN_DETAILS = { reason: 'last-admin' } as const

function adminMembershipIds(
  assignments: Array<{ organizationMembershipId: string; role: { slug: string } }>
): Set<string> {
  return new Set(
    assignments
      .filter((assignment) => assignment.role.slug === PROJECT_ADMIN_ROLE_SLUG)
      .map((assignment) => assignment.organizationMembershipId)
  )
}

function assertNotLastAdmin(
  assignments: Array<{ organizationMembershipId: string; role: { slug: string } }>,
  targetMembershipId: string,
  willRemainAdmin: boolean
): void {
  if (willRemainAdmin) return
  const admins = adminMembershipIds(assignments)
  if (!admins.has(targetMembershipId)) return
  const otherAdmins = [...admins].filter((id) => id !== targetMembershipId)
  if (otherAdmins.length === 0) {
    throw new ConflictError(
      'This project must keep at least one admin. Assign another admin before removing this one.',
      LAST_ADMIN_DETAILS
    )
  }
}

type ProjectRoleAssignment = {
  id: string
  organizationMembershipId: string
  role: { slug: string }
  createdAt: Date
  source?: { type: 'direct' | 'group' }
}

function isDirect(assignment: ProjectRoleAssignment): boolean {
  return assignment.source?.type !== 'group'
}

const ROLE_EXCEEDS_OWN_DETAILS = { reason: 'role-exceeds-own' } as const

const EVERY_PROJECT_PERMISSION: readonly string[] = PROJECT_PERMISSION_SPECS.map((spec) => spec.slug)

function permissionsOfRole(roleSlug: string): readonly string[] {
  const spec = findRoleSpec(roleSlug)
  return spec?.tier === 'project' ? spec.permissions : EVERY_PROJECT_PERMISSION
}

async function assertWithinCeiling(
  session: AuthorizedSession,
  projectId: string,
  roleSlugs: readonly string[]
): Promise<void> {
  if (roleSlugs.length === 0 || hasPermission(session, ORG_PERMISSIONS.projectsAdminister)) return
  const held = await effectiveResourcePermissions({
    organizationMembershipId: session.organizationMembershipId,
    organizationId: session.organizationId,
    resourceExternalId: projectId,
    resourceTypeSlug: 'project',
  })
  const beyond = roleSlugs.filter((roleSlug) => permissionsOfRole(roleSlug).some((permission) => !held.has(permission)))
  if (beyond.length > 0) {
    throw new ForbiddenError(
      'You can only grant or take away a project role whose permissions you hold yourself.',
      ROLE_EXCEEDS_OWN_DETAILS
    )
  }
}

async function listAssignments(workosResourceId: string): Promise<ProjectRoleAssignment[]> {
  return getWorkOS()
    .authorization.listRoleAssignmentsForResource({ resourceId: workosResourceId })
    .then((page) => page.autoPagination())
}

const PROJECT_ROLE_BY_PERMISSION: Array<{
  permissionSlug: ProjectPermission
  role: ProjectMemberRole
}> = [
  { permissionSlug: 'project:view', role: 'project-viewer' },
  { permissionSlug: 'project:chat', role: 'project-contributor' },
  { permissionSlug: 'project:edit', role: 'project-editor' },
  { permissionSlug: 'project:documents:write', role: 'project-editor' },
  { permissionSlug: 'project:memory:write', role: 'project-editor' },
  { permissionSlug: 'project:manage', role: 'project-admin' },
]

export interface ProjectMember {
  organizationMembershipId: string
  userId: string
  email: string | null
  profilePictureUrl: string | null
  name: string
  role: ProjectMemberRole | null
  roleAssignmentId: string | null
}

export type ProjectMemberScope = 'members' | 'organization'

export async function listProjectMembers(
  session: AuthorizedSession,
  projectId: string,
  options: { scope?: ProjectMemberScope; page?: OffsetPage } = {}
): Promise<{ members: ProjectMember[]; nextCursor: string | null }> {
  await requireProjectAccess(session, projectId, ['project:members:manage', 'project:manage'])
  const scope = options.scope ?? 'members'
  const workosResourceId = await findProjectWorkosResourceId(projectId, session.organizationId)

  const workos = getWorkOS()

  const [users, orgMemberships, assignments, ...membershipLists] = await Promise.all([
    workos.userManagement
      .listUsers({ organizationId: session.organizationId })
      .then((page) => page.autoPagination()),
    workos.userManagement
      .listOrganizationMemberships({ organizationId: session.organizationId })
      .then((page) => page.autoPagination()),
    workosResourceId ? listAssignments(workosResourceId) : Promise.resolve([]),
    ...PROJECT_ROLE_BY_PERMISSION.map(({ permissionSlug }) =>
      workos.authorization
        .listMembershipsForResourceByExternalId({
          organizationId: session.organizationId,
          resourceTypeSlug: 'project',
          externalId: projectId,
          permissionSlug,
          assignment: 'indirect',
        })
        .then((page) => page.autoPagination())
    ),
  ])

  const projectMemberByUserId = new Map<
    string,
    { organizationMembershipId: string; userId: string; role: ProjectMemberRole }
  >()

  const organizationMembersByUserId = new Map(
    orgMemberships.map((membership) => [membership.userId, membership])
  )

  membershipLists.forEach((memberships, index) => {
    const role = PROJECT_ROLE_BY_PERMISSION[index].role
    for (const membership of memberships) {
      const organizationMembership = organizationMembersByUserId.get(membership.userId)
      projectMemberByUserId.set(membership.userId, {
        organizationMembershipId: organizationMembership?.id ?? membership.id,
        userId: membership.userId,
        role,
      })
    }
  })

  const userById = new Map(users.map((user) => [user.id, user]))
  const removalIdOf = removableAssignmentIds(assignments)

  const rows = orgMemberships.map((organizationMembership) => {
    const user = userById.get(organizationMembership.userId)
    const projectMembership = projectMemberByUserId.get(organizationMembership.userId)
    return {
      organizationMembershipId: organizationMembership.id,
      userId: organizationMembership.userId,
      email: user?.email ?? null,
      profilePictureUrl: user?.profilePictureUrl ?? null,
      name:
        user?.name ||
        (user?.firstName
          ? `${user.firstName} ${user.lastName ?? ''}`.trim()
          : user?.lastName || user?.email || organizationMembership.userId),
      role: projectMembership?.role ?? null,
      roleAssignmentId: projectMembership ? removalIdOf(organizationMembership.id, projectMembership.role) : null,
    }
  })

  const listed = (scope === 'members' ? rows.filter((row) => row.role !== null) : rows).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
  const { rows: members, nextCursor } = pageOfList(listed, options.page ?? { limit: listed.length || 1, offset: 0 })
  return { members, nextCursor }
}

function removableAssignmentIds(
  assignments: readonly ProjectRoleAssignment[]
): (organizationMembershipId: string, role: ProjectMemberRole) => string | null {
  const direct = assignments.filter(isDirect)
  return (organizationMembershipId, role) => {
    const own = direct.filter((assignment) => assignment.organizationMembershipId === organizationMembershipId)
    return (own.find((assignment) => assignment.role.slug === role) ?? own[0])?.id ?? null
  }
}

async function resourceIdOf(projectId: string, organizationId: string): Promise<string> {
  const workosResourceId = await findProjectWorkosResourceId(projectId, organizationId)
  if (!workosResourceId) throw new NotFoundError('Project resource not found.')
  return workosResourceId
}

export async function setProjectMemberRole(
  session: AuthorizedSession,
  projectId: string,
  input: { organizationMembershipId: string; roleSlug: ProjectMemberRole | '' },
  request: Request
): Promise<void> {
  await requireProjectAccess(session, projectId, ['project:members:manage', 'project:manage'])
  const { organizationMembershipId, roleSlug } = input
  const workosResourceId = await resourceIdOf(projectId, session.organizationId)

  const { held, removed } = await withProjectMembersLock(session.organizationId, projectId, async () => {
    const assignments = await listAssignments(workosResourceId)
    assertNotLastAdmin(assignments, organizationMembershipId, roleSlug === PROJECT_ADMIN_ROLE_SLUG)

    const held = assignments.filter((assignment) => assignment.organizationMembershipId === organizationMembershipId)
    const kept = roleSlug ? held.find((assignment) => isDirect(assignment) && assignment.role.slug === roleSlug) : undefined
    const removed = held.filter((assignment) => isDirect(assignment) && assignment !== kept)
    await assertWithinCeiling(session, projectId, [
      ...(roleSlug && !kept ? [roleSlug] : []),
      ...removed.map((assignment) => assignment.role.slug),
    ])

    const workos = getWorkOS()
    try {
      if (roleSlug && !kept) {
        await workos.authorization.assignRole({
          organizationMembershipId,
          resourceExternalId: projectId,
          resourceTypeSlug: 'project',
          roleSlug,
        })
      }
      await Promise.all(
        removed.map((assignment) =>
          workos.authorization.removeRoleAssignment({ organizationMembershipId, roleAssignmentId: assignment.id })
        )
      )
    } finally {
      await forgetResourceGrants(session.organizationId, organizationMembershipId)
    }
    return { held, removed }
  })

  if (!roleSlug && removed.length > 0 && removed.length === held.length) {
    await settleDeparture(session, projectId, organizationMembershipId, held)
  } else if (roleSlug && held.length === 0) {
    const userId = await userOfMembership(organizationMembershipId)
    if (userId) await recordMemberRejoined(session, projectId, userId)
  }

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: roleSlug ? 'project.role.assigned' : 'project.role.removed',
    targetType: 'project',
    targetId: projectId,
    metadata: { organizationMembershipId, roleSlug: roleSlug || 'none' },
    request,
  })
}

export async function removeProjectRoleAssignment(
  session: AuthorizedSession,
  projectId: string,
  assignmentId: string,
  request: Request
): Promise<void> {
  await requireProjectAccess(session, projectId, ['project:members:manage', 'project:manage'])
  const workosResourceId = await resourceIdOf(projectId, session.organizationId)

  const { assignment, sameMember } = await withProjectMembersLock(session.organizationId, projectId, async () => {
    const assignments = await listAssignments(workosResourceId)
    const assignment = assignments.find((candidate) => candidate.id === assignmentId)
    if (!assignment) throw new NotFoundError()

    assertNotLastAdmin(assignments, assignment.organizationMembershipId, false)
    await assertWithinCeiling(session, projectId, [assignment.role.slug])

    try {
      await getWorkOS().authorization.removeRoleAssignment({
        organizationMembershipId: assignment.organizationMembershipId,
        roleAssignmentId: assignment.id,
      })
    } finally {
      await forgetResourceGrants(session.organizationId, assignment.organizationMembershipId)
    }
    const sameMember = assignments.filter((other) => other.organizationMembershipId === assignment.organizationMembershipId)
    return { assignment, sameMember }
  })

  if (sameMember.every((other) => other.id === assignment.id)) {
    await settleDeparture(session, projectId, assignment.organizationMembershipId, sameMember)
  }

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'project.role.removed',
    targetType: 'project',
    targetId: projectId,
    metadata: { organizationMembershipId: assignment.organizationMembershipId, roleSlug: 'none' },
    request,
  })
}

async function settleDeparture(
  session: AuthorizedSession,
  projectId: string,
  organizationMembershipId: string,
  held: ReadonlyArray<{ createdAt: Date }>
): Promise<void> {
  const userId = await userOfMembership(organizationMembershipId)
  if (!userId) return
  try {
    await revokeCollaborationForProjectMember(session.organizationId, projectId, userId)
  } catch (error) {
    console.warn('[members-service] collaboration cleanup after role removal failed:', error)
  }
  await recordMemberLeft(session, projectId, { userId, since: earliestMonth(held) })
}

function earliestMonth(assignments: ReadonlyArray<{ createdAt: Date }>): Month | null {
  const first = assignments.map((assignment) => assignment.createdAt.toISOString()).sort()[0]
  return dateToMonth(first)
}

async function userOfMembership(organizationMembershipId: string): Promise<string | null> {
  try {
    const membership = await getWorkOS().userManagement.getOrganizationMembership(organizationMembershipId)
    return membership?.userId ?? null
  } catch (error) {
    console.warn('[members-service] membership lookup failed:', error)
    return null
  }
}
