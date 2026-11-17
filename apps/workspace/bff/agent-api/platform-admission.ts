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
