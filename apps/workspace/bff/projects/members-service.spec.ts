/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '@/lib/api/errors'

vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: vi.fn().mockResolvedValue({ role: 'project-admin' }),
}))

vi.mock('@/lib/audit/service', () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./repository', () => ({
  findProjectWorkosResourceId: vi.fn().mockResolvedValue('res_project_1'),
}))

const projectRecord = vi.hoisted(() => ({ recordMemberLeft: vi.fn(), recordMemberRejoined: vi.fn() }))
vi.mock('./project-record-service', () => projectRecord)

const collaboration = vi.hoisted(() => ({ revokeCollaborationForProjectMember: vi.fn() }))
vi.mock('@/lib/collaboration/cleanup', () => collaboration)

// The roster lock, recorded: every change must run inside it.
const lock = vi.hoisted(() => ({
  held: false,
  withProjectMembersLock: vi.fn(),
}))
vi.mock('./member-change-lock', () => lock)

// What the caller holds on the project (the grant ceiling), and the cache the
// change must forget.
const grants = vi.hoisted(() => ({
  effectiveResourcePermissions: vi.fn(),
  forgetResourceGrants: vi.fn(),
}))
vi.mock('@/lib/authz/resource-check', () => grants)

const getOrganizationMembership = vi.fn(async (id: string) => ({ id, userId: `user_of_${id}` }))
const listRoleAssignmentsForResource = vi.fn()
const writes: string[] = []
const removeRoleAssignment = vi.fn(async ({ roleAssignmentId }: { roleAssignmentId: string }) => {
  expect(lock.held).toBe(true)
  writes.push(`remove ${roleAssignmentId}`)
})
const assignRole = vi.fn(async ({ roleSlug }: { roleSlug: string }) => {
  expect(lock.held).toBe(true)
  writes.push(`assign ${roleSlug}`)
})
const listUsers = vi.fn()
const listOrganizationMemberships = vi.fn()
const listMembershipsForResourceByExternalId = vi.fn()

vi.mock('@/lib/workos/client', () => ({
  getWorkOS: () => ({
    authorization: {
      listRoleAssignmentsForResource,
      removeRoleAssignment,
      assignRole,
      listMembershipsForResourceByExternalId,
    },
    userManagement: { getOrganizationMembership, listUsers, listOrganizationMemberships },
  }),
}))

import { ForbiddenError } from '@/lib/api/errors'
import { PROJECT_PERMISSION_SPECS } from '@/lib/authz/catalog'
import { listProjectMembers, setProjectMemberRole, removeProjectRoleAssignment } from './members-service'

type Assignment = {
  id: string
  organizationMembershipId: string
  role: { slug: string }
  createdAt: Date
  source?: { type: 'direct' | 'group' }
}

/** WorkOS dates every assignment; these say nothing about when anyone joined. */
const UNDATED = new Date('2020-01-01T00:00:00Z')

const session = {
  userId: 'user_1',
  organizationId: 'org_1',
  organizationMembershipId: 'om_caller',
  email: 'admin@grid.com',
  permissions: [] as string[],
} as never

const EVERY_PROJECT_PERMISSION = PROJECT_PERMISSION_SPECS.map((spec) => spec.slug)

const request = new Request('https://grid.test/api/projects/p1/members', { method: 'POST' })

/** Stub the FGA assignment list the service reads to count admins. */
function stubAssignments(assignments: Assignment[]): void {
  listRoleAssignmentsForResource.mockResolvedValue({
    autoPagination: () => Promise.resolve(assignments),
  })
}

const admin = (id: string, membershipId: string): Assignment => ({
  id,
  organizationMembershipId: membershipId,
  role: { slug: 'project-admin' },
  createdAt: UNDATED,
})
const editor = (id: string, membershipId: string): Assignment => ({
  id,
  organizationMembershipId: membershipId,
  role: { slug: 'project-editor' },
  createdAt: UNDATED,
})

beforeEach(() => {
  listRoleAssignmentsForResource.mockReset()
  removeRoleAssignment.mockClear()
  assignRole.mockClear()
  writes.length = 0
  projectRecord.recordMemberLeft.mockClear()
  projectRecord.recordMemberRejoined.mockClear()
  collaboration.revokeCollaborationForProjectMember.mockReset().mockResolvedValue({ requests: 0, inboxItems: 0 })
  lock.held = false
  lock.withProjectMembersLock.mockReset().mockImplementation(async (_org: string, _project: string, work: () => Promise<unknown>) => {
    lock.held = true
    try {
      return await work()
    } finally {
      lock.held = false
    }
  })
  // By default the caller is a Project Admin: every project permission.
  grants.effectiveResourcePermissions.mockReset().mockResolvedValue(new Set(EVERY_PROJECT_PERMISSION))
  grants.forgetResourceGrants.mockReset().mockResolvedValue(undefined)
})

