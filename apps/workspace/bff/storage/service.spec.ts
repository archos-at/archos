import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const getOrgSettings = vi.fn()
const updatePlatformOwnedOrgSettings = vi.fn()
const aggregateStorageUsage = vi.fn()
const sumStorageBytes = vi.fn()
const recordAuditEvent = vi.fn()
const findOrganization = vi.fn()

vi.mock('@/lib/organizations/service', () => ({
  getOrgSettings: (...args: unknown[]) => getOrgSettings(...args),
  updatePlatformOwnedOrgSettings: (...args: unknown[]) => updatePlatformOwnedOrgSettings(...args),
}))

vi.mock('@/lib/organizations/repository', () => ({
  findOrganization: (...args: unknown[]) => findOrganization(...args),
}))

vi.mock('./repository', () => ({
  aggregateStorageUsage: (...args: unknown[]) => aggregateStorageUsage(...args),
  sumStorageBytes: (...args: unknown[]) => sumStorageBytes(...args),
}))

vi.mock('@/lib/audit/service', () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEvent(...args),
}))

const requirePlatformPermission = vi.fn()
vi.mock('@/lib/authz/platform', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/authz/platform')>()
  return { ...original, requirePlatformPermission: (s: unknown) => requirePlatformPermission(s) }
})

import { PlatformAccessDeniedError } from '@/lib/authz/platform'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import {
  assertWithinStorageQuota,
  getStorageOverview,
  getStorageQuotaBytes,
  setStorageQuota,
  STORAGE_QUOTA_SETTING,
} from './service'

const GB = 1e9

const platformSession = (): UserSession => ({
  userId: 'user-1',
  email: 'admin@example.com',
  name: 'Admin',
  accessToken: 'token',
  organizationId: 'org-1',
  organizationMembershipId: 'om-1',
  role: 'admin',
  permissions: ['org:settings:manage'],
  featureFlags: null,
  profilePictureUrl: null,
})

const settingsWith = (value: unknown): { settings: Record<string, unknown> } => ({
  settings: value === undefined ? {} : { [STORAGE_QUOTA_SETTING]: value },
})

const usedBytes = (bytes: number, documents = 1): void => {
  aggregateStorageUsage.mockResolvedValue({
    project: { bytes, documents },
    archiv: { bytes: 0, documents: 0 },
    total: { bytes, documents },
  })
}

