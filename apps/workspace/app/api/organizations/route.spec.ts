/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createOrganization = vi.fn()
const createOrganizationMembership = vi.fn()
const listOrganizationMemberships = vi.fn()

vi.mock('@workos-inc/authkit-nextjs', () => ({
  refreshSession: vi.fn().mockResolvedValue({ user: { id: 'user_1' } }),
}))

vi.mock('@/lib/workos/client', () => ({
  getWorkOS: () => ({
    organizations: { createOrganization },
    userManagement: { createOrganizationMembership, listOrganizationMemberships },
  }),
}))

const placeOrganization = vi.hoisted(() => vi.fn())
vi.mock('@/lib/organizations/repository', () => ({ placeOrganization }))

const captureServer = vi.hoisted(() => vi.fn(() => true))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer }))

import { POST } from './route'

const request = (body: unknown): Request =>
  new Request('http://localhost/api/organizations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /api/organizations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.DISABLE_SELF_SERVE_ORGS
    createOrganization.mockResolvedValue({ id: 'org_new' })
    createOrganizationMembership.mockResolvedValue({})
    listOrganizationMemberships.mockResolvedValue({ data: [] })
  })

  // Review of #1545, fix 12: a retry after a failed row write must not make a second organization.
  it('asks WorkOS with one idempotency key per person and name, and joins only once', async () => {
    await POST(request({ name: 'Acme', homeCountry: 'AT' }))
    placeOrganization.mockRejectedValueOnce(new Error('db down'))
    listOrganizationMemberships.mockResolvedValue({ data: [{ id: 'om_1' }] })
    await POST(request({ name: 'Acme', homeCountry: 'AT' }))
    const keys = createOrganization.mock.calls.map(([, options]) => (options as { idempotencyKey: string }).idempotencyKey)
    expect(keys[0]).toMatch(/^organization-create:[0-9a-f]{64}$/)
    expect(keys[1]).toBe(keys[0])
    expect(createOrganizationMembership).toHaveBeenCalledTimes(1)

    await POST(request({ name: 'Other office', homeCountry: 'AT' }))
    expect((createOrganization.mock.calls[2][1] as { idempotencyKey: string }).idempotencyKey).not.toBe(keys[0])
  })

  it('creates an org and makes the caller admin', async () => {
    const res = await POST(request({ name: 'Acme', homeCountry: 'AT' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ organizationId: 'org_new' })
    expect(createOrganizationMembership).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', organizationId: 'org_new', roleSlug: 'admin' })
    )
  })

  it('writes the row with the home country the office named', async () => {
    const res = await POST(request({ name: 'Acme', homeCountry: 'DE' }))
    expect(res.status).toBe(200)
    expect(placeOrganization).toHaveBeenCalledWith('org_new', 'DE')
  })

  it('refuses a request that names no home country, or one not offered, and creates nothing', async () => {
    for (const body of [{ name: 'Acme' }, { name: 'Acme', homeCountry: 'at' }, { name: 'Acme', homeCountry: 'XX' }]) {
      const res = await POST(request(body))
      expect(res.status).toBe(400)
    }
    expect(createOrganization).not.toHaveBeenCalled()
    expect(placeOrganization).not.toHaveBeenCalled()
  })

  it('is blocked when self-serve org creation is disabled (invite-only platform)', async () => {
    process.env.DISABLE_SELF_SERVE_ORGS = 'true'
    const res = await POST(request({ name: 'Acme', homeCountry: 'AT' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'self-serve-disabled' })
    expect(createOrganization).not.toHaveBeenCalled()
  })

  it('never leaks provider error messages to the client', async () => {
    createOrganization.mockRejectedValue(
      new Error('WorkOS internal: connection cfg_123 misconfigured')
    )
    const res = await POST(request({ name: 'Acme', homeCountry: 'AT' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'create-failed' })
  })

  it('reports organization_created to PostHog as the creator, carrying no name', async () => {
    await POST(request({ name: 'Acme', homeCountry: 'AT' }))

    expect(captureServer).toHaveBeenCalledTimes(1)
    expect(captureServer).toHaveBeenCalledWith({
      event: 'organization_created',
      distinctId: 'user_1',
      organizationId: 'org_new',
    })
    expect(JSON.stringify(captureServer.mock.calls)).not.toContain('Acme')
  })

  it('reports nothing when the organization was not created', async () => {
    createOrganization.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await POST(request({ name: 'Acme', homeCountry: 'AT' }))

    expect(captureServer).not.toHaveBeenCalled()
  })

  it('reports nothing when self-serve creation is disabled', async () => {
    process.env.DISABLE_SELF_SERVE_ORGS = 'true'

    await POST(request({ name: 'Acme', homeCountry: 'AT' }))

    expect(captureServer).not.toHaveBeenCalled()
  })
})
