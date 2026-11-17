/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const findOrganization = vi.fn()
const upsertOrganization = vi.fn()
vi.mock('./repository', () => ({
  findOrganization: (...args: unknown[]) => findOrganization(...args),
  upsertOrganization: (...args: unknown[]) => upsertOrganization(...args),
}))
vi.mock('@/lib/workos/client', () => ({ getWorkOS: vi.fn() }))
vi.mock('@/lib/cache', () => ({ getCached: vi.fn(), invalidateCached: vi.fn() }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('@/lib/workos/feature-flags', () => ({
  isOrgFeatureEnabled: vi.fn(),
  WEB_SEARCH_FLAG: 'web-search',
}))

const requirePlatformPermission = vi.fn()
vi.mock('@/lib/authz/platform', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/authz/platform')>()
  return { ...original, requirePlatformPermission: (s: unknown) => requirePlatformPermission(s) }
})

import { ForbiddenError } from '@/lib/api/errors'
import { PlatformAccessDeniedError } from '@/lib/authz/platform'
import { PLATFORM_OWNED_SETTINGS } from '@/lib/db/schema/organizations'
import type { UserSession } from '@/lib/auth/types'
import { updateOrgSettings, updatePlatformOwnedOrgSettings, writeDedicatedOrgSetting } from './service'

const OWNER = { userId: 'user-1', email: 'ops@app.example' } as UserSession
const TENANT_ADMIN = { userId: 'user-2', email: 'admin@tenant.example' } as UserSession

describe('platform-owned settings keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findOrganization.mockResolvedValue({
      workosOrganizationId: 'org-1',
      displayName: null,
      defaultLocale: 'en',
      settings: {},
    })
    upsertOrganization.mockResolvedValue(undefined)
    requirePlatformPermission.mockResolvedValue(undefined)
  })

  it.each([...PLATFORM_OWNED_SETTINGS])('refuses %s from the tenant write path', async (key) => {
    await expect(
      updateOrgSettings('org-1', { settings: { [key]: 999_999_999_999 } })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(upsertOrganization).not.toHaveBeenCalled()
  })

  it('does not mistake inherited object properties for dedicated-route keys', async () => {
    await updateOrgSettings('org-1', { settings: { constructor: 'x', toString: 'y' } })
    expect(upsertOrganization).toHaveBeenCalled()
  })

  it('names every offending key, so a rejected patch is one round trip', async () => {
    await expect(
      updateOrgSettings('org-1', { settings: { storageQuotaBytes: 1, zdrOnly: true } })
    ).rejects.toThrow(/storageQuotaBytes/)
  })

  it('still accepts the keys the tenant does own', async () => {
    await updateOrgSettings('org-1', { settings: { chatEffort: 'low' } })
    expect(upsertOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { chatEffort: 'low' } })
    )
  })

  it('refuses a key a dedicated route owns (zdrOnly), whatever its value', async () => {
    for (const zdrOnly of [false, true, 'no']) {
      await expect(updateOrgSettings('org-1', { settings: { zdrOnly } })).rejects.toThrow(
        /model-config\/zdr/
      )
    }
    expect(upsertOrganization).not.toHaveBeenCalled()
  })

  it('refuses the upload-screening policy from the generic merge', async () => {
    await expect(
      updateOrgSettings('org-1', { settings: { uploadScreening: { enabled: false } } })
    ).rejects.toThrow(/upload-screening/)
    expect(upsertOrganization).not.toHaveBeenCalled()
  })

  it('writes a dedicated key through its own door, and only a declared one', async () => {
    await writeDedicatedOrgSetting('org-1', 'uploadScreening', { enabled: true })
    expect(upsertOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { uploadScreening: { enabled: true } } })
    )
    await expect(
      writeDedicatedOrgSetting('org-1', 'storageQuotaBytes' as unknown as 'zdrOnly', 1)
    ).rejects.toThrow(/not a dedicated setting/)
  })

  it('accepts a patch with no settings bag at all', async () => {
    await updateOrgSettings('org-1', { displayName: 'Renamed' })
    expect(upsertOrganization).toHaveBeenCalled()
  })

  it('lets the platform path write the same key', async () => {
    await updatePlatformOwnedOrgSettings(OWNER, 'org-1', {
      settings: { storageQuotaBytes: 42 },
    })
    expect(upsertOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { storageQuotaBytes: 42 } })
    )
  })

  it('refuses a caller who is not the platform owner', async () => {
    requirePlatformPermission.mockRejectedValue(new PlatformAccessDeniedError())
    await expect(
      updatePlatformOwnedOrgSettings(TENANT_ADMIN, 'org-1', {
        settings: { storageQuotaBytes: 999_999_999_999 },
      })
    ).rejects.toBeInstanceOf(PlatformAccessDeniedError)
    expect(upsertOrganization).not.toHaveBeenCalled()
  })

  it('refuses an absent session', async () => {
    requirePlatformPermission.mockRejectedValue(new PlatformAccessDeniedError())
    await expect(
      updatePlatformOwnedOrgSettings(null, 'org-1', { settings: { storageQuotaBytes: 1 } })
    ).rejects.toBeInstanceOf(PlatformAccessDeniedError)
    expect(upsertOrganization).not.toHaveBeenCalled()
  })

  it('merges rather than replaces, on both paths', async () => {
    findOrganization.mockResolvedValue({
      workosOrganizationId: 'org-1',
      displayName: null,
      defaultLocale: 'en',
      settings: { zdrOnly: true },
    })

    await updatePlatformOwnedOrgSettings(OWNER, 'org-1', {
      settings: { storageQuotaBytes: 42 },
    })
    expect(upsertOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { zdrOnly: true, storageQuotaBytes: 42 } })
    )
  })
})
