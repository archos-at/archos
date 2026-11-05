/**
 * Project members service — the WorkOS FGA roster and role assignments for a
 * project. Owns authorization (`project:members:manage`, or `project:manage`
 * for roles provisioned before the split, on every operation), the invariants
 * of a roster change and the audit trail for access-control changes. Route
 * handlers stay thin: they validate input shape and delegate here.
 *
 * Every change of who holds which role, whichever route made it:
 *   - runs under the project's roster lock (`withProjectMembersLock`), so the
 *     last-admin rule cannot be raced past;
 *   - grants and takes away only roles whose permissions the caller holds
 *     themselves (the grant ceiling), so `project:members:manage` cannot be
 *     turned into `project:manage`;
 *   - forgets the person's cached grants (`forgetResourceGrants`), so a
 *     removal takes effect on their next request, not after the cache TTL;
 *   - settles a departure the same way (`settleDeparture`): the collaboration
 *     that waited on them is voided and the Steckbrief keeps them as a former
 *     member. Before this, only the DELETE route did that, and the members
 *     form removes people through the POST.
 */

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

/**
 * The project roles a member can be assigned, exactly as the catalog defines
 * them. `project-contributor` belongs here even though `requireProjectAccess`'s
 * derived ladder does not distinguish it (see `ProjectRole` there): this is what
 * WorkOS holds and what the roster shows, and leaving it out is why the role
 * shipped assignable-in-theory and unassignable-in-practice.
 */
export type ProjectMemberRole =
  | 'project-viewer'
  | 'project-contributor'
  | 'project-editor'
  | 'project-admin'

const PROJECT_ADMIN_ROLE_SLUG = 'project-admin'

/** Machine-readable marker so the client can localize the last-admin block. */
const LAST_ADMIN_DETAILS = { reason: 'last-admin' } as const

/**
 * The distinct organization-membership ids that currently hold `project-admin`
 * on a resource, derived from the FGA role assignments the caller already
 * listed. A `Set` because a membership can appear more than once (e.g. direct
 * plus group-derived) and each counts as a single admin.
 */
function adminMembershipIds(
  assignments: Array<{ organizationMembershipId: string; role: { slug: string } }>
): Set<string> {
  return new Set(
    assignments
      .filter((assignment) => assignment.role.slug === PROJECT_ADMIN_ROLE_SLUG)
      .map((assignment) => assignment.organizationMembershipId)
  )
}

/**
 * Last-admin invariant. A role change or removal that strips `project-admin`
 * from `targetMembershipId` is rejected when no OTHER membership would still be
 * an admin — a project must never be left with zero admins and no in-app way to
 * recover. `willRemainAdmin` is true only when the pending change re-grants
 * `project-admin` to the same target. Covers both self-demotion and demoting
 * the only other admin. Cheap: it reuses the assignment list already fetched,
 * adding no WorkOS round-trip.
 */
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

/** One project role assignment as WorkOS lists it; `source` absent reads as direct. */
type ProjectRoleAssignment = {
  id: string
  organizationMembershipId: string
  role: { slug: string }
  createdAt: Date
  source?: { type: 'direct' | 'group' }
}

/**
 * Whether the assignment was made on this person and can be removed here. A
 * role a directory group carries is the group's: removing it is a change of the
 * group, not of this roster.
 */
function isDirect(assignment: ProjectRoleAssignment): boolean {
  return assignment.source?.type !== 'group'
}

/** Machine-readable marker of a role change beyond the caller's own permissions. */
const ROLE_EXCEEDS_OWN_DETAILS = { reason: 'role-exceeds-own' } as const

const EVERY_PROJECT_PERMISSION: readonly string[] = PROJECT_PERMISSION_SPECS.map((spec) => spec.slug)

/**
 * What a project role grants, as the catalog defines it. A role the catalog
 * does not know (one made in the WorkOS dashboard) is read as granting every
 * project permission: only someone who holds them all may hand it out or take
 * it away, which never under-protects it.
 */
function permissionsOfRole(roleSlug: string): readonly string[] {
  const spec = findRoleSpec(roleSlug)
  return spec?.tier === 'project' ? spec.permissions : EVERY_PROJECT_PERMISSION
}

/**
 * The grant ceiling: a change of someone's project roles may only grant or take
 * away permissions the caller holds on the project themselves. Holding
 * `project:members:manage` lets you staff a project, not promote yourself or
 * anyone else past your own rung. The organization-wide bypass holds every
 * project permission. Built-in roles never meet the ceiling (only Project Admin
 * holds `project:members:manage`, and it holds everything); a role assembled
 * in the WorkOS dashboard with `project:members:manage` and less than
 * everything does.
 */
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

/**
 * Permission → displayed role, as an ORDERED ladder: the roster probes each
 * permission and a later match overwrites an earlier one, so the strongest rung
 * a member reaches is the one shown.
 *
 * Every rung the catalog defines has an entry, which it did not before. Probing
 * only `view`/`edit`/`manage` meant a Contributor displayed as "Viewer" (it
 * holds `project:view` and nothing further down the old ladder) and a custom
 * role built the way the catalog recommends — narrow writes, no umbrella —
 * displayed as "Viewer" too. A roster that under-reports somebody's access is
 * worse than no roster: it is the screen an admin uses to audit exactly that.
 *
 * The two narrow writes both map to Editor because that is the rung, not because
 * they are interchangeable; `project:edit` stays for roles provisioned before
 * the ADR-0038 split.
 */
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
  /**
   * The WorkOS role assignment that grants `role` directly: what
   * `removeProjectRoleAssignment` takes. Null for a member without a project
   * role, and for one who reaches the project only through a group or an
   * organization-wide right (nothing to remove here).
   */
  roleAssignmentId: string | null
}

