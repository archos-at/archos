import 'server-only'
import { getWorkOS } from '@/lib/workos/client'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { dateToMonth, type Month } from './month'
import { findProjectWorkosResourceId } from './repository'

export interface ProjectTeamMember {
  userId: string
  name: string
  since: Month | null
}

export async function loadProjectTeam(projectId: string, organizationId: string): Promise<ProjectTeamMember[] | null> {
  try {
    const resourceId = await findProjectWorkosResourceId(projectId, organizationId)
    if (!resourceId) return null
    const workos = getWorkOS()
    const [assignments, memberships, directory] = await Promise.all([
      workos.authorization.listRoleAssignmentsForResource({ resourceId }).then((page) => page.autoPagination()),
      workos.userManagement
        .listOrganizationMemberships({ organizationId, limit: 100 })
        .then((page) => page.autoPagination()),
      loadOrganizationDirectory(organizationId),
    ])
    const userOf = new Map(memberships.map((membership) => [membership.id, membership.userId]))
    const since = new Map<string, string>()
    for (const assignment of assignments) {
      const userId = userOf.get(assignment.organizationMembershipId)
      if (!userId) continue
      const earlier = since.get(userId)
      const joined = assignment.createdAt.toISOString()
      if (!earlier || joined < earlier) since.set(userId, joined)
    }
    return [...since]
      .map(([userId, createdAt]) => ({ userId, name: directory.get(userId)?.name ?? null, since: dateToMonth(createdAt) }))
      .filter((member): member is ProjectTeamMember => member.name !== null)
      .sort((a, b) => (a.since ?? '').localeCompare(b.since ?? '') || a.name.localeCompare(b.name))
  } catch (error) {
    console.warn(`[project-team] roster of ${projectId} could not be read:`, error)
    return null
  }
}