describe('setProjectMemberRole — last-admin guard', () => {
  it('rejects demoting the only admin (self-demotion)', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])

    await expect(
      setProjectMemberRole(
        session,
        'p1',
        { organizationMembershipId: 'om_admin', roleSlug: 'project-editor' },
        request
      )
    ).rejects.toBeInstanceOf(ConflictError)

    // The guard runs before any mutation.
    expect(removeRoleAssignment).not.toHaveBeenCalled()
    expect(assignRole).not.toHaveBeenCalled()
  })

  it('rejects removing (no access) the only admin', async () => {
    stubAssignments([admin('ra_1', 'om_admin')])

    await expect(
      setProjectMemberRole(
        session,
        'p1',
        { organizationMembershipId: 'om_admin', roleSlug: '' },
        request
      )
    ).rejects.toBeInstanceOf(ConflictError)
    expect(removeRoleAssignment).not.toHaveBeenCalled()
  })

  it('carries the last-admin marker so the client can localize it', async () => {
    stubAssignments([admin('ra_1', 'om_admin')])

    await setProjectMemberRole(
      session,
      'p1',
      { organizationMembershipId: 'om_admin', roleSlug: '' },
      request
    ).catch((error: unknown) => {
      expect(error).toBeInstanceOf(ConflictError)
      expect((error as ConflictError).details).toEqual({ reason: 'last-admin' })
    })
    expect.assertions(2)
  })

  it('allows demoting an admin when another admin remains', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), admin('ra_2', 'om_admin2')])

    await expect(
      setProjectMemberRole(
        session,
        'p1',
        { organizationMembershipId: 'om_admin', roleSlug: 'project-editor' },
        request
      )
    ).resolves.toBeUndefined()

    expect(removeRoleAssignment).toHaveBeenCalledTimes(1)
    expect(assignRole).toHaveBeenCalledTimes(1)
  })

  it('allows re-granting admin to the same sole admin', async () => {
    stubAssignments([admin('ra_1', 'om_admin')])

    await expect(
      setProjectMemberRole(
        session,
        'p1',
        { organizationMembershipId: 'om_admin', roleSlug: 'project-admin' },
        request
      )
    ).resolves.toBeUndefined()
    // They hold it already: nothing to write, and nothing removed either.
    expect(writes).toEqual([])
  })

  it('does not block changing a non-admin member', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])

    await expect(
      setProjectMemberRole(
        session,
        'p1',
        { organizationMembershipId: 'om_editor', roleSlug: 'project-viewer' },
        request
      )
    ).resolves.toBeUndefined()
  })
})

describe('removeProjectRoleAssignment — last-admin guard', () => {
  it('rejects removing the only admin assignment', async () => {
    stubAssignments([admin('ra_1', 'om_admin')])

    await expect(
      removeProjectRoleAssignment(session, 'p1', 'ra_1', request)
    ).rejects.toBeInstanceOf(ConflictError)
    expect(removeRoleAssignment).not.toHaveBeenCalled()
  })

  it('allows removing an admin assignment when another admin remains', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), admin('ra_2', 'om_admin2')])

    await expect(
      removeProjectRoleAssignment(session, 'p1', 'ra_1', request)
    ).resolves.toBeUndefined()
    expect(removeRoleAssignment).toHaveBeenCalledTimes(1)
  })
})