/** Who a roster lists: the people holding a project role, or the whole organization (to pick whom to add). */
export type ProjectMemberScope = 'members' | 'organization'

/**
 * The project roster: by default the people who hold a project role, each with
 * their effective role and the assignment id that removes it. `scope:
 * 'organization'` is the whole organization, role null for those without one
 * (the form that picks whom to add). Ordered by name, one page at a time.
 */
export async function listProjectMembers(
  session: AuthorizedSession,
  projectId: string,
  options: { scope?: ProjectMemberScope; page?: OffsetPage } = {}
): Promise<{ members: ProjectMember[]; nextCursor: string | null }> {
  await requireProjectAccess(session, projectId, ['project:members:manage', 'project:manage'])
  const scope = options.scope ?? 'members'
  const workosResourceId = await findProjectWorkosResourceId(projectId, session.organizationId)

  const workos = getWorkOS()

  // WorkOS list endpoints return 10 items per page by default; autoPagination
  // walks every page so rosters larger than one page aren't silently truncated.
  // Every list is independent — fetch them in parallel. This is the one screen
  // in the product whose whole job is to report access accurately, so it probes
  // each rung rather than inferring one from another.
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

/**
 * The direct assignment a roster row offers for removal: the one granting the
 * role the row shows, else any direct one the membership holds. The second
 * case is a role the catalog does not know (one made in the WorkOS dashboard):
 * the row shows the rung its permissions reach, a slug no assignment carries,
 * and matching on that alone left such a member with nothing to remove.
 */
function removableAssignmentIds(
  assignments: readonly ProjectRoleAssignment[]
): (organizationMembershipId: string, role: ProjectMemberRole) => string | null {
  const direct = assignments.filter(isDirect)
  return (organizationMembershipId, role) => {
    const own = direct.filter((assignment) => assignment.organizationMembershipId === organizationMembershipId)
    return (own.find((assignment) => assignment.role.slug === role) ?? own[0])?.id ?? null
  }
}

/**
 * The project's WorkOS resource id. Read before the roster lock is taken: it
 * never changes, and the lock's transaction should hold its connection for the
 * WorkOS calls alone, not borrow a second one from the pool.
 */
async function resourceIdOf(projectId: string, organizationId: string): Promise<string> {
  const workosResourceId = await findProjectWorkosResourceId(projectId, organizationId)
  if (!workosResourceId) throw new NotFoundError('Project resource not found.')
  return workosResourceId
}

/**
 * Set (or clear, with an empty roleSlug) a member's project role. A member
 * holds one direct project role: the new one is assigned FIRST and the others
 * are removed after it, so a failure part-way leaves the old access or both,
 * never none. A role a directory group carries is left alone. Access-control
 * change — always audited.
 */
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
    // Reject any change that would drop the project's admin count to zero
    // (ADR-0017: the service owns the invariant). Re-granting admin to the same
    // target keeps them an admin, so it's always allowed.
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

  // The Steckbrief keeps who worked on the project (ADR-0091): someone taken
  // off it stays on as a former member, someone put back is current again.
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

/**
 * Remove a single WorkOS FGA role assignment from a project. Walks every
 * assignment page so assignments beyond the first page are found too.
 * Access-control change — always audited.
 */
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

    // A bare assignment removal is also a demotion — hold the last-admin line.
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

  // Their last role on the project gone, they have left it.
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

/**
 * Someone holds no role on the project any more, whichever route took it away.
 *
 * Losing project access ends effective access to every conversation inside it
 * (spec SH-4/SH-13), so collaboration state that depends on this person being
 * able to READ those threads is settled now; otherwise a thread waiting on them
 * waits forever. Grants are deliberately kept: they are inert while the
 * container is unreachable, so re-adding the person restores their sharing.
 * Then the Steckbrief keeps them as a former member (ADR-0091). Best-effort for
 * the collaboration: an access-control change must not fail on notification
 * bookkeeping.
 */
async function settleDeparture(
  session: AuthorizedSession,
  projectId: string,
  organizationMembershipId: string,
  /** The assignments they held, which say since when they were on the project. */
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

/** The month the earliest of these assignments was made: when the member joined. */
function earliestMonth(assignments: ReadonlyArray<{ createdAt: Date }>): Month | null {
  const first = assignments.map((assignment) => assignment.createdAt.toISOString()).sort()[0]
  return dateToMonth(first)
}

/** Null when WorkOS cannot say; the callers' follow-ups are best-effort. */
async function userOfMembership(organizationMembershipId: string): Promise<string | null> {
  try {
    const membership = await getWorkOS().userManagement.getOrganizationMembership(organizationMembershipId)
    return membership?.userId ?? null
  } catch (error) {
    console.warn('[members-service] membership lookup failed:', error)
    return null
  }
}
