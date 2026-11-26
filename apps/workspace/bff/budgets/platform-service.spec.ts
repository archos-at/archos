/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserSession } from '@/lib/auth/types'
import { getTenantContext, withTenant } from '@/lib/db/tenant-context'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { ConflictError, NotFoundError, UnprocessableError } from '@/lib/api/errors'

const requirePlatformPermission = vi.fn()
const hasPlatformPermission = vi.fn()
vi.mock('@/lib/authz/platform', () => ({
  requirePlatformPermission: (...args: unknown[]) => requirePlatformPermission(...args),
  hasPlatformPermission: (...args: unknown[]) => hasPlatformPermission(...args),
}))

const getOrganization = vi.fn()
vi.mock('@/lib/workos/client', () => ({
  getWorkOS: () => ({ organizations: { getOrganization } }),
}))

const getOrgBudget = vi.fn()
const getSpendTotals = vi.fn()
const setBudgetPolicy = vi.fn()
const getOrganizationUsageOverview = vi.fn()
vi.mock('./service', () => ({
  BudgetValidationError: class extends Error {},
  getOrganizationUsageOverview: (...args: unknown[]) => getOrganizationUsageOverview(...args),
  getOrgBudget: (...args: unknown[]) => getOrgBudget(...args),
  getSpendTotals: (...args: unknown[]) => getSpendTotals(...args),
  setBudgetPolicy: (...args: unknown[]) => setBudgetPolicy(...args),
}))

const recordAuditEvent = vi.fn()
vi.mock('@/lib/audit/service', () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEvent(...args),
}))

const listOrganizationMembers = vi.fn()
const getOrgSettings = vi.fn()
const updatePlatformOwnedOrgSettings = vi.fn()
vi.mock('@/lib/organizations/service', () => ({
  getOrganizationDisplayName: async () => 'Büro Nord',
  listOrganizationMembers: (...args: unknown[]) => listOrganizationMembers(...args),
  getOrgSettings: (...args: unknown[]) => getOrgSettings(...args),
  updatePlatformOwnedOrgSettings: (...args: unknown[]) => updatePlatformOwnedOrgSettings(...args),
}))

const invalidateIngestAllowanceCache = vi.fn()
vi.mock('./ingest-allowance', async () => {
  const { configuredIngestAllowances, effectiveIngestLimit } = await import('./ingest-limit')
  return {
    resolveIngestLimit: async (organizationId: string, unit: 'credit' | 'token', limits: { monthlyLimit: number | null }) =>
      effectiveIngestLimit(configuredIngestAllowances((await getOrgSettings(organizationId)).settings), unit, limits),
    invalidateIngestAllowanceCache: (...args: unknown[]) => invalidateIngestAllowanceCache(...args),
  }
})


import { getPlatformOrgBudget, getPlatformOrgUsage, savePlatformIngestAllowance, savePlatformOrgBudget } from './platform-service'

const session: UserSession = {
  userId: 'user_operator',
  email: 'operator@example.com',
  name: null,
  accessToken: '',
  organizationId: 'org_platform',
  organizationMembershipId: 'om_operator',
  role: 'org-platform-owner',
  permissions: [],
  featureFlags: null,
}
const request = new Request('http://localhost/api/platform/organizations/org_tenant/budgets', { method: 'PUT' })
const budget = { unit: 'credit', dailyLimit: 1000, monthlyLimit: 10000, explicit: false }
const input = { unit: 'credit' as const, dailyLimit: 500, monthlyLimit: 20000, note: 'Pilot allowance' }

