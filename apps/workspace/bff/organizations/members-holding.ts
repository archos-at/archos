import 'server-only'
import { rolesHoldPermission } from '@/lib/authz/org-role-permissions'
import { listOrganizationMembersWithRoles } from './service'

export async function activeMembersHolding(organizationId: string, permission: string): Promise<string[]> {
  const members = await listOrganizationMembersWithRoles(organizationId)
  const active = members.filter((member) => member.status === 'active' && member.roleSlug)
  const verdicts = await Promise.all(
    active.map(async (member) =>
      (await rolesHoldPermission(organizationId, member.roleSlug ? [member.roleSlug] : [], permission)) ? member.id : null
    )
  )
  return verdicts.filter((id): id is string => id !== null)
}
