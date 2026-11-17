/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/inbox/service', () => ({ emitInboxItems: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/inbox/repository', () => ({
  archiveInboxItemsOfType: vi.fn().mockResolvedValue(0),
  findLiveInboxGroupKeys: vi.fn().mockResolvedValue(new Set<string>()),
}))
vi.mock('@/lib/organizations/service', () => ({ listOrganizationMembersWithRoles: vi.fn() }))
vi.mock('./repository', () => ({ aggregateStorageUsageByOrganization: vi.fn() }))
vi.mock('./service', () => ({ getStorageQuotaBytes: vi.fn() }))
vi.mock('@/lib/authz/org-role-permissions', () => ({
  rolesHoldPermission: vi.fn(async (_org: string, roles: readonly string[]) => roles.includes('admin')),
}))

import { emitInboxItems } from '@/lib/inbox/service'
import { archiveInboxItemsOfType, findLiveInboxGroupKeys } from '@/lib/inbox/repository'
import { listOrganizationMembersWithRoles } from '@/lib/organizations/service'
import { getTenantContext } from '@/lib/db/tenant-context'
import type { OrganizationMemberWithRole } from '@/lib/organizations/service'
import { aggregateStorageUsageByOrganization } from './repository'
import { getStorageQuotaBytes } from './service'
import {
  STORAGE_ALERT_TYPE,
  crossedBucketPercent,
  evaluateStorageAlert,
  findStorageAlertRecipients,
  runStorageAlertSweep,
  storageAlertThresholdPercent,
} from './alerts'

const QUOTA = 100_000_000_000
const gb = (count: number): number => count * 1_000_000_000

function member(overrides: Partial<OrganizationMemberWithRole> = {}): OrganizationMemberWithRole {
  return {
    id: 'user_admin',
    email: 'admin@tenant.test',
    name: 'Ada Admin',
    roleSlug: 'admin',
    status: 'active',
    ...overrides,
  }
}

const groupKeyFor = (organizationId: string, bucket: number): string =>
  `${STORAGE_ALERT_TYPE}:organization:${organizationId}:${bucket}`

const liveKey = (recipientUserId: string, organizationId: string, bucket: number): string =>
  `${recipientUserId}\n${groupKeyFor(organizationId, bucket)}`