describe('platform organization allowances', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    requirePlatformPermission.mockResolvedValue(undefined)
    hasPlatformPermission.mockResolvedValue(true)
    getOrganization.mockResolvedValue({ id: 'org_tenant' })
    getOrgBudget.mockResolvedValue(budget)
    getSpendTotals.mockResolvedValue({
      day: { credits: 25, tokens: 1000 },
      month: { credits: 300, tokens: 20000 },
    })
    setBudgetPolicy.mockResolvedValue({ id: 'policy_1', currency: 'credit' })
    recordAuditEvent.mockResolvedValue(undefined)
    getOrgSettings.mockResolvedValue({ settings: {} })
  })

  it('reads the target allowance, not the operator active organization', async () => {
    getOrgBudget.mockImplementation(async () => {
      expect(getTenantContext()).toMatchObject({ organizationId: 'org_tenant', userId: 'user_operator' })
      return budget
    })
    await withTenant({ organizationId: 'org_platform' }, async () => {
      expect(await getPlatformOrgBudget(session, 'org_tenant')).toEqual({
        organizationId: 'org_tenant',
        ...budget,
        dayUsed: 25,
        monthUsed: 300,
        ingest: {
          unit: 'credit',
          monthlyAllowance: 30000,
          defaultMonthlyAllowance: 30000,
          defaultFactor: 3,
          explicit: false,
          monthUsed: 0,
        },
        canManage: true,
      })
      expect(getTenantContext()).toMatchObject({ organizationId: 'org_platform' })
    })
    expect(getOrgBudget).toHaveBeenCalledWith('org_tenant')
    expect(getSpendTotals).toHaveBeenCalledWith('org_tenant')
    expect(requirePlatformPermission).toHaveBeenCalledWith(session, PLATFORM_PERMISSIONS.organizationsView)
  })

  it('preserves the existing token unit instead of interpreting it as credits', async () => {
    getOrgBudget.mockResolvedValue({ ...budget, unit: 'token', dailyLimit: null, monthlyLimit: null })
    expect(await getPlatformOrgBudget(session, 'org_tenant')).toMatchObject({
      unit: 'token', dayUsed: 1000, monthUsed: 20000,
    })
  })

  it('makes read-only support visible to the editor', async () => {
    hasPlatformPermission.mockResolvedValue(false)
    expect(await getPlatformOrgBudget(session, 'org_tenant')).toMatchObject({ canManage: false })
  })

  it('denies reads and writes before probing whether an organization exists', async () => {
    requirePlatformPermission.mockRejectedValue(new Error('Forbidden'))
    await expect(getPlatformOrgBudget(session, 'org_tenant')).rejects.toThrow('Forbidden')
    await expect(savePlatformOrgBudget(session, 'org_tenant', input, request)).rejects.toThrow('Forbidden')
    expect(getOrganization).not.toHaveBeenCalled()
    expect(setBudgetPolicy).not.toHaveBeenCalled()
  })

  it('refuses an unknown organization without writing orphan policies', async () => {
    getOrganization.mockRejectedValue(Object.assign(new Error('Missing'), { status: 404 }))
    await expect(savePlatformOrgBudget(session, 'org_missing', input, request)).rejects.toBeInstanceOf(NotFoundError)
    expect(setBudgetPolicy).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('does not hide upstream directory failures as missing organizations', async () => {
    getOrganization.mockRejectedValue(new Error('WorkOS unavailable'))
    await expect(getPlatformOrgBudget(session, 'org_tenant')).rejects.toThrow('WorkOS unavailable')
  })

  it('saves through the existing policy writer and audits the target organization', async () => {
    setBudgetPolicy.mockImplementation(async () => {
      expect(getTenantContext()).toMatchObject({ organizationId: 'org_tenant' })
      return { id: 'policy_1', currency: 'credit' }
    })
    await savePlatformOrgBudget(session, 'org_tenant', input, request)
    expect(requirePlatformPermission).toHaveBeenCalledWith(session, PLATFORM_PERMISSIONS.organizationsManage)
    expect(setBudgetPolicy).toHaveBeenCalledWith({
      organizationId: 'org_tenant',
      scope: 'organization',
      subjectId: null,
      dailyLimit: 500,
      monthlyLimit: 20000,
      expectedUnit: 'credit',
      actorUserId: 'user_operator',
      note: 'Pilot allowance',
    })
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org_tenant',
      action: 'budget.policy.set',
      targetId: 'policy_1',
      actor: { userId: 'user_operator', email: 'operator@example.com' },
      metadata: { scope: 'organization', subjectId: null, unit: 'credit', dailyLimit: 500, monthlyLimit: 20000 },
    }))
  })

  it('validates direct service callers before any policy write', async () => {
    await expect(savePlatformOrgBudget(session, 'org_tenant', { ...input, monthlyLimit: -1 }, request))
      .rejects.toBeInstanceOf(UnprocessableError)
    expect(setBudgetPolicy).not.toHaveBeenCalled()
  })

  it('does not report success or audit a failed policy write', async () => {
    setBudgetPolicy.mockRejectedValue(new Error('Database unavailable'))
    await expect(savePlatformOrgBudget(session, 'org_tenant', input, request)).rejects.toThrow('Database unavailable')
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })
})

