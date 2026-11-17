import 'server-only'
import { getCached } from '@/lib/cache'
import { getWorkOS } from '@/lib/workos/client'
import { acceptedPermissionSlugs } from './permissions'

export const ROLE_CACHE_TTL_MS = 60 * 1000

async function rolePermissionMap(organizationId: string): Promise<Record<string, string[]>> {
  return getCached(`authz:org-role-permissions:${organizationId}`, ROLE_CACHE_TTL_MS, async () => {
    const roles = await getWorkOS().authorization.listOrganizationRoles(organizationId)
    return Object.fromEntries(roles.data.map((role) => [role.slug, [...role.permissions]]))
  })
}

export async function rolePermissions(organizationId: string, roles: readonly string[]): Promise<ReadonlySet<string>> {
  if (roles.length === 0) return new Set()
  try {
    const map = await rolePermissionMap(organizationId)
    return new Set(roles.flatMap((role) => map[role] ?? []))
  } catch (error) {
    console.warn(`[authz] role lookup failed for ${organizationId}:`, error)
    return new Set()
  }
}

export async function rolesHoldPermission(
  organizationId: string,
  roles: readonly string[],
  permission: string
): Promise<boolean> {
  const held = await rolePermissions(organizationId, roles)
  return acceptedPermissionSlugs(permission).some((slug) => held.has(slug))
}
