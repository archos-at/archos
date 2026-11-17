import { getTokenClaims, withAuth } from '@workos-inc/authkit-nextjs'
import { currentActingSession } from '@/lib/agent-api/acting-session'
import { lookupSubjectMembership, type SubjectMembership } from '@/lib/authz/project-membership'
import { clearTenantContext, enterTenantContext } from '@/lib/db/tenant-context'
import { SessionRequiredError } from '@/lib/api/errors'
import type { UserSession } from './types'

async function membershipOf(organizationId: string, userId: string): Promise<SubjectMembership | null | undefined> {
  try {
    return await lookupSubjectMembership(organizationId, userId)
  } catch (error) {
    console.warn(`[session] membership lookup failed for ${userId}:`, error)
    return undefined
  }
}

export function sessionRoles(fromAuth: unknown, fromClaims: unknown, single: string | null): string[] {
  const listed = Array.isArray(fromAuth) ? fromAuth : Array.isArray(fromClaims) ? fromClaims : null
  const roles = (listed ?? []).filter((role): role is string => typeof role === 'string' && role.length > 0)
  if (roles.length === 0 && single) return [single]
  return [...new Set(roles)]
}

export async function getUserSession(): Promise<UserSession | null> {
  const actingSession = currentActingSession()
  if (actingSession) {
    enterTenantContext(actingSession)
    return actingSession
  }

  const auth = await withAuth()

  if (!auth.user || !auth.accessToken) {
    clearTenantContext()
    return null
  }

  const claims = await getTokenClaims(auth.accessToken)

  const name =
    auth.user.firstName && auth.user.lastName
      ? `${auth.user.firstName} ${auth.user.lastName}`
      : auth.user.firstName || auth.user.lastName || auth.user.name || null

  const organizationId = auth.organizationId ?? null

  const membership = organizationId ? await membershipOf(organizationId, auth.user.id) : undefined
  const tokenRole = auth.role ?? (typeof claims.role === 'string' ? claims.role : null)

  const session: UserSession = {
    userId: auth.user.id,
    email: auth.user.email,
    name,
    accessToken: auth.accessToken,
    organizationId,
    organizationMembershipId: membership?.organizationMembershipId ?? null,
    role: tokenRole,
    roles: membership === undefined ? sessionRoles(auth.roles, claims.roles, tokenRole) : (membership?.roles ?? []),
    permissions: auth.permissions ?? [],
    featureFlags: auth.featureFlags ?? null,
    profilePictureUrl: auth.user.profilePictureUrl ?? null,
    organizationName: typeof claims.organization_name === 'string' ? claims.organization_name : null,
  }

  enterTenantContext(session)

  return session
}

export async function requireUserSession(): Promise<UserSession> {
  const session = await getUserSession()

  if (!session) {
    throw new SessionRequiredError()
  }

  return session
}