describe('the ingest allowance an operator sets per office', () => {
  const ingestRequest = new Request('http://localhost/api/platform/organizations/org_tenant/ingest-allowance', { method: 'PUT' })

  beforeEach(() => {
    vi.resetAllMocks()
    requirePlatformPermission.mockResolvedValue(undefined)
    hasPlatformPermission.mockResolvedValue(true)
    getOrganization.mockResolvedValue({ id: 'org_tenant' })
    getOrgBudget.mockResolvedValue(budget)
    getSpendTotals.mockResolvedValue({
      day: { credits: 25, tokens: 1000 },
      month: { credits: 3300, tokens: 20000, ingestCredits: 3000, ingestTokens: 0 },
    })
    getOrgSettings.mockResolvedValue({ settings: {} })
    updatePlatformOwnedOrgSettings.mockImplementation(async (_s: unknown, _o: string, patch: { settings: Record<string, unknown> }) => {
      getOrgSettings.mockResolvedValue({ settings: patch.settings })
    })
  })

  it('reads the set amount of the office’s unit, and the default it replaces', async () => {
    getOrgSettings.mockResolvedValue({ settings: { ingestMonthlyAllowance: { credit: 50000, token: 9 } } })
    expect((await getPlatformOrgBudget(session, 'org_tenant')).ingest).toEqual({
      unit: 'credit',
      monthlyAllowance: 50000,
      defaultMonthlyAllowance: 30000,
      defaultFactor: 3,
      explicit: true,
      monthUsed: 3000,
    })
  })

  it('stores the amount under the office’s unit, keeps the other unit’s, and audits it', async () => {
    getOrgSettings.mockResolvedValue({ settings: { ingestMonthlyAllowance: { token: 9 } } })
    const result = await savePlatformIngestAllowance(session, 'org_tenant', { unit: 'credit', monthlyAllowance: 50000 }, ingestRequest)

    expect(requirePlatformPermission).toHaveBeenCalledWith(session, PLATFORM_PERMISSIONS.organizationsManage)
    expect(updatePlatformOwnedOrgSettings).toHaveBeenCalledWith(session, 'org_tenant', {
      settings: { ingestMonthlyAllowance: { token: 9, credit: 50000 } },
    })
    expect(invalidateIngestAllowanceCache).toHaveBeenCalledWith('org_tenant')
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org_tenant',
      action: 'org.ingest_allowance.updated',
      targetType: 'organization',
      targetId: 'org_tenant',
      metadata: { unit: 'credit', monthlyAllowance: 50000, explicit: true },
    }))
    expect(result).toMatchObject({ monthlyAllowance: 50000, explicit: true, monthUsed: 3000 })
  })

  it('goes back to the default with null', async () => {
    getOrgSettings.mockResolvedValue({ settings: { ingestMonthlyAllowance: { credit: 50000 } } })
    const result = await savePlatformIngestAllowance(session, 'org_tenant', { unit: 'credit', monthlyAllowance: null }, ingestRequest)

    expect(updatePlatformOwnedOrgSettings).toHaveBeenCalledWith(session, 'org_tenant', { settings: { ingestMonthlyAllowance: {} } })
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { unit: 'credit', monthlyAllowance: 0, explicit: false },
    }))
    expect(result).toMatchObject({ monthlyAllowance: 30000, explicit: false })
  })

  it('refuses an amount meant for another unit than the office’s, and writes nothing', async () => {
    getOrgBudget.mockResolvedValue({ ...budget, unit: 'token', monthlyLimit: null })
    await expect(savePlatformIngestAllowance(session, 'org_tenant', { unit: 'credit', monthlyAllowance: 50000 }, ingestRequest))
      .rejects.toBeInstanceOf(ConflictError)
    expect(updatePlatformOwnedOrgSettings).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('denies before probing the organization, and validates direct callers', async () => {
    requirePlatformPermission.mockRejectedValueOnce(new Error('Forbidden'))
    await expect(savePlatformIngestAllowance(session, 'org_tenant', { unit: 'credit', monthlyAllowance: 1 }, ingestRequest))
      .rejects.toThrow('Forbidden')
    expect(getOrganization).not.toHaveBeenCalled()
    await expect(savePlatformIngestAllowance(session, 'org_tenant', { unit: 'credit', monthlyAllowance: -1 }, ingestRequest))
      .rejects.toBeInstanceOf(UnprocessableError)
    expect(updatePlatformOwnedOrgSettings).not.toHaveBeenCalled()
  })
})

describe('platform organization usage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    requirePlatformPermission.mockResolvedValue(undefined)
    getOrganization.mockResolvedValue({ id: 'org_tenant' })
    listOrganizationMembers.mockResolvedValue([
      { id: 'user_a', email: 'a@buero.test', name: 'A' },
      { id: 'user_idle', email: 'idle@buero.test', name: null },
    ])
  })

  it('reads the office’s own usage view inside its tenant scope, under the usage-view permission', async () => {
    getOrganizationUsageOverview.mockImplementation(async () => {
      expect(getTenantContext()).toMatchObject({ organizationId: 'org_tenant', userId: 'user_operator' })
      return { unit: 'credit', perMember: [{ userId: 'user_a' }] }
    })

    const result = await getPlatformOrgUsage(session, 'org_tenant')

    expect(requirePlatformPermission).toHaveBeenCalledWith(session, PLATFORM_PERMISSIONS.usageView)
    expect(getOrganizationUsageOverview).toHaveBeenCalledWith('org_tenant')
    expect(result.organization).toEqual({ id: 'org_tenant', name: 'Büro Nord' })
    expect(result.members).toEqual([{ id: 'user_a', email: 'a@buero.test', name: 'A' }])
  })

  it('still shows the spend when the directory cannot be listed', async () => {
    getOrganizationUsageOverview.mockResolvedValue({ unit: 'credit', perMember: [{ userId: 'user_a' }] })
    listOrganizationMembers.mockRejectedValue(new Error('WorkOS down'))

    expect((await getPlatformOrgUsage(session, 'org_tenant')).members).toEqual([])
  })

  it('answers 404 for an organization WorkOS does not know', async () => {
    getOrganization.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }))
    await expect(getPlatformOrgUsage(session, 'org_missing')).rejects.toBeInstanceOf(NotFoundError)
  })
})
