import 'server-only'
import { ConflictError, ForbiddenError, NotFoundError, BadRequestError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getCached, invalidateCached } from '@/lib/cache'
import { getWorkOS } from '@/lib/workos/client'
import { ORG_PERMISSION_SPECS } from './catalog'
import { hasPermission, ORG_PERMISSIONS, type KnownPermission } from './permissions'

export interface OrganizationRoleView {
  slug: string
  name: string
  description: string | null
  custom: boolean
  permissions?: string[]
}

export const ASSIGNABLE_ROLE_PERMISSIONS: readonly string[] = ORG_PERMISSION_SPECS.filter(
  (spec) => spec.tier === 'org'
).map((spec) => spec.slug)

const DEPRECATED_ROLE_PERMISSIONS: ReadonlySet<string> = new Set(
  ORG_PERMISSION_SPECS.filter((spec) => spec.deprecated).map((spec) => spec.slug)
)

const ROLE_LIST_TTL_MS = 60_000
const roleListKey = (organizationId: string): string => `authz:org-roles:${organizationId}`
const permissionMapKey = (organizationId: string): string => `authz:org-role-permissions:${organizationId}`

interface WorkOSRole {
  slug: string
  name: string
  description: string | null
  permissions: string[]
  type: string
}

async function listRolesFromWorkOS(organizationId: string): Promise<WorkOSRole[]> {
  return getCached(roleListKey(organizationId), ROLE_LIST_TTL_MS, async () => {
    const roles = await getWorkOS().authorization.listOrganizationRoles(organizationId)
    return roles.data.map((role) => ({
      slug: role.slug,
      name: role.name,
      description: role.description ?? null,
      permissions: [...role.permissions],
      type: role.type,
    }))
  })
}

function isCustom(role: Pick<WorkOSRole, 'type'>): boolean {
  return role.type === 'OrganizationRole'
}

export async function listOrganizationRoles(session: AuthorizedSession): Promise<OrganizationRoleView[]> {
  const manager = hasPermission(session, ORG_PERMISSIONS.membersManage)
  const roles = await listRolesFromWorkOS(session.organizationId)
  return roles.map((role) => ({
    slug: role.slug,
    name: role.name,
    description: role.description,
    custom: isCustom(role),
    ...(manager ? { permissions: role.permissions } : {}),
  }))
}

export async function organizationRoleSlugs(organizationId: string): Promise<Set<string>> {
  return new Set((await listRolesFromWorkOS(organizationId)).map((role) => role.slug))
}

export interface AssignablePermissionView {
  slug: string
  grantable: boolean
}

export function assignableRolePermissions(session: AuthorizedSession): AssignablePermissionView[] | null {
  if (!hasPermission(session, ORG_PERMISSIONS.membersManage)) return null
  return ASSIGNABLE_ROLE_PERMISSIONS.filter((slug) => !DEPRECATED_ROLE_PERMISSIONS.has(slug)).map((slug) => ({
    slug,
    grantable: hasPermission(session, slug as KnownPermission),
  }))
}

function requireRoleManager(session: AuthorizedSession): void {
  if (!hasPermission(session, ORG_PERMISSIONS.membersManage)) throw new ForbiddenError()
}

function assertGrantable(session: AuthorizedSession, permissions: readonly string[]): void {
  const unknown = permissions.filter((permission) => !ASSIGNABLE_ROLE_PERMISSIONS.includes(permission))
  if (unknown.length > 0) throw new BadRequestError(`Not an organization permission: ${unknown.join(', ')}`)
  const beyond = permissions.filter((permission) => !hasPermission(session, permission as KnownPermission))
  if (beyond.length > 0) {
    throw new ForbiddenError(`You can only put permissions you hold into a role: ${beyond.join(', ')}`)
  }
}

const UMLAUTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/ß/g, 'ss'],
]

