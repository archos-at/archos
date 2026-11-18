import 'server-only'

import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
  bearerAuthChallengeResponse,
  getOAuthProtectedResourceMetadataUrl,
  verifyBearerToken,
} from '@modelcontextprotocol/server'
import { type JWTVerifyGetKey, createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose'
import { ApiError } from '@/lib/api/errors'
import { requireVerifiedContext, requirePinnedSession } from '@/lib/api/internal-envelope'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { FEATURE_FLAGS, type KnownFeatureFlag } from '@/lib/authz/feature-flags'
import { getPlatformOrganizationId, isPlatformStaff } from '@/lib/authz/platform'
import { isUuid } from '@/lib/ids'
import { INTERNAL_TOKEN_HEADER, requireInternalToken } from '@/lib/internal-auth'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import {
  type DoorResource,
  acceptedAudiences,
  authkitDomain,
  authkitIssuer,
  doorOf,
  doorResourceUrl,
  requestHost,
} from './mcp-config'
import { SENSITIVITIES, type Sensitivity } from './operation'
import type { AgentDoor } from './exposure'
import { hasHeader, readHeader } from '@/lib/http/legacy-header-names'
import { PRODUCT_NAME } from '@/lib/brand'
import { AGENT_KIND, type AgentKind } from '@/lib/agent-kind'

export type AgentActor = 'external_agent' | AgentKind

export interface AgentPrincipal {
  actor: AgentActor
  session: AuthorizedSession
  clientId: string | null
  scopes: string[]
  conversationId?: string | null
  projectId?: string | null
  answerMessageId?: string | null
  sensitiveOptIns?: readonly Sensitivity[]
  door?: AgentDoor
}

export const SENSITIVE_OPT_IN_FLAGS: Readonly<Record<Sensitivity, KnownFeatureFlag>> = {
  access: FEATURE_FLAGS.agentMcpAccess,
  secret: FEATURE_FLAGS.agentMcpSecrets,
  control: FEATURE_FLAGS.agentMcpControls,
}

async function sensitiveOptInsOf(organizationId: string): Promise<Sensitivity[]> {
  const on = await Promise.all(
    SENSITIVITIES.map((sensitivity) => isOrgFeatureEnabled(SENSITIVE_OPT_IN_FLAGS[sensitivity], organizationId)),
  )
  return SENSITIVITIES.filter((_, index) => on[index] === true)
}

export const ANSWER_MESSAGE_HEADER = 'x-answer-message-id'

export interface AuthChallenge {
  kind: 'challenge'
  response: Response
}

export function isChallenge(value: AgentPrincipal | AuthChallenge): value is AuthChallenge {
  return 'kind' in value && value.kind === 'challenge'
}

export interface PrincipalDeps {
  jwks?: JWTVerifyGetKey
}

const challenge = (response: Response): AuthChallenge => ({ kind: 'challenge', response })

const refuse = (status: number, message: string): AuthChallenge =>
  challenge(Response.json({ error: message, code: status === 403 ? 'FORBIDDEN' : 'UNAVAILABLE' }, { status }))

const remoteKeys = new Map<string, JWTVerifyGetKey>()

export function authkitKeys(domain: string, deps: PrincipalDeps = {}): JWTVerifyGetKey {
  if (deps.jwks) return deps.jwks
  let keys = remoteKeys.get(domain)
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${domain}/oauth2/jwks`))
    remoteKeys.set(domain, keys)
  }
  return keys
}

function stringClaim(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function acceptedAudienceOf(aud: unknown, accepted: readonly string[]): URL | null {
  const named = (Array.isArray(aud) ? aud : [aud]).filter((value): value is string => typeof value === 'string')
  const match = named.find((value) => accepted.includes(value))
  return match ? new URL(match) : null
}

export function tokenVerifier(
  domain: string,
  issuer: string,
  deps: PrincipalDeps,
  door: DoorResource = 'mcp',
): OAuthTokenVerifier {
  const audiences = acceptedAudiences(door)
  return {
    async verifyAccessToken(token): Promise<AuthInfo> {
      try {
        const { payload } = await jwtVerify(token, authkitKeys(domain, deps), {
          issuer,
          audience: audiences,
          algorithms: ['RS256'],
        })
        const scope = stringClaim(payload.scope)
        const resource = acceptedAudienceOf(payload.aud, audiences)
        if (!resource) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Token was not issued for this resource')
        return {
          token,
          clientId: stringClaim(payload.client_id) ?? '',
          scopes: scope ? scope.split(/\s+/) : [],
          expiresAt: payload.exp,
          resource,
          extra: { sub: payload.sub ?? null, orgId: stringClaim(payload.org_id) },
        }
      } catch (error) {
        const reason = error instanceof joseErrors.JOSEError ? error.message : 'token could not be verified'
        throw new OAuthError(OAuthErrorCode.InvalidToken, reason)
      }
    },
  }
}

async function externalPrincipal(request: Request, deps: PrincipalDeps): Promise<AgentPrincipal | AuthChallenge> {
  const door = doorOf(request)
  const domain = authkitDomain()
  const issuer = authkitIssuer()
  const resource = doorResourceUrl(door, process.env, requestHost(request))
  if (!domain || !issuer || !resource) {
    return refuse(
      503,
      'The agent door is not configured on this deployment (WORKOS_AUTHKIT_DOMAIN / MCP_RESOURCE_URL).',
    )
  }
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resource)

  let auth: AuthInfo
  try {
    auth = await verifyBearerToken(request.headers.get('authorization'), {
      verifier: tokenVerifier(domain, issuer, deps, door),
      resourceMetadataUrl,
    })
  } catch (error) {
    return challenge(bearerAuthChallengeResponse(error, { resourceMetadataUrl }))
  }

  const userId = stringClaim(auth.extra?.sub)
  const organizationId = stringClaim(auth.extra?.orgId)
  if (!userId) return refuse(403, 'The token names no user.')
  if (!organizationId) {
    return refuse(
      403,
      'The token is not bound to an organization. Sign in to ' + PRODUCT_NAME + ' with an organization and authorize the client again.',
    )
  }

  if (door === 'platform') return platformPrincipal(auth, userId)

  if (!(await isOrgFeatureEnabled(FEATURE_FLAGS.agentMcp, organizationId))) {
    return refuse(403, 'Agent access (MCP) is not enabled for this organization.')
  }

  const session = await freshSession(userId, organizationId)
  if (!session) return refuse(403, 'You are not a member of this organization.')

  return {
    actor: 'external_agent',
    session,
    clientId: auth.clientId || null,
    scopes: auth.scopes,
    sensitiveOptIns: await sensitiveOptInsOf(organizationId),
  }
}

function freshSession(userId: string, organizationId: string): Promise<AuthorizedSession | null> {
  return resolvePinnedRequesterSession({ userId, email: null, organizationId })
}

async function platformPrincipal(auth: AuthInfo, userId: string): Promise<AgentPrincipal | AuthChallenge> {
  const platformOrganizationId = await getPlatformOrganizationId()
  if (!platformOrganizationId) return refuse(503, 'The platform organization could not be resolved. Try again shortly.')
  if (!(await isOrgFeatureEnabled(FEATURE_FLAGS.platformAgentMcp, platformOrganizationId))) {
    return refuse(403, 'Agent access to the platform console (MCP) is not enabled.')
  }
  const session = await freshSession(userId, platformOrganizationId)
  if (!session) return refuse(403, 'You are not a member of the GRID Platform organization.')
  if (!(await isPlatformStaff(session))) return refuse(403, 'You hold no platform permission.')

  return {
    actor: 'external_agent',
    session,
    clientId: auth.clientId || null,
    scopes: auth.scopes,
    sensitiveOptIns: await sensitiveOptInsOf(platformOrganizationId),
    door: 'platform',
  }
}

function answerMessageIdOf(request: Request): string | null {
  const value = readHeader(request.headers, ANSWER_MESSAGE_HEADER)?.trim()
  return value && isUuid(value) ? value : null
}

async function agentPrincipal(request: Request): Promise<AgentPrincipal | AuthChallenge> {
  const denied = requireInternalToken(request, 'mcp')
  if (denied) return challenge(denied)
  try {
    const context = requireVerifiedContext(request)
    const session = await requirePinnedSession(context)
    return {
      actor: AGENT_KIND,
      session,
      clientId: null,
      scopes: [],
      conversationId: context.conversationId,
      projectId: context.projectId,
      answerMessageId: answerMessageIdOf(request),
    }
  } catch (error) {
    if (error instanceof ApiError) {
      return challenge(Response.json({ error: error.message, code: error.code }, { status: error.status }))
    }
    throw error
  }
}

export async function resolvePrincipal(
  request: Request,
  deps: PrincipalDeps = {},
): Promise<AgentPrincipal | AuthChallenge> {
  if (hasHeader(request.headers, INTERNAL_TOKEN_HEADER)) {
    if (doorOf(request) === 'platform') return refuse(403, PRODUCT_NAME + ' does not use the platform door.')
    return agentPrincipal(request)
  }
  return externalPrincipal(request, deps)
}
