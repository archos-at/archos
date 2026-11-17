import 'server-only'
import { getWorkOS } from '@/lib/workos/client'
import { recordAuditEvent } from '@/lib/audit/service'
import { rolePermissions } from './org-role-permissions'
import { ALL_PLATFORM_PERMISSION_SLUGS, PLATFORM_PERMISSIONS, type PlatformPermission } from './permissions'
import { resolveSubjectMembership } from './project-membership'
import type { UserSession } from '@/lib/auth/types'

export const PLATFORM_ORG_EXTERNAL_ID = process.env.PLATFORM_ORG_EXTERNAL_ID ?? 'grid-platform'
export const PLATFORM_OWNER_ROLE_SLUG = 'org-platform-owner'

const PLATFORM_ORG_CACHE_TTL_MS = 300_000
const PLATFORM_ORG_NEGATIVE_TTL_MS = 30_000

let platformOrgCache: { fetchedAt: number; organizationId: string | null } | null = null
const BREAK_GLASS_AUDIT_INTERVAL_MS = 60 * 60 * 1000
const breakGlassAuditedAt = new Map<string, number>()

async function auditBreakGlassUse(session: UserSession): Promise<void> {
  const throttleKey = `${session.userId}:${session.organizationId ?? 'none'}`
  const last = breakGlassAuditedAt.get(throttleKey)
  if (last && Date.now() - last < BREAK_GLASS_AUDIT_INTERVAL_MS) return
  breakGlassAuditedAt.set(throttleKey, Date.now())
  console.warn(
    `[Platform Authz] break-glass platform access granted to ${session.email} via PLATFORM_OWNER_EMAILS`
  )
  const platformOrgId = await getPlatformOrganizationId()
  if (platformOrgId) {
    await recordAuditEvent({
      organizationId: platformOrgId,
      actor: { userId: session.userId, email: session.email },
      action: 'platform.access.break_glass',
      targetType: 'platform',
      targetId: platformOrgId,
      metadata: { activeOrganizationId: session.organizationId },
    })
  }
}

export async function getPlatformOrganizationId(): Promise<string | null> {
  if (platformOrgCache) {
    const ttl = platformOrgCache.organizationId
      ? PLATFORM_ORG_CACHE_TTL_MS
      : PLATFORM_ORG_NEGATIVE_TTL_MS
    if (Date.now() - platformOrgCache.fetchedAt < ttl) {
      return platformOrgCache.organizationId
    }
  }
  try {
    const workos = getWorkOS()
    const org = await workos.organizations.getOrganizationByExternalId(PLATFORM_ORG_EXTERNAL_ID)
    platformOrgCache = { fetchedAt: Date.now(), organizationId: org.id }
  } catch {
    platformOrgCache = { fetchedAt: Date.now(), organizationId: null }
  }
  return platformOrgCache.organizationId
}

function bootstrapEmails(): string[] {
  return (process.env.PLATFORM_OWNER_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

async function platformMembershipPermissions(
  userId: string,
  platformOrgId: string
): Promise<ReadonlySet<string> | null> {
  const membership = await resolveSubjectMembership(platformOrgId, userId)
  if (!membership) return null
  const held = await rolePermissions(platformOrgId, membership.roles)
  return new Set(ALL_PLATFORM_PERMISSION_SLUGS.filter((permission) => held.has(permission)))
}

export async function platformPermissions(
  session: UserSession | null
): Promise<ReadonlySet<string> | null> {
  if (!session) return null

  if (session.email && bootstrapEmails().includes(session.email.toLowerCase())) {
    await auditBreakGlassUse(session)
    return new Set(ALL_PLATFORM_PERMISSION_SLUGS)
  }

  const platformOrgId = await getPlatformOrganizationId()
  if (!platformOrgId) return null

  if (session.organizationId === platformOrgId) {
    const claimed = session.permissions.filter((permission) =>
      (ALL_PLATFORM_PERMISSION_SLUGS as readonly string[]).includes(permission)
    )
    return claimed.length === 0 ? null : new Set(claimed)
  }

  return platformMembershipPermissions(session.userId, platformOrgId)
}

export async function isPlatformStaff(session: UserSession | null): Promise<boolean> {
  const permissions = await platformPermissions(session)
  if (permissions === null) return false
  return [...permissions].some((permission) => !EDGE_ONLY_PLATFORM_PERMISSIONS.has(permission))
}

const EDGE_ONLY_PLATFORM_PERMISSIONS: ReadonlySet<string> = new Set([PLATFORM_PERMISSIONS.observabilityView])

export async function hasPlatformPermission(
  session: UserSession | null,
  permission: PlatformPermission
): Promise<boolean> {
  const permissions = await platformPermissions(session)
  return permissions?.has(permission) ?? false
}

export class PlatformAccessDeniedError extends Error {
  readonly status = 403
  constructor(message = 'Platform owner access required') {
    super(message)
    this.name = 'PlatformAccessDeniedError'
  }
}

export async function requirePlatformPermission(
  session: UserSession | null,
  permission: PlatformPermission
): Promise<void> {
  if (!(await hasPlatformPermission(session, permission))) {
    throw new PlatformAccessDeniedError(`Platform permission required: ${permission}`)
  }
}

export function _clearPlatformCaches(): void {
  platformOrgCache = null
  breakGlassAuditedAt.clear()
}