describe('storage quota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.DEFAULT_STORAGE_QUOTA_BYTES
    getOrgSettings.mockResolvedValue(settingsWith(undefined))
    sumStorageBytes.mockResolvedValue(0)
    updatePlatformOwnedOrgSettings.mockResolvedValue(undefined)
    aggregateStorageUsage.mockResolvedValue({
      project: { bytes: 0, documents: 0 },
      archiv: { bytes: 0, documents: 0 },
      total: { bytes: 0, documents: 0 },
    })
    findOrganization.mockResolvedValue({ workosOrganizationId: 'org-1', settings: {} })
    requirePlatformPermission.mockResolvedValue(undefined)
  })

  describe('getStorageQuotaBytes', () => {
    it('is unlimited when nothing is configured', async () => {
      await expect(getStorageQuotaBytes('org-1')).resolves.toBeNull()
    })

    it('uses the platform default when the org has not set one', async () => {
      process.env.DEFAULT_STORAGE_QUOTA_BYTES = String(50 * GB)
      await expect(getStorageQuotaBytes('org-1')).resolves.toBe(50 * GB)
    })

    it('lets an org value win over the platform default', async () => {
      process.env.DEFAULT_STORAGE_QUOTA_BYTES = String(50 * GB)
      getOrgSettings.mockResolvedValue(settingsWith(10 * GB))
      await expect(getStorageQuotaBytes('org-1')).resolves.toBe(10 * GB)
    })

    it('treats an explicit null as deliberately unlimited, not as unset', async () => {
      process.env.DEFAULT_STORAGE_QUOTA_BYTES = String(50 * GB)
      getOrgSettings.mockResolvedValue(settingsWith(null))
      await expect(getStorageQuotaBytes('org-1')).resolves.toBeNull()
    })

    it('ignores a nonsense platform default rather than blocking every upload', async () => {
      process.env.DEFAULT_STORAGE_QUOTA_BYTES = 'not-a-number'
      await expect(getStorageQuotaBytes('org-1')).resolves.toBeNull()
    })
  })

  describe('getStorageOverview', () => {
    it('carries the effective per-file upload limit', async () => {
      const member: AuthorizedSession = {
        ...platformSession(),
        organizationId: 'org-member',
        organizationMembershipId: 'om-2',
        role: 'member',
      }
      getOrgSettings.mockResolvedValue({ settings: { maxUploadFileBytes: 40e6 } })
      const overview = await getStorageOverview(member)
      expect(overview.effectiveMaxUploadFileBytes).toBe(40e6)
    })
  })

  describe('assertWithinStorageQuota', () => {
    it('allows anything when unlimited, without querying usage', async () => {
      await expect(assertWithinStorageQuota('org-1', 5 * GB)).resolves.toBeUndefined()
      expect(sumStorageBytes).not.toHaveBeenCalled()
    })

    it('allows an upload that exactly fills the quota', async () => {
      getOrgSettings.mockResolvedValue(settingsWith(10 * GB))
      sumStorageBytes.mockResolvedValue(9 * GB)
      await expect(assertWithinStorageQuota('org-1', 1 * GB)).resolves.toBeUndefined()
    })

    it('refuses the upload that would cross the quota', async () => {
      getOrgSettings.mockResolvedValue(settingsWith(10 * GB))
      sumStorageBytes.mockResolvedValue(9 * GB)
      await expect(assertWithinStorageQuota('org-1', 1 * GB + 1)).rejects.toMatchObject({
        status: 507,
        code: 'STORAGE_QUOTA_EXCEEDED',
      })
    })

    it('refuses when already over, even for a zero-byte file', async () => {
      getOrgSettings.mockResolvedValue(settingsWith(10 * GB))
      sumStorageBytes.mockResolvedValue(11 * GB)
      await expect(assertWithinStorageQuota('org-1', 0)).rejects.toMatchObject({ status: 507 })
    })
  })

  describe('setStorageQuota', () => {
    it('refuses a quota below what is already stored', async () => {
      usedBytes(8 * GB)
      await expect(setStorageQuota(platformSession(), 'org-1', 5 * GB)).rejects.toMatchObject({ status: 422 })
      expect(updatePlatformOwnedOrgSettings).not.toHaveBeenCalled()
    })

    it('reads the organization\'s usage exactly once', async () => {
      usedBytes(1 * GB)
      await setStorageQuota(platformSession(), 'org-1', 10 * GB)
      expect(aggregateStorageUsage).toHaveBeenCalledTimes(1)
      expect(sumStorageBytes).not.toHaveBeenCalled()
    })

    it('refuses an organization Grid has never heard of', async () => {
      findOrganization.mockResolvedValue(null)
      await expect(setStorageQuota(platformSession(), 'org-typo', 10 * GB)).rejects.toMatchObject({
        status: 404,
      })
      expect(updatePlatformOwnedOrgSettings).not.toHaveBeenCalled()
      expect(recordAuditEvent).not.toHaveBeenCalled()
    })

    it('accepts an organization with documents but no settings row', async () => {
      findOrganization.mockResolvedValue(null)
      usedBytes(3 * GB, 12)
      await setStorageQuota(platformSession(), 'org-busy', 10 * GB)
      expect(updatePlatformOwnedOrgSettings).toHaveBeenCalledWith(
        platformSession(),
        'org-busy',
        expect.anything()
      )
    })

    it('refuses a non-positive quota', async () => {
      await expect(setStorageQuota(platformSession(), 'org-1', 0)).rejects.toMatchObject({ status: 422 })
    })

    it('stores a valid quota and audits it', async () => {
      usedBytes(1 * GB)
      await setStorageQuota(platformSession(), 'org-1', 10 * GB)

      expect(updatePlatformOwnedOrgSettings).toHaveBeenCalledWith(platformSession(), 'org-1', {
        settings: { [STORAGE_QUOTA_SETTING]: 10 * GB },
      })
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'org.storage_quota.updated',
          organizationId: 'org-1',
          metadata: { quotaBytes: 10 * GB },
        })
      )
    })

    it('clears the quota with null, and records it as unlimited', async () => {
      await setStorageQuota(platformSession(), 'org-1', null)

      expect(updatePlatformOwnedOrgSettings).toHaveBeenCalledWith(platformSession(), 'org-1', {
        settings: { [STORAGE_QUOTA_SETTING]: null },
      })
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { quotaBytes: 0 } })
      )
    })

    it('writes to the organization it was given, not the caller session', async () => {
      await setStorageQuota(platformSession(), 'org-other', 10 * GB)
      expect(updatePlatformOwnedOrgSettings).toHaveBeenCalledWith(
        platformSession(),
        'org-other',
        expect.anything()
      )
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-other' })
      )
    })

    it('refuses a caller who is not the platform owner', async () => {
      requirePlatformPermission.mockRejectedValue(new PlatformAccessDeniedError())
      await expect(setStorageQuota(platformSession(), 'org-1', 10 * GB)).rejects.toMatchObject({
        status: 403,
      })
      expect(updatePlatformOwnedOrgSettings).not.toHaveBeenCalled()
      expect(recordAuditEvent).not.toHaveBeenCalled()
    })

    it('refuses before it can be used to probe which organizations exist', async () => {
      requirePlatformPermission.mockRejectedValue(new PlatformAccessDeniedError())
      await expect(setStorageQuota(platformSession(), 'org-typo', 10 * GB)).rejects.toMatchObject({
        status: 403,
      })
      expect(findOrganization).not.toHaveBeenCalled()
      expect(aggregateStorageUsage).not.toHaveBeenCalled()
    })
  })
})
