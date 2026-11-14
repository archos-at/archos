/**
 * Whether the platform MCP gateway may admit a person whose token names another
 * organization (ADR-0154, amendment of 2026-11-05).
 *
 * A WorkOS token names the one organization picked at sign-in, and its `roles`
 * are that membership's. agentgateway admits a token of the platform
 * organization by those claims alone; for a token of any other organization it
 * asks here, and this answers from the person's live membership of the platform
 * organization: admitted when it holds one of the roles the gateway names.
 *
 * The token is checked for AuthKit's signature, issuer and expiry, so a forged
 * `sub` is worthless. Its audience is the gateway's business, checked there
 * before this is asked. The route is behind its own secret
 * (`PLATFORM_MCP_ADMISSION_TOKEN`), which only the gateway holds.
 */

import { errors as joseErrors, jwtVerify } from 'jose'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import { rolesOf } from '@/lib/auth/types'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { authkitDomain, authkitIssuer } from './mcp-config'
import { type PrincipalDeps, authkitKeys } from './principal'

export type PlatformAdmission =
  | { admitted: true; userId: string }
  | { admitted: false; status: 401 | 403 | 503; reason: string }

const refused = (status: 401 | 403 | 503, reason: string): PlatformAdmission => ({ admitted: false, status, reason })

/** The subject of a verified AuthKit token in `authorization`, or why there is none. */
async function verifiedSubject(authorization: string | null, deps: PrincipalDeps): Promise<string | PlatformAdmission> {
  const domain = authkitDomain()
  const issuer = authkitIssuer()
  if (!domain || !issuer) return refused(503, 'No AuthKit domain is configured (WORKOS_AUTHKIT_DOMAIN).')
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return refused(401, 'No bearer token.')
  try {
    const { payload } = await jwtVerify(token, authkitKeys(domain, deps), { issuer, algorithms: ['RS256'] })
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : refused(401, 'The token names no user.')
  } catch (error) {
    return refused(401, error instanceof joseErrors.JOSEError ? error.message : 'The token could not be verified.')
  }
}

/**
 * Admitted when the token's person is a member of the platform organization now
 * and holds one of `admittedRoles` there. The membership lookup is at most a
 * minute old (`resolvePinnedRequesterSession`), as on the app's own doors.
 */
export async function platformGatewayAdmission(
  authorization: string | null,
  admittedRoles: readonly string[],
  deps: PrincipalDeps = {},
): Promise<PlatformAdmission> {
  const subject = await verifiedSubject(authorization, deps)
  if (typeof subject !== 'string') return subject
  const platformOrganizationId = await getPlatformOrganizationId()
  if (!platformOrganizationId) return refused(503, 'The platform organization could not be resolved.')
  const session = await resolvePinnedRequesterSession({ userId: subject, email: null, organizationId: platformOrganizationId })
  if (!session) return refused(403, 'Not a member of the platform organization.')
  if (!rolesOf(session).some((role) => admittedRoles.includes(role))) return refused(403, 'No admitted role in the platform organization.')
  return { admitted: true, userId: subject }
}
