import 'server-only'
import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { findPermissionSpec, type PermissionTier } from './catalog'
import { findProjectTenancy } from '@/lib/projects/repository'
import {
  hasPermission,
  ORG_PERMISSIONS,
  type AnyPermission,
  type KnownPermission,
  type PlatformPermission,
  type ProjectPermission,
} from './permissions'
import { hasPlatformPermission } from './platform'
import { requireProjectAccess, type ProjectAccess } from './projects'
import { isProjectClosedError } from '@/lib/projects/project-status'
import type { AuthorizedSession } from '@/lib/auth/types'

export type AuthzResource = { readonly type: 'project'; readonly id: string }

export type AuthzRule =
  | 'no-session'
  | 'no-organization'
  | 'jwt-permission'
  | 'platform-membership'
  | 'org-admin-bypass'
  | 'resource-role'
  | 'project-inherited'
  | 'closed-project-open'
  | 'project-closed'
  | 'tenancy-mismatch'
  | 'no-grant'

export interface AuthzDecision {
  readonly allowed: boolean
  readonly rule: AuthzRule
  readonly permission: AnyPermission
  readonly tier: PermissionTier
  readonly resource?: AuthzResource
}

function asAuthorized(session: UserSession): AuthorizedSession | null {
  const { organizationId, organizationMembershipId, role } = session
  if (!organizationId || !organizationMembershipId) return null
  return { ...session, organizationId, organizationMembershipId, role: role ?? '' }
}

function tierOf(permission: AnyPermission): PermissionTier {
  const spec = findPermissionSpec(permission)
  if (!spec) {
    throw new Error(`[authz] permission "${permission}" is not in the catalog`)
  }
  return spec.tier
}

function deny(
  permission: AnyPermission,
  tier: PermissionTier,
  rule: AuthzRule,
  resource?: AuthzResource
): AuthzDecision {
  return { allowed: false, rule, permission, tier, resource }
}

function allow(
  permission: AnyPermission,
  tier: PermissionTier,
  rule: AuthzRule,
  resource?: AuthzResource
): AuthzDecision {
  return { allowed: true, rule, permission, tier, resource }
}

async function decideClaimsTier(
  session: UserSession,
  permission: KnownPermission,
  tier: PermissionTier
): Promise<AuthzDecision> {
  if (tier === 'platform') {
    return (await hasPlatformPermission(session, permission as PlatformPermission))
      ? allow(permission, tier, 'platform-membership')
      : deny(permission, tier, 'no-grant')
  }

  return hasPermission(session, permission)
    ? allow(permission, tier, 'jwt-permission')
    : deny(permission, tier, 'no-grant')
}

async function decideProjectTier(
  session: UserSession,
  permission: ProjectPermission,
  resource: AuthzResource
): Promise<AuthzDecision> {
  const authorized = asAuthorized(session)
  if (!authorized) return deny(permission, 'project', 'no-organization', resource)
  let access: ProjectAccess
  try {
    access = await requireProjectAccess(authorized, resource.id, permission)
  } catch (error) {
    if (isProjectClosedError(error)) return deny(permission, 'project', 'project-closed', resource)
    if (error instanceof NotFoundError) {
      const tenancy = await findProjectTenancy(resource.id)
      const mismatched =
        !tenancy ||
        tenancy.organizationId !== authorized.organizationId ||
        Boolean(tenancy.deletedAt)
      return deny(permission, 'project', mismatched ? 'tenancy-mismatch' : 'no-grant', resource)
    }
    throw error
  }
  return allow(
    permission,
    'project',
    access.readsBecauseClosed
      ? 'closed-project-open'
      : hasPermission(session, ORG_PERMISSIONS.projectsAdminister)
        ? 'org-admin-bypass'
        : 'resource-role',
    resource
  )
}

export async function decide(
  session: UserSession | null,
  permission: AnyPermission,
  resource?: AuthzResource
): Promise<AuthzDecision> {
  const tier = tierOf(permission)
  if (!session) return deny(permission, tier, 'no-session', resource)

  if (tier === 'org' || tier === 'platform') {
    return decideClaimsTier(session, permission as KnownPermission, tier)
  }

  if (tier !== 'project') {
    throw new Error(`[authz] permission "${permission}" is ${tier}-tier, which this module does not decide`)
  }
  if (!resource) {
    throw new Error(`[authz] permission "${permission}" is project-tier and requires a resource`)
  }
  return decideProjectTier(session, permission as ProjectPermission, resource)
}

export async function can(
  session: UserSession | null,
  permission: AnyPermission,
  resource?: AuthzResource
): Promise<boolean> {
  return (await decide(session, permission, resource)).allowed
}

export async function authorize(
  session: UserSession | null,
  permission: AnyPermission,
  resource?: AuthzResource
): Promise<AuthzDecision> {
  const decision = await decide(session, permission, resource)
  if (decision.allowed) return decision
  if (decision.tier === 'org' || decision.tier === 'platform') throw new ForbiddenError()
  throw new NotFoundError()
}