describe('the project record keeps who worked on the project (ADR-0091)', () => {
  const dated = (assignment: Assignment, createdAt: string): Assignment => ({ ...assignment, createdAt: new Date(createdAt) })

  it('someone taken off the project stays on as a former member, from the month they joined', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), dated(editor('ra_2', 'om_editor'), '2024-02-14T10:00:00Z')])
    await setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: '' }, request)
    expect(projectRecord.recordMemberLeft).toHaveBeenCalledWith(session, 'p1', { userId: 'user_of_om_editor', since: '2024-02' })
    expect(projectRecord.recordMemberRejoined).not.toHaveBeenCalled()
  })

  it('a role change is no leaving, and putting someone back makes them current again', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])
    await setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: 'project-viewer' }, request)
    expect(projectRecord.recordMemberLeft).not.toHaveBeenCalled()
    expect(projectRecord.recordMemberRejoined).not.toHaveBeenCalled()

    await setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_new', roleSlug: 'project-editor' }, request)
    expect(projectRecord.recordMemberRejoined).toHaveBeenCalledWith(session, 'p1', 'user_of_om_new')
  })

  it('removing an assignment keeps the member only when it was their last on the project', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor'), editor('ra_3', 'om_editor')])
    await removeProjectRoleAssignment(session, 'p1', 'ra_2', request)
    expect(projectRecord.recordMemberLeft).not.toHaveBeenCalled()

    stubAssignments([admin('ra_1', 'om_admin'), dated(editor('ra_3', 'om_editor'), '2025-01-05T08:00:00Z')])
    await removeProjectRoleAssignment(session, 'p1', 'ra_3', request)
    expect(projectRecord.recordMemberLeft).toHaveBeenCalledWith(session, 'p1', { userId: 'user_of_om_editor', since: '2025-01' })
  })
})

describe('one removal, whichever route takes it (the members form uses the POST)', () => {
  it('clearing a role through the POST voids the collaboration that waited on the person', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])
    await setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: '' }, request)
    expect(collaboration.revokeCollaborationForProjectMember).toHaveBeenCalledWith('org_1', 'p1', 'user_of_om_editor')
  })

  it('a role change keeps the person in the project, so nothing of theirs is voided', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])
    await setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: 'project-viewer' }, request)
    expect(collaboration.revokeCollaborationForProjectMember).not.toHaveBeenCalled()
  })

  it('removing one of two assignments is no departure either', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor'), editor('ra_3', 'om_editor')])
    await removeProjectRoleAssignment(session, 'p1', 'ra_2', request)
    expect(collaboration.revokeCollaborationForProjectMember).not.toHaveBeenCalled()
  })

  it('a failed collaboration cleanup does not fail the removal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    collaboration.revokeCollaborationForProjectMember.mockRejectedValue(new Error('db down'))
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])
    await expect(
      setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: '' }, request)
    ).resolves.toBeUndefined()
    expect(projectRecord.recordMemberLeft).toHaveBeenCalled()
  })
})

describe('a change takes effect at once: the person’s cached grants are forgotten', () => {
  it('after a role is set', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])
    await setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: '' }, request)
    expect(grants.forgetResourceGrants).toHaveBeenCalledWith('org_1', 'om_editor')
  })

  it('after an assignment is removed', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])
    await removeProjectRoleAssignment(session, 'p1', 'ra_2', request)
    expect(grants.forgetResourceGrants).toHaveBeenCalledWith('org_1', 'om_editor')
  })

  it('even when WorkOS failed part-way, since part of it may have gone through', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])
    removeRoleAssignment.mockRejectedValueOnce(new Error('workos 500'))
    await expect(
      setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: 'project-viewer' }, request)
    ).rejects.toThrow('workos 500')
    expect(grants.forgetResourceGrants).toHaveBeenCalledWith('org_1', 'om_editor')
  })
})

describe('a role change never leaves the person with less than either role', () => {
  it('assigns the new role before removing the old one', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])
    await setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: 'project-viewer' }, request)
    expect(writes).toEqual(['assign project-viewer', 'remove ra_2'])
  })

  it('a failed assignment removes nothing: the old role stays', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])
    assignRole.mockRejectedValueOnce(new Error('workos 500'))
    await expect(
      setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: 'project-viewer' }, request)
    ).rejects.toThrow('workos 500')
    expect(removeRoleAssignment).not.toHaveBeenCalled()
  })

  it('re-granting the role someone holds writes nothing but the removal of any other', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor'), { ...editor('ra_3', 'om_editor'), role: { slug: 'project-viewer' } }])
    await setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: 'project-editor' }, request)
    expect(writes).toEqual(['remove ra_3'])
  })

  it('leaves a role a directory group carries alone', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), { ...editor('ra_g', 'om_editor'), source: { type: 'group' } }, editor('ra_2', 'om_editor')])
    await setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: '' }, request)
    expect(writes).toEqual(['remove ra_2'])
    // They still reach the project through the group: no departure.
    expect(projectRecord.recordMemberLeft).not.toHaveBeenCalled()
    expect(collaboration.revokeCollaborationForProjectMember).not.toHaveBeenCalled()
  })

  it('reads and writes the roster under the project’s roster lock', async () => {
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])
    await setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: 'project-viewer' }, request)
    await removeProjectRoleAssignment(session, 'p1', 'ra_2', request)
    expect(lock.withProjectMembersLock).toHaveBeenCalledTimes(2)
    expect(lock.withProjectMembersLock).toHaveBeenCalledWith('org_1', 'p1', expect.any(Function))
  })
})