export function customRoleSlug(name: string): string {
  let folded = name.normalize('NFKC').toLocaleLowerCase('de')
  for (const [pattern, replacement] of UMLAUTS) folded = folded.replace(pattern, replacement)
  const body = folded
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  if (!body) throw new BadRequestError('A role name needs at least one letter or digit')
  return `org-${body}`
}

async function forgetRoles(organizationId: string): Promise<void> {
  await Promise.all([invalidateCached(roleListKey(organizationId)), invalidateCached(permissionMapKey(organizationId))])
}

export interface CustomRoleInput {
  name: string
  description: string | null
  permissions: string[]
}

export async function createCustomRole(
  session: AuthorizedSession,
  input: CustomRoleInput,
  request: Request
): Promise<OrganizationRoleView> {
  requireRoleManager(session)
  assertGrantable(session, input.permissions)
  const slug = customRoleSlug(input.name)
  const existing = await organizationRoleSlugs(session.organizationId)
  if (existing.has(slug)) throw new ConflictError('A role with this name already exists', { slug })

  const workos = getWorkOS()
  await workos.authorization.createOrganizationRole(session.organizationId, {
    slug,
    name: input.name.trim(),
    ...(input.description ? { description: input.description } : {}),
  })
  await workos.authorization.setOrganizationRolePermissions(session.organizationId, slug, {
    permissions: input.permissions,
  })
  await forgetRoles(session.organizationId)
  await auditRole(session, 'org.role.created', slug, input.permissions, request)
  return { slug, name: input.name.trim(), description: input.description, custom: true, permissions: input.permissions }
}

async function requireCustomRole(organizationId: string, slug: string): Promise<WorkOSRole> {
  const role = (await listRolesFromWorkOS(organizationId)).find((candidate) => candidate.slug === slug)
  if (!role) throw new NotFoundError('Role not found')
  if (!isCustom(role)) throw new ForbiddenError('The platform’s roles are changed by the platform, not here')
  return role
}

export async function updateCustomRole(
  session: AuthorizedSession,
  slug: string,
  input: Partial<CustomRoleInput>,
  request: Request
): Promise<OrganizationRoleView> {
  requireRoleManager(session)
  const role = await requireCustomRole(session.organizationId, slug)
  const workos = getWorkOS()
  if (input.name !== undefined || input.description !== undefined) {
    await workos.authorization.updateOrganizationRole(session.organizationId, slug, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
  }
  let permissions = role.permissions
  if (input.permissions !== undefined) {
    const added = input.permissions.filter((permission) => !role.permissions.includes(permission))
    assertGrantable(session, added)
    permissions = input.permissions
    await workos.authorization.setOrganizationRolePermissions(session.organizationId, slug, { permissions })
  }
  await forgetRoles(session.organizationId)
  await auditRole(session, 'org.role.updated', slug, permissions, request)
  return {
    slug,
    name: input.name?.trim() ?? role.name,
    description: input.description !== undefined ? input.description : role.description,
    custom: true,
    permissions,
  }
}

export const ROLE_ASSIGNED_REASON = 'role-assigned'

export async function deleteCustomRole(
  session: AuthorizedSession,
  slug: string,
  request: Request
): Promise<void> {
  requireRoleManager(session)
  await requireCustomRole(session.organizationId, slug)
  try {
    await getWorkOS().authorization.deleteOrganizationRole(session.organizationId, slug)
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 400 || status === 409 || status === 422) {
      throw new ConflictError('This role is still assigned. Give its holders another role first.', {
        slug,
        reason: ROLE_ASSIGNED_REASON,
      })
    }
    throw error
  }
  await forgetRoles(session.organizationId)
  await auditRole(session, 'org.role.deleted', slug, [], request)
}

async function auditRole(
  session: AuthorizedSession,
  action: 'org.role.created' | 'org.role.updated' | 'org.role.deleted',
  slug: string,
  permissions: readonly string[],
  request: Request
): Promise<void> {
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action,
    targetType: 'organization',
    targetId: session.organizationId,
    metadata: { role: slug, permissions: permissions.join(',').slice(0, 500) },
    request,
  })
}
