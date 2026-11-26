/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = { userId: 'user_operator', organizationId: 'org_platform' }
vi.mock('@/lib/auth/session', () => ({ getUserSession: async () => session }))

const requirePlatformPermission = vi.fn()
vi.mock('@/lib/authz/platform', () => {
  class PlatformAccessDeniedError extends Error { readonly status = 403 }
  return {
    PlatformAccessDeniedError,
    requirePlatformPermission: (...args: unknown[]) => requirePlatformPermission(...args),
  }
})

const savePlatformIngestAllowance = vi.fn()
vi.mock('@/lib/budgets/platform-service', () => ({
  savePlatformIngestAllowance: (...args: unknown[]) => savePlatformIngestAllowance(...args),
}))

import { PlatformAccessDeniedError } from '@/lib/authz/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { ConflictError } from '@/lib/api/errors'
import { PUT } from './route'

const context = { params: Promise.resolve({ organizationId: 'org_tenant' }) }
const url = 'http://localhost/api/platform/organizations/org_tenant/ingest-allowance'
const put = (body: unknown) => PUT(new Request(url, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}), context)

describe('platform organization ingest-allowance route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    requirePlatformPermission.mockResolvedValue(undefined)
    savePlatformIngestAllowance.mockResolvedValue({ unit: 'credit', monthlyAllowance: 50000, explicit: true })
  })

  it('requires organizations-manage and hands the URL organization to the service', async () => {
    const response = await put({ unit: 'credit', monthlyAllowance: 50000 })

    expect(response.status).toBe(200)
    expect(requirePlatformPermission).toHaveBeenCalledWith(session, PLATFORM_PERMISSIONS.organizationsManage)
    expect(savePlatformIngestAllowance).toHaveBeenCalledWith(
      session, 'org_tenant', { unit: 'credit', monthlyAllowance: 50000 }, expect.any(Request),
    )
  })

  it('goes back to the default with null', async () => {
    expect((await put({ unit: 'credit', monthlyAllowance: null })).status).toBe(200)
    expect(savePlatformIngestAllowance).toHaveBeenCalledWith(
      session, 'org_tenant', { unit: 'credit', monthlyAllowance: null }, expect.any(Request),
    )
  })

  it('rejects a negative amount, a missing unit and unknown fields before the service', async () => {
    expect((await put({ unit: 'credit', monthlyAllowance: -1 })).status).toBe(400)
    expect((await put({ monthlyAllowance: 10 })).status).toBe(400)
    expect((await put({ unit: 'credit', monthlyAllowance: 10, factor: 3 })).status).toBe(400)
    expect(savePlatformIngestAllowance).not.toHaveBeenCalled()
  })

  it('answers 409 when the office changed its budget unit', async () => {
    savePlatformIngestAllowance.mockRejectedValue(new ConflictError('unit changed'))
    expect((await put({ unit: 'credit', monthlyAllowance: 10 })).status).toBe(409)
  })

  it('answers 403 without the platform permission', async () => {
    requirePlatformPermission.mockRejectedValue(new PlatformAccessDeniedError('denied'))
    expect((await put({ unit: 'credit', monthlyAllowance: 10 })).status).toBe(403)
    expect(savePlatformIngestAllowance).not.toHaveBeenCalled()
  })
})
