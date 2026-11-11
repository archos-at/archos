/**
 * @vitest-environment node
 */
/**
 * The `site-resolution` flag is the gate of both site routes (ADR-0172): off,
 * each answers 403 and the service is never reached; on, the route hands the
 * service what it parsed. The service itself runs against Postgres in
 * `bff/site-resolution/site-resolution.integration.spec.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const SESSION = vi.hoisted(() => ({
  userId: 'user_1',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  email: 'anna@example.test',
  name: 'Anna Berger',
  role: 'member',
  permissions: [] as string[],
  featureFlags: [] as string[] | null,
}))

vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession: vi.fn(async () => SESSION) }))

const service = vi.hoisted(() => ({
  resolveSite: vi.fn(async (_session: unknown, typed: string) => ({ status: 'unverified', typed, reason: 'no_register', statedCountry: null, candidates: [] })),
  setProjectSite: vi.fn(async () => ({ resolution: { status: 'unverified' }, profileVersion: 2 })),
}))
vi.mock('@/lib/site-resolution/service', () => service)

import { GET } from './route'
import { POST } from '../../projects/[id]/site/route'

const resolve = () => GET(new Request('https://grid.test/api/sites/resolve?q=Herrengasse%2016%2C%208010%20Graz'))
const setSite = () =>
  POST(
    new Request('https://grid.test/api/projects/p1/site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typed: 'Herrengasse 16, 8010 Graz' }),
    }),
    { params: Promise.resolve({ id: 'p1' }) },
  )

beforeEach(() => {
  vi.stubEnv('REQUIRE_AUTH', 'true')
  service.resolveSite.mockClear()
  service.setProjectSite.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('the site routes behind site-resolution', () => {
  it('answer 403 with the flag off, and never reach the service', async () => {
    SESSION.featureFlags = []
    const [read, write] = await Promise.all([resolve(), setSite()])
    expect(read.status).toBe(403)
    expect(write.status).toBe(403)
    expect(await read.json()).toMatchObject({ code: 'feature_disabled', feature: 'site-resolution' })
    expect(service.resolveSite).not.toHaveBeenCalled()
    expect(service.setProjectSite).not.toHaveBeenCalled()
  })

  it('reach the service with the flag on (positive control)', async () => {
    SESSION.featureFlags = ['site-resolution']
    const read = await resolve()
    expect(read.status).toBe(200)
    expect(service.resolveSite).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org_1' }), 'Herrengasse 16, 8010 Graz')
    expect((await setSite()).status).toBe(200)
    expect(service.setProjectSite).toHaveBeenCalledWith(expect.anything(), 'p1', { typed: 'Herrengasse 16, 8010 Graz' })
  })
})
