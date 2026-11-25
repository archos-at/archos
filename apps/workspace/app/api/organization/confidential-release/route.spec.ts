/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = {
  userId: 'user-1',
  organizationId: 'org_1',
  email: 'admin@grid.com',
  role: 'admin',
  permissions: adminPermissions(),
}

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockImplementation(async () => session),
}))

const stored: { settings: Record<string, unknown> } = { settings: {} }
const upsertOrganization = vi.fn(async (row: { settings: Record<string, unknown> }) => {
  stored.settings = row.settings
})
vi.mock('@/lib/organizations/repository', () => ({
  findOrganization: vi.fn(async () => ({
    workosOrganizationId: 'org_1',
    displayName: null,
    defaultLocale: 'de',
    settings: stored.settings,
  })),
  upsertOrganization: (row: { settings: Record<string, unknown> }) => upsertOrganization(row),
}))
const invalidateCached = vi.fn()
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader()),
  invalidateCached: (key: string) => invalidateCached(key),
}))
const recordAuditEvent = vi.fn()
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: (event: unknown) => recordAuditEvent(event) }))
vi.mock('@/lib/workos/client', () => ({ getWorkOS: vi.fn() }))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: vi.fn(), WEB_SEARCH_FLAG: 'web-search' }))

import { findOperation } from '@/lib/agent-api/catalog'
import { GET, PUT } from './route'
import { adminPermissions } from '@/test-utils/admin-permissions'

const URL = 'http://localhost/api/organization/confidential-release'
const put = (body: unknown): Promise<Response> =>
  PUT(new Request(URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

describe('/api/organization/confidential-release', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stored.settings = { chatEffort: 'low' }
  })

  it('reads as allowed while the office never chose', async () => {
    const res = await GET(new Request(URL))
    expect(await res.json()).toEqual({ enabled: true })
  })

  it('switches release off, keeping the rest of the bag, and audits the switch', async () => {
    const res = await put({ enabled: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
    expect(stored.settings).toEqual({ chatEffort: 'low', confidentialRelease: false })
    expect(invalidateCached).toHaveBeenCalledWith('confidential-release:org_1')
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'org.confidential_release.updated',
        metadata: { enabled: 'false', previous: 'true' },
      })
    )
    expect(await (await GET(new Request(URL))).json()).toEqual({ enabled: false })
  })

  it.each([{}, { enabled: 'off' }, { enabled: null }])('refuses %j without writing', async (body) => {
    expect((await put(body)).status).toBe(400)
    expect(upsertOrganization).not.toHaveBeenCalled()
  })

  it('is the operation an agent finds, marked a control', () => {
    expect(findOperation('organization-confidential-release-set')?.sensitivity).toBe('control')
  })
})
