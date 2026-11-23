// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAuthorizedSession, getUserSession, requirePlatformPermission, principalOrRefusal } = vi.hoisted(() => ({
  requireAuthorizedSession: vi.fn(),
  getUserSession: vi.fn(),
  requirePlatformPermission: vi.fn(),
  principalOrRefusal: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession }))
vi.mock('@/lib/auth/session', () => ({ getUserSession }))
vi.mock('@/lib/authz/platform', () => ({
  PlatformAccessDeniedError: class PlatformAccessDeniedError extends Error {},
  requirePlatformPermission,
}))
vi.mock('@/lib/agent-api/door-principal', () => ({ principalOrRefusal }))

import { apiRoute, internalApiRoute, publicApiRoute } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { mcpDoorPost } from '@/lib/agent-api/mcp-door-route'
import { enterTenantContext, getTenantContext, withTenant, type TenantContext } from '@/lib/db/tenant-context'

const CALLER_ORG = 'ORG_CALLER'
const ROUTE_ORG = 'ORG_ROUTE'
const ROUTE_SESSION = { userId: 'u_route', organizationId: ROUTE_ORG }
const INTERNAL_TOKEN = 'a-real-token'

const tenantsSeen: Array<string | null> = []

function tenantOf(context: TenantContext | undefined): string | null {
  return context?.kind === 'tenant' ? context.organizationId : null
}

function enterOwnTenant(): void {
  tenantsSeen.push(tenantOf(getTenantContext()))
  enterTenantContext({ organizationId: ROUTE_ORG, userId: ROUTE_SESSION.userId })
}

async function enterAndAnswer() {
  enterOwnTenant()
  return { ok: true }
}

const ROUTES = [
  {
    name: 'apiRoute',
    build: () => apiRoute(async () => ({ ok: true }), { authz: { sessionOnly: true, why: 'spec' } }),
    request: () => new Request('https://grid.test/api/probe'),
  },
  {
    name: 'internalApiRoute',
    build: () => internalApiRoute('probe', enterAndAnswer, { tenancy: { fromPayload: 'organizationId' } }),
    request: () =>
      new Request('https://grid.test/api/internal/probe', { headers: { 'x-internal-token': INTERNAL_TOKEN } }),
  },
  {
    name: 'publicApiRoute',
    build: () => publicApiRoute(enterAndAnswer, { why: 'spec' }),
    request: () => new Request('https://grid.test/api/public/probe'),
  },
  {
    name: 'platformApiRoute',
    build: () => platformApiRoute(async () => ({ ok: true }), { permission: 'platform:organizations:view' }),
    request: () => new Request('https://grid.test/api/platform/probe'),
  },
  {
    name: 'mcpDoorPost',
    build: () => mcpDoorPost('office', 'probe'),
    request: () => new Request('https://grid.test/api/mcp', { method: 'POST' }),
  },
]

beforeEach(() => {
  tenantsSeen.length = 0
  vi.stubEnv('INTERNAL_API_TOKEN', INTERNAL_TOKEN)
  requireAuthorizedSession.mockImplementation(async () => {
    enterOwnTenant()
    return ROUTE_SESSION
  })
  getUserSession.mockImplementation(async () => {
    enterOwnTenant()
    return ROUTE_SESSION
  })
  requirePlatformPermission.mockResolvedValue(undefined)
  principalOrRefusal.mockImplementation(async () => {
    enterOwnTenant()
    return Response.json({ error: 'refused' }, { status: 401 })
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('a route factory runs each request in its own tenant slot', () => {
  it.each(ROUTES)(
    '$name does not inherit the caller tenant and leaves the caller tenant as it was',
    async ({ build, request }) => {
      const route = build()

      await withTenant({ organizationId: CALLER_ORG, userId: 'u_caller' }, async () => {
        await route(request())
        expect(getTenantContext()).toMatchObject({ kind: 'tenant', organizationId: CALLER_ORG })
      })

      expect(tenantsSeen).toEqual([null])
    }
  )
})
