import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sharing/access', () => ({ resolveResourceAccess: vi.fn() }))
vi.mock('@/lib/sharing/directory', () => ({ resolvePeople: vi.fn() }))
vi.mock('@/lib/sharing/registry', () => ({ describeResource: vi.fn() }))
vi.mock('@/lib/events/bus', () => ({ publishToUser: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/tasks/subject-access', () => ({ unreadableRunIds: vi.fn() }))
vi.mock('@/lib/authz/platform', () => ({
  hasPlatformPermission: vi.fn(),
  getPlatformOrganizationId: vi.fn(),
}))
const laneScopes: string[] = []
vi.mock('@/lib/db/tenant-context', () => ({
  withTenant: vi.fn(async (scope: { organizationId: string }, fn: () => unknown) => {
    laneScopes.push(scope.organizationId)
    return await fn()
  }),
}))

vi.mock('./repository', () => ({
  INBOX_LIST_LIMIT: 50,
  listInboxItems: vi.fn(),
  countInboxFilters: vi.fn(async () => ({ requests: 0, unread: 0 })),
  markAnchorItemsRead: vi.fn(),
  markInboxItemsUnread: vi.fn(),
  unarchiveInboxItem: vi.fn(),
  countPendingInboxItems: vi.fn(),
  markInboxItemsRead: vi.fn(),
  markAllInboxItemsRead: vi.fn(),
  archiveInboxItem: vi.fn(),
  markResourceItemsRead: vi.fn(),
  markItemsInertAnchoredOn: vi.fn(),
  markItemsInertForResource: vi.fn(),
  markItemsInertForSubjectRow: vi.fn(),
  resolveInboxItemsForTargets: vi.fn(),
  resolveOpenItemsAnchoredOn: vi.fn(),
  upsertInboxItems: vi.fn(),
}))
vi.mock('@/lib/projects/repository', () => ({ listProjectNamesInOrg: vi.fn(async () => new Map()) }))

import type { InboxItem, InboxItemType } from '@/lib/db/schema/inbox'
import { getPlatformOrganizationId, hasPlatformPermission } from '@/lib/authz/platform'
import { requireProjectAccess } from '@/lib/authz/projects'
import { resolveResourceAccess } from '@/lib/sharing/access'
import { resolvePeople } from '@/lib/sharing/directory'
import { describeResource } from '@/lib/sharing/registry'
import { unreadableRunIds } from '@/lib/tasks/subject-access'
import * as repository from './repository'
import { archiveItem, getInboxSummary, listInbox } from './service'
import { featureGrants, makeSession, reachable, row, session } from './service.fixtures'

beforeEach(() => {
  vi.stubEnv('REQUIRE_AUTH', 'true')
  featureGrants.collaboration = true
  laneScopes.length = 0
  vi.mocked(hasPlatformPermission).mockResolvedValue(false)
  vi.mocked(getPlatformOrganizationId).mockResolvedValue('org_platform')
  vi.mocked(repository.listInboxItems).mockResolvedValue([])
  vi.mocked(repository.countPendingInboxItems).mockResolvedValue(3)
  vi.mocked(resolveResourceAccess).mockResolvedValue(reachable)
  vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-viewer' } as never)
  vi.mocked(unreadableRunIds).mockResolvedValue(new Set())
  vi.mocked(resolvePeople).mockResolvedValue(
    new Map([['user_2', { userId: 'user_2', email: 'anna@example.test', name: 'Anna Berger', profilePictureUrl: null }]]),
  )
  vi.mocked(describeResource).mockReturnValue({
    deepLink: (resourceId: string, options?: { anchorId?: string; projectId?: string | null }) =>
      `/app/projects/${options?.projectId}/chat?session=${resourceId}` +
      (options?.anchorId ? `#message-${options.anchorId}` : ''),
  } as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the platform lane', () => {
  const feedbackRow = row({
    id: 'item_feedback',
    organizationId: 'org_platform',
    type: 'feedback.submitted',
    resourceType: 'product_feedback',
    resourceId: 'report_1',
    actorUserId: 'user_elsewhere',
    groupKey: 'feedback.submitted:product_feedback:report_1',
    payload: { subject: 'Büro Nord', excerpt: 'Upload hängt', actorName: 'Maria Huber' },
    updatedAt: new Date('2026-07-29T11:00:00.000Z'),
  })

  function listByOrganization(tenantRows: InboxItem[], platformRows: InboxItem[]) {
    vi.mocked(repository.listInboxItems).mockImplementation(async (organizationId) =>
      organizationId === 'org_platform' ? platformRows : tenantRows,
    )
  }

  it('stays shut for a reader without the platform permission', async () => {
    listByOrganization([row()], [feedbackRow])

    const { items } = await listInbox(session)

    expect(items.map((item) => item.id)).toEqual(['item_1'])
    expect(laneScopes).toEqual([])
    expect(vi.mocked(repository.listInboxItems).mock.calls.map((call) => call[0])).toEqual(['org_1'])
  })

  it('merges platform rows into the list, newest first, queried AS the platform organization', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    listByOrganization([row()], [feedbackRow])

    const { items } = await listInbox(session)

    expect(items.map((item) => item.id)).toEqual(['item_feedback', 'item_1'])
    expect(laneScopes.length).toBeGreaterThan(0)
    expect(new Set(laneScopes)).toEqual(new Set(['org_platform']))
    const platformCall = vi
      .mocked(repository.listInboxItems)
      .mock.calls.find((call) => call[0] === 'org_platform')!
    expect(platformCall[1]).toBe('user_1')
    expect(platformCall[2].types).toEqual(['feedback.submitted'])
  })

  it('links the report and names its author from the payload snapshot', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    listByOrganization([], [feedbackRow])

    const { items } = await listInbox(session)

    expect(items[0]!.href).toBe('/app/platform/feedback?report=report_1')
    expect(items[0]!.actorName).toBe('Maria Huber')
    expect(items[0]!.excerpt).toBe('Upload hängt')
  })

  it('never asks the tenant lane for a platform type, so no row is listed twice', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    const insidePlatform = makeSession({ organizationId: 'org_platform' })

    await listInbox(insidePlatform)

    const typeSets = vi.mocked(repository.listInboxItems).mock.calls.map((call) => call[2].types)
    expect(typeSets).toHaveLength(2)
    const [tenant, platform] = typeSets as InboxItemType[][]
    expect(tenant).not.toContain('feedback.submitted')
    expect(platform).toEqual(['feedback.submitted'])
  })

  it('counts both lanes in the badge', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    vi.mocked(repository.countPendingInboxItems).mockImplementation(async (organizationId) =>
      organizationId === 'org_platform' ? 2 : 3,
    )

    expect(await getInboxSummary(session)).toEqual({ pending: 5 })
  })

  it('archives a platform row through its own lane', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    vi.mocked(repository.archiveInboxItem).mockImplementation(
      async (organizationId) => organizationId === 'org_platform',
    )

    const result = await archiveItem(session, 'item_feedback')

    expect(result.affected).toBe(1)
  })

  it('stays shut when the platform organization is not provisioned', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    vi.mocked(getPlatformOrganizationId).mockResolvedValue(null)

    await getInboxSummary(session)

    expect(vi.mocked(repository.countPendingInboxItems).mock.calls.map((call) => call[0])).toEqual([
      'org_1',
    ])
  })
})