beforeEach(() => {
  vi.mocked(listOrganizationMembersWithRoles).mockResolvedValue([member()])
  vi.mocked(getStorageQuotaBytes).mockResolvedValue(QUOTA)
  vi.mocked(findLiveInboxGroupKeys).mockResolvedValue(new Set<string>())
  vi.mocked(archiveInboxItemsOfType).mockResolvedValue(0)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('crossedBucketPercent — the decision, with no database near it', () => {
  it('is null below the threshold and at the threshold it is the threshold', () => {
    expect(crossedBucketPercent(gb(79), QUOTA, 80)).toBeNull()
    expect(crossedBucketPercent(gb(80), QUOTA, 80)).toBe(80)
    expect(crossedBucketPercent(gb(85), QUOTA, 80)).toBe(80)
  })

  it('escalates, and full always gets its own bucket', () => {
    expect(crossedBucketPercent(gb(90), QUOTA, 80)).toBe(90)
    expect(crossedBucketPercent(gb(100), QUOTA, 80)).toBe(100)
    expect(crossedBucketPercent(gb(140), QUOTA, 80)).toBe(100)
  })

  it('is null for an unlimited org — there is no "full" to warn about', () => {
    expect(crossedBucketPercent(gb(999), null, 80)).toBeNull()
    expect(crossedBucketPercent(gb(999), 0, 80)).toBeNull()
  })

  it('drops ladder steps at or below a raised threshold', () => {
    expect(crossedBucketPercent(gb(92), QUOTA, 95)).toBeNull()
    expect(crossedBucketPercent(gb(96), QUOTA, 95)).toBe(95)
  })
})

describe('storageAlertThresholdPercent — configurable, default 80', () => {
  it('defaults to 80 when unset', () => {
    expect(storageAlertThresholdPercent(undefined)).toBe(80)
  })

  it('takes a configured value', () => {
    expect(storageAlertThresholdPercent('60')).toBe(60)
  })

  it('falls back to the default for nonsense rather than disabling the alert', () => {
    for (const bad of ['', 'eighty', '0', '-5', '150', 'NaN']) {
      expect(storageAlertThresholdPercent(bad), bad).toBe(80)
    }
  })
})

describe('fires once per crossing, not once per sweep', () => {
  it('emits on the first crossing', async () => {
    const outcome = await evaluateStorageAlert('org_1', gb(82), { thresholdPercent: 80 })

    expect(outcome.status).toBe('alerted')
    expect(outcome.notified).toBe(1)
    expect(emitInboxItems).toHaveBeenCalledTimes(1)
  })

  it('does NOT re-emit while the alert is still live', async () => {
    vi.mocked(findLiveInboxGroupKeys).mockResolvedValue(
      new Set([liveKey('user_admin', 'org_1', 80)]),
    )

    const outcome = await evaluateStorageAlert('org_1', gb(83), { thresholdPercent: 80 })

    expect(outcome.status).toBe('suppressed')
    expect(outcome.notified).toBe(0)
    expect(emitInboxItems).not.toHaveBeenCalled()
  })

  it('asks about the exact (recipient, group key) pair, so suppression cannot be global', async () => {
    await evaluateStorageAlert('org_1', gb(82), { thresholdPercent: 80 })

    expect(findLiveInboxGroupKeys).toHaveBeenCalledWith('org_1', [
      { recipientUserId: 'user_admin', groupKey: groupKeyFor('org_1', 80) },
    ])
  })

  it('suppresses per recipient: an admin who dismissed it is skipped, a new admin is told', async () => {
    vi.mocked(listOrganizationMembersWithRoles).mockResolvedValue([
      member({ id: 'user_old' }),
      member({ id: 'user_new', email: 'new@tenant.test' }),
    ])
    vi.mocked(findLiveInboxGroupKeys).mockResolvedValue(new Set([liveKey('user_old', 'org_1', 80)]))

    const outcome = await evaluateStorageAlert('org_1', gb(82), { thresholdPercent: 80 })

    expect(outcome.notified).toBe(1)
    const [emissions] = vi.mocked(emitInboxItems).mock.calls[0]!
    expect(emissions.map((emission) => emission.recipientUserId)).toEqual(['user_new'])
  })

  it('escalation is a NEW crossing: a higher bucket alerts even while the lower one is live', async () => {
    vi.mocked(findLiveInboxGroupKeys).mockResolvedValue(new Set([liveKey('user_admin', 'org_1', 80)]))

    const outcome = await evaluateStorageAlert('org_1', gb(91), { thresholdPercent: 80 })

    expect(outcome.status).toBe('alerted')
    expect(outcome.bucketPercent).toBe(90)
    expect(archiveInboxItemsOfType).toHaveBeenCalledWith('org_1', STORAGE_ALERT_TYPE, {
      exceptAnchorId: '90',
    })
  })
})

describe('recovering and re-crossing alerts again', () => {
  it('retires the outstanding alert when usage falls back below the threshold', async () => {
    vi.mocked(archiveInboxItemsOfType).mockResolvedValue(2)

    const outcome = await evaluateStorageAlert('org_1', gb(40), { thresholdPercent: 80 })

    expect(outcome.status).toBe('below-threshold')
    expect(outcome.retired).toBe(2)
    expect(archiveInboxItemsOfType).toHaveBeenCalledWith('org_1', STORAGE_ALERT_TYPE)
    expect(emitInboxItems).not.toHaveBeenCalled()
  })

  it('alerts again after a recovery, because the retired row is no longer live', async () => {
    await evaluateStorageAlert('org_1', gb(82), { thresholdPercent: 80 })
    expect(emitInboxItems).toHaveBeenCalledTimes(1)

    vi.mocked(archiveInboxItemsOfType).mockResolvedValue(1)
    await evaluateStorageAlert('org_1', gb(50), { thresholdPercent: 80 })
    expect(emitInboxItems).toHaveBeenCalledTimes(1)

    vi.mocked(findLiveInboxGroupKeys).mockResolvedValue(new Set<string>())
    const outcome = await evaluateStorageAlert('org_1', gb(84), { thresholdPercent: 80 })

    expect(outcome.status).toBe('alerted')
    expect(outcome.notified).toBe(1)
    expect(emitInboxItems).toHaveBeenCalledTimes(2)
  })

  it('an unlimited org retires any alert it was carrying and reports unlimited', async () => {
    vi.mocked(getStorageQuotaBytes).mockResolvedValue(null)
    vi.mocked(archiveInboxItemsOfType).mockResolvedValue(1)

    const outcome = await evaluateStorageAlert('org_1', gb(9999))

    expect(outcome.status).toBe('unlimited')
    expect(outcome.usedPercent).toBeNull()
    expect(outcome.retired).toBe(1)
    expect(emitInboxItems).not.toHaveBeenCalled()
  })
})

describe('recipient resolution', () => {
  it('notifies holders of org:settings:manage, via the role catalog', async () => {
    vi.mocked(listOrganizationMembersWithRoles).mockResolvedValue([
      member({ id: 'user_admin', roleSlug: 'admin' }),
      member({ id: 'user_auditor', roleSlug: 'org-auditor' }),
      member({ id: 'user_member', roleSlug: 'member' }),
    ])

    expect(await findStorageAlertRecipients('org_1')).toEqual(['user_admin'])
  })

  it('ignores inactive memberships', async () => {
    vi.mocked(listOrganizationMembersWithRoles).mockResolvedValue([
      member({ id: 'user_pending', status: 'pending' }),
      member({ id: 'user_inactive', status: 'inactive' }),
    ])

    expect(await findStorageAlertRecipients('org_1')).toEqual([])
  })

  it('does not assume an unknown role holds the permission', async () => {
    vi.mocked(listOrganizationMembersWithRoles).mockResolvedValue([
      member({ id: 'user_custom', roleSlug: 'some-deployment-specific-role' }),
      member({ id: 'user_roleless', roleSlug: null }),
    ])

    expect(await findStorageAlertRecipients('org_1')).toEqual([])
  })

  it('logs and does not throw when nobody can act on it', async () => {
    vi.mocked(listOrganizationMembersWithRoles).mockResolvedValue([member({ roleSlug: 'member' })])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const outcome = await evaluateStorageAlert('org_1', gb(82), { thresholdPercent: 80 })

    expect(outcome.status).toBe('no-recipients')
    expect(outcome.notified).toBe(0)
    expect(emitInboxItems).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no active member holding'))
    warn.mockRestore()
  })

  it('carries the payload the row renders, with no invented actor', async () => {
    await evaluateStorageAlert('org_1', gb(82), { thresholdPercent: 80 })

    const [emissions] = vi.mocked(emitInboxItems).mock.calls[0]!
    expect(emissions).toHaveLength(1)
    expect(emissions[0]).toMatchObject({
      organizationId: 'org_1',
      recipientUserId: 'user_admin',
      type: STORAGE_ALERT_TYPE,
      resourceType: 'organization',
      resourceId: 'org_1',
      anchorId: '80',
      actorUserId: null,
      groupKey: groupKeyFor('org_1', 80),
    })
    expect(emissions[0]!.payload).toMatchObject({ subject: '82%', usedPercent: 82 })
  })
})

describe('runStorageAlertSweep', () => {
  beforeEach(() => {
    vi.mocked(aggregateStorageUsageByOrganization).mockResolvedValue(
      new Map([
        ['org_low', { bytes: gb(10), documents: 3 }],
        ['org_high', { bytes: gb(85), documents: 40 }],
      ]),
    )
  })

  it('visits every organization with stored bytes and totals the outcome', async () => {
    const result = await runStorageAlertSweep()

    expect(result).toMatchObject({ organizationsChecked: 2, alerted: 1, notified: 1 })
    expect(result.thresholdPercent).toBe(80)
  })

  it('does the per-org work inside that org\'s TENANT scope, not the cross-tenant bypass', async () => {
    const scopes: (string | undefined)[] = []
    vi.mocked(listOrganizationMembersWithRoles).mockImplementation(async () => {
      const context = getTenantContext()
      scopes.push(context?.kind === 'tenant' ? context.organizationId : context?.kind)
      return [member()]
    })

    await runStorageAlertSweep()

    expect(scopes).toEqual(['org_high'])
  })

  it('one tenant\'s failure does not cost the others their alert', async () => {
    vi.mocked(aggregateStorageUsageByOrganization).mockResolvedValue(
      new Map([
        ['org_broken', { bytes: gb(90), documents: 1 }],
        ['org_ok', { bytes: gb(85), documents: 1 }],
      ]),
    )
    vi.mocked(listOrganizationMembersWithRoles).mockImplementation(async (organizationId) => {
      if (organizationId === 'org_broken') throw new Error('WorkOS timed out')
      return [member()]
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await runStorageAlertSweep()

    expect(result.organizationsChecked).toBe(2)
    expect(result.alerted).toBe(1)
    expect(result.notified).toBe(1)
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('org_broken'),
      expect.any(Error),
    )
    error.mockRestore()
  })

  it('honours the configured threshold for the whole sweep', async () => {
    vi.stubEnv('STORAGE_ALERT_THRESHOLD_PERCENT', '50')
    vi.mocked(aggregateStorageUsageByOrganization).mockResolvedValue(
      new Map([['org_mid', { bytes: gb(60), documents: 5 }]]),
    )

    const result = await runStorageAlertSweep()

    expect(result.thresholdPercent).toBe(50)
    expect(result.alerted).toBe(1)
  })
})
