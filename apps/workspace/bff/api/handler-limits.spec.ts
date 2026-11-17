/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requireAuthorizedSession = vi.fn()
vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: () => requireAuthorizedSession(),
}))
vi.mock('server-only', () => ({}))

import { DEFAULT_MUTATION_LIMIT, createInProcessStore, setLimitStore } from '@/lib/limits'
import { apiRoute } from './handler'

const SESSION = {
  userId: 'user_me',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  role: 'member',
  permissions: [],
}

let orgCounter = 0
function session() {
  return { ...SESSION, organizationId: `org_${++orgCounter}` }
}

function request(method: string): Request {
  return new Request('https://grid.test/api/things', { method })
}

beforeEach(() => {
  setLimitStore(createInProcessStore())
  requireAuthorizedSession.mockReset()
})

afterEach(() => {
  setLimitStore(null)
})

describe('apiRoute rate limiting', () => {
  it('bounds a mutating route that declared no limit at all', async () => {
    const current = session()
    requireAuthorizedSession.mockResolvedValue(current)
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const route = apiRoute(handler, { authz: { sessionOnly: true, why: 'spec' } })

    const burst = DEFAULT_MUTATION_LIMIT.burst?.limit ?? DEFAULT_MUTATION_LIMIT.limit
    for (let i = 0; i < burst; i++) {
      expect((await route(request('POST'))).status).toBe(200)
    }
    const refused = await route(request('POST'))

    expect(refused.status).toBe(429)
    expect(handler).toHaveBeenCalledTimes(burst)
  })

  it('answers a refusal with Retry-After and the policy that bit', async () => {
    const current = session()
    requireAuthorizedSession.mockResolvedValue(current)
    const route = apiRoute(async () => ({ ok: true }), {
      authz: { sessionOnly: true, why: 'spec' },
      limits: { rule: { name: 'spec-tight', limit: 1, windowMs: 60_000 } },
    })

    await route(request('POST'))
    const refused = await route(request('POST'))

    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
    expect(refused.headers.get('X-RateLimit-Policy')).toBe('spec-tight')
    expect(await refused.json()).toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('leaves reads to the edge budget rather than charging them here', async () => {
    const current = session()
    requireAuthorizedSession.mockResolvedValue(current)
    const route = apiRoute(async () => ({ ok: true }), {
      authz: { sessionOnly: true, why: 'spec' },
    })

    for (let i = 0; i < (DEFAULT_MUTATION_LIMIT.burst?.limit ?? 0) + 5; i++) {
      expect((await route(request('GET'))).status).toBe(200)
    }
  })

  it('honours an explicit exemption', async () => {
    const current = session()
    requireAuthorizedSession.mockResolvedValue(current)
    const route = apiRoute(async () => ({ ok: true }), {
      authz: { sessionOnly: true, why: 'spec' },
      limits: { none: true, why: 'spec: proves the opt-out is real' },
    })

    for (let i = 0; i < (DEFAULT_MUTATION_LIMIT.burst?.limit ?? 0) + 5; i++) {
      expect((await route(request('POST'))).status).toBe(200)
    }
  })

  it('charges the member within their organization, not the member alone', async () => {
    const rule = { name: 'spec-subject', limit: 1, windowMs: 60_000 }
    const route = apiRoute(async () => ({ ok: true }), {
      authz: { sessionOnly: true, why: 'spec' },
      limits: { rule },
    })

    const inOrgA = { ...SESSION, organizationId: 'org_a' }
    requireAuthorizedSession.mockResolvedValue(inOrgA)
    expect((await route(request('POST'))).status).toBe(200)
    expect((await route(request('POST'))).status).toBe(429)

    requireAuthorizedSession.mockResolvedValue({ ...SESSION, organizationId: 'org_b' })
    expect((await route(request('POST'))).status).toBe(200)
  })
})