describe('the grant ceiling: members:manage staffs a project, it does not promote', () => {
  const staffer = () => grants.effectiveResourcePermissions.mockResolvedValue(new Set(['project:view', 'project:members:manage']))

  it('refuses granting a role with permissions the caller does not hold, themselves included', async () => {
    staffer()
    stubAssignments([admin('ra_1', 'om_admin')])
    for (const organizationMembershipId of ['om_new', 'om_caller']) {
      const refusal = await setProjectMemberRole(
        session,
        'p1',
        { organizationMembershipId, roleSlug: 'project-admin' },
        request
      ).catch((error: unknown) => error)
      expect(refusal).toBeInstanceOf(ForbiddenError)
      expect((refusal as ForbiddenError).details).toEqual({ reason: 'role-exceeds-own' })
    }
    expect(writes).toEqual([])
  })

  it('lets the same caller grant a role within their own permissions', async () => {
    staffer()
    stubAssignments([admin('ra_1', 'om_admin')])
    await setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_new', roleSlug: 'project-viewer' }, request)
    expect(writes).toEqual(['assign project-viewer'])
  })

  it('refuses taking away a role above the caller’s own, by either route', async () => {
    staffer()
    stubAssignments([admin('ra_1', 'om_admin'), editor('ra_2', 'om_editor')])
    await expect(
      setProjectMemberRole(session, 'p1', { organizationMembershipId: 'om_editor', roleSlug: 'project-viewer' }, request)
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(removeProjectRoleAssignment(session, 'p1', 'ra_2', request)).rejects.toBeInstanceOf(ForbiddenError)
    expect(writes).toEqual([])
  })

  it('reads a role the catalog does not know as granting everything', async () => {
    grants.effectiveResourcePermissions.mockResolvedValue(new Set(EVERY_PROJECT_PERMISSION.filter((slug) => slug !== 'project:skills:manage')))
    stubAssignments([admin('ra_1', 'om_admin'), { ...editor('ra_x', 'om_x'), role: { slug: 'dashboard-made' } }])
    await expect(removeProjectRoleAssignment(session, 'p1', 'ra_x', request)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('the organization-wide bypass holds every project permission and asks WorkOS nothing for it', async () => {
    staffer()
    stubAssignments([admin('ra_1', 'om_admin')])
    const orgAdmin = { ...(session as object), permissions: ['org:projects:administer'] } as never
    await setProjectMemberRole(orgAdmin, 'p1', { organizationMembershipId: 'om_new', roleSlug: 'project-admin' }, request)
    expect(writes).toEqual(['assign project-admin'])
    expect(grants.effectiveResourcePermissions).not.toHaveBeenCalled()
  })
})

describe('listProjectMembers — the removal a row offers', () => {
  function stubRoster(assignments: Assignment[], permissionsOf: Record<string, string[]>) {
    stubAssignments(assignments)
    const page = <T>(items: T[]) => ({ autoPagination: () => Promise.resolve(items) })
    listUsers.mockResolvedValue(page([{ id: 'u_x', name: 'Xaver' }]))
    listOrganizationMemberships.mockResolvedValue(page([{ id: 'om_x', userId: 'u_x' }]))
    listMembershipsForResourceByExternalId.mockImplementation(async ({ permissionSlug }: { permissionSlug: string }) =>
      page((permissionsOf[permissionSlug] ?? []).map((userId) => ({ id: 'om_x', userId })))
    )
  }

  it('offers the direct assignment of a role the catalog does not know', async () => {
    // A dashboard-made role with the editor's rights shows as Editor; no assignment carries that slug.
    stubRoster([{ ...editor('ra_x', 'om_x'), role: { slug: 'dashboard-made' } }], {
      'project:view': ['u_x'],
      'project:documents:write': ['u_x'],
    })
    const { members } = await listProjectMembers(session, 'p1')
    expect(members).toEqual([expect.objectContaining({ organizationMembershipId: 'om_x', role: 'project-editor', roleAssignmentId: 'ra_x' })])
  })

  it('offers nothing for a role only a directory group carries', async () => {
    stubRoster([{ ...editor('ra_g', 'om_x'), source: { type: 'group' } }], { 'project:view': ['u_x'], 'project:edit': ['u_x'] })
    const { members } = await listProjectMembers(session, 'p1')
    expect(members[0]?.roleAssignmentId).toBeNull()
  })
})
