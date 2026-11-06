/**
 * @vitest-environment node
 */
/**
 * The platform MCP gateway's admission for a token of another organization
 * (ADR-0154, amendment of 2026-11-05): live membership of the platform
 * organization with an admitted role, from a token AuthKit really signed.
 */

import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/pinned-session', () => ({ resolvePinnedRequesterSession: vi.fn() }))
vi.mock('@/lib/authz/platform', () => ({ getPlatformOrganizationId: vi.fn(), isPlatformStaff: vi.fn() }))

import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { platformGatewayAdmission } from './platform-admission'

const DOMAIN = 'auth.example.test'
const ISSUER = `https://${DOMAIN}`
const PLATFORM_ORG = 'org_platform'
const OWNER = ['org-platform-owner']
const KID = 'test-key'

const owner: AuthorizedSession = {
  userId: 'user_ops',
  email: 'ops@example.test',
  name: null,
  accessToken: '',
  organizationId: PLATFORM_ORG,
  organizationMembershipId: 'om_ops',
  role: 'org-platform-owner',
  permissions: [],
  featureFlags: null,
}

let privateKey: CryptoKey
let jwks: ReturnType<typeof createLocalJWKSet>

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey as CryptoKey
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }] })
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WORKOS_AUTHKIT_DOMAIN = DOMAIN
  vi.mocked(getPlatformOrganizationId).mockResolvedValue(PLATFORM_ORG)
  vi.mocked(resolvePinnedRequesterSession).mockResolvedValue(owner)
})

/** An office token, as a person who picked their office at sign-in holds it. */
async function bearer(options: { iss?: string; sub?: string; key?: CryptoKey } = {}): Promise<string> {
  const jwt = new SignJWT({ org_id: 'org_office', roles: ['admin'] })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(options.iss ?? ISSUER)
    .setAudience('https://platform-mcp.example.test/langfuse/mcp')
    .setIssuedAt()
    .setExpirationTime('10m')
  if (options.sub !== '') jwt.setSubject(options.sub ?? 'user_ops')
  return `Bearer ${await jwt.sign(options.key ?? privateKey)}`
}

describe('platformGatewayAdmission', () => {
  it('admits a platform owner whose token names an office, from the live platform membership', async () => {
    expect(await platformGatewayAdmission(await bearer(), OWNER, { jwks })).toEqual({ admitted: true, userId: 'user_ops' })
    expect(resolvePinnedRequesterSession).toHaveBeenCalledWith({ userId: 'user_ops', email: null, organizationId: PLATFORM_ORG })
  })

  it('reads the platform membership’s roles, never the office roles the token carries', async () => {
    vi.mocked(resolvePinnedRequesterSession).mockResolvedValue({ ...owner, role: 'org-platform-support' })
    expect(await platformGatewayAdmission(await bearer(), OWNER, { jwks })).toMatchObject({ admitted: false, status: 403 })
    vi.mocked(resolvePinnedRequesterSession).mockResolvedValue({ ...owner, role: 'member', roles: ['member', 'org-platform-owner'] })
    expect(await platformGatewayAdmission(await bearer(), OWNER, { jwks })).toMatchObject({ admitted: true })
  })

  it('refuses a person who is not a member of the platform organization', async () => {
    vi.mocked(resolvePinnedRequesterSession).mockResolvedValue(null)
    expect(await platformGatewayAdmission(await bearer(), OWNER, { jwks })).toMatchObject({ admitted: false, status: 403 })
  })

  it('refuses a token AuthKit did not sign, or from another issuer, before any lookup', async () => {
    const stranger = (await generateKeyPair('RS256')).privateKey as CryptoKey
    for (const authorization of [await bearer({ key: stranger }), await bearer({ iss: 'https://evil.example' }), null, 'Basic abc']) {
      expect(await platformGatewayAdmission(authorization, OWNER, { jwks })).toMatchObject({ admitted: false, status: 401 })
    }
    expect(await platformGatewayAdmission(await bearer({ sub: '' }), OWNER, { jwks })).toMatchObject({ admitted: false, status: 401 })
    expect(resolvePinnedRequesterSession).not.toHaveBeenCalled()
  })

  it('answers 503 while it cannot tell: no AuthKit domain, or no platform organization', async () => {
    vi.mocked(getPlatformOrganizationId).mockResolvedValue(null)
    expect(await platformGatewayAdmission(await bearer(), OWNER, { jwks })).toMatchObject({ admitted: false, status: 503 })
    delete process.env.WORKOS_AUTHKIT_DOMAIN
    expect(await platformGatewayAdmission(await bearer(), OWNER, { jwks })).toMatchObject({ admitted: false, status: 503 })
  })
})
