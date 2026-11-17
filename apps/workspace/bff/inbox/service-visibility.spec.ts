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

import { NotFoundError } from '@/lib/api/errors'
import { getPlatformOrganizationId, hasPlatformPermission } from '@/lib/authz/platform'
import { requireProjectAccess } from '@/lib/authz/projects'
import { resolveResourceAccess } from '@/lib/sharing/access'
import { resolvePeople } from '@/lib/sharing/directory'
import { describeResource } from '@/lib/sharing/registry'
import { unreadableRunIds } from '@/lib/tasks/subject-access'
import * as repository from './repository'
import { getInboxSummary, listInbox, markAllRead, viewInboxItemAs } from './service'
import { ALL_TYPES, OPERATIONAL_TYPES, at, featureGrants, makeSession, reachable, row, session } from './service.fixtures'

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

describe('visibleInboxTypes gate — the inbox is not collaboration-only', () => {
  it('a tenant WITHOUT collaboration still sees operational items', async () => {
    featureGrants.collaboration = false

    await listInbox(makeSession())

    expect(repository.listInboxItems).toHaveBeenCalledWith('org_1', 'user_1', {
      filter: 'all',
      cursor: null,
      limit: 51,
      types: [...OPERATIONAL_TYPES],
    })
  })

  it('a tenant WITHOUT collaboration gets a badge counted over the same set', async () => {
    featureGrants.collaboration = false

    await getInboxSummary(makeSession())

    expect(repository.countPendingInboxItems).toHaveBeenCalledWith('org_1', 'user_1', [
      ...OPERATIONAL_TYPES,
    ])
  })

  it('a tenant WITH collaboration sees every registered type', async () => {
    await listInbox(makeSession())

    expect(repository.listInboxItems).toHaveBeenCalledWith('org_1', 'user_1', {
      filter: 'all',
      cursor: null,
      limit: 51,
      types: [...ALL_TYPES],
    })
  })

  it('"clear all" without collaboration cannot settle collaboration rows', async () => {
    featureGrants.collaboration = false
    vi.mocked(repository.markAllInboxItemsRead).mockResolvedValue(1)

    await markAllRead(makeSession())

    const [, , types] = vi.mocked(repository.markAllInboxItemsRead).mock.calls[0]!
    expect(types).toEqual([...OPERATIONAL_TYPES])
    expect(types).not.toContain('mention.requested')
  })
})

describe('viewInboxItemAs — the row as its recipient would be shown it', () => {
  it('words a reachable item with its address', async () => {
    const view = await viewInboxItemAs(session, row({ type: 'mention.requested', groupKey: 'g', anchorId: 'm1' }))
    expect(view?.href).toBe('/app/projects/proj_1/chat?session=conv_1#message-m1')
    expect(view?.actorName).toBe('Anna Berger')
  })

  it('answers null when the target is no longer reachable', async () => {
    vi.mocked(resolveResourceAccess).mockRejectedValue(new NotFoundError())
    expect(await viewInboxItemAs(session, row())).toBeNull()
  })

  it('answers null for an inert item', async () => {
    expect(await viewInboxItemAs(session, row({ inertAt: at }))).toBeNull()
  })

  it('answers null for a type the recipient’s organization may not see', async () => {
    featureGrants.collaboration = false
    expect(await viewInboxItemAs(session, row({ type: 'mention.requested' }))).toBeNull()
  })

  it('answers null for a run the recipient may not read', async () => {
    vi.mocked(unreadableRunIds).mockResolvedValue(new Set(['run_1']))
    const project = row({
      type: 'task_run.completed',
      resourceType: 'project',
      resourceId: 'proj_1',
      payload: { runId: 'run_1', subject: 'Auftrag' },
    })
    expect(await viewInboxItemAs(session, project)).toBeNull()
  })

  it('answers null for a platform item unless the recipient holds the platform permission', async () => {
    const feedback = row({
      organizationId: 'org_platform',
      type: 'feedback.submitted',
      resourceType: 'product_feedback',
      resourceId: 'f1',
    })
    const platformSession = makeSession({ organizationId: 'org_platform' })
    expect(await viewInboxItemAs(platformSession, feedback)).toBeNull()
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    expect((await viewInboxItemAs(platformSession, feedback))?.href).toBe('/app/platform/feedback?report=f1')
  })
})
