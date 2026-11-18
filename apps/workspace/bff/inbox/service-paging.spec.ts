import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sharing/access', () => ({ resolveResourceAccess: vi.fn() }))
vi.mock('@/lib/sharing/directory', () => ({ resolvePeople: vi.fn() }))
vi.mock('@/lib/sharing/registry', () => ({ describeResource: vi.fn() }))
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

import { BadRequestError } from '@/lib/api/errors'
import { getPlatformOrganizationId, hasPlatformPermission } from '@/lib/authz/platform'
import { requireProjectAccess } from '@/lib/authz/projects'
import { resolveResourceAccess } from '@/lib/sharing/access'
import { resolvePeople } from '@/lib/sharing/directory'
import { describeResource } from '@/lib/sharing/registry'
import { unreadableRunIds } from '@/lib/tasks/subject-access'
import * as repository from './repository'
import { decodeInboxCursor, encodeInboxCursor, listInbox } from './service'
import { at, featureGrants, reachable, row, session } from './service.fixtures'

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

describe('listInbox — one page at a time', () => {
  const stamp = (minute: number) => new Date(`2026-10-01T10:${String(minute).padStart(2, '0')}:00.000Z`)
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

  it('says there is more when a lane returned past the page, and where the next page starts, to the microsecond', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue(
      Array.from({ length: 51 }, (_, n) => ({
        ...row({ id: id(n), updatedAt: stamp(59 - n) }),
        listedAtMicros: String(BigInt(stamp(59 - n).getTime()) * BigInt(1000) + BigInt(7)),
      })),
    )

    const page = await listInbox(session, { filter: 'requests' })

    expect(page.items).toHaveLength(50)
    expect(page.hasMore).toBe(true)
    expect(decodeInboxCursor(page.nextCursor as string)).toEqual({
      micros: String(BigInt(stamp(10).getTime()) * BigInt(1000) + BigInt(7)),
      id: id(49),
    })
    expect(repository.listInboxItems).toHaveBeenCalledWith('org_1', 'user_1', expect.objectContaining({ filter: 'requests', limit: 51 }))
  })

  it('merges lanes by the stored microsecond, not the millisecond a Date keeps', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    const sameMillisecond = stamp(30)
    vi.mocked(repository.listInboxItems).mockImplementation(async (organizationId) =>
      organizationId !== 'org_platform'
        ? [{ ...row({ id: id(1), updatedAt: sameMillisecond }), listedAtMicros: String(BigInt(sameMillisecond.getTime()) * BigInt(1000) + BigInt(100)) }]
        : [{ ...row({ id: id(2), type: 'feedback.submitted', updatedAt: sameMillisecond }), listedAtMicros: String(BigInt(sameMillisecond.getTime()) * BigInt(1000) + BigInt(900)) }],
    )

    const { items } = await listInbox(session)

    expect(items.map((item) => item.id)).toEqual([id(2), id(1)])
  })

  it('says there is no more on the last page, and reads after the cursor it is given', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([row()])
    const cursor = encodeInboxCursor({ micros: '1790848800123456', id: id(7) })

    const page = await listInbox(session, { cursor })

    expect(page).toMatchObject({ hasMore: false, nextCursor: null })
    expect(repository.listInboxItems).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      expect.objectContaining({ cursor: { micros: '1790848800123456', id: id(7) } }),
    )
  })

  it('refuses a cursor it did not write', async () => {
    expect(() => decodeInboxCursor('not-a-cursor')).toThrow(BadRequestError)
    expect(() => decodeInboxCursor(Buffer.from('2026-10-01T10:00:00.000Z|' + id(1)).toString('base64url'))).toThrow(BadRequestError)
    expect(() => decodeInboxCursor(Buffer.from('123|x').toString('base64url'))).toThrow(BadRequestError)
  })

  it('carries the numbers beside the filters, and whether each row is archived', async () => {
    vi.mocked(repository.countInboxFilters).mockResolvedValue({ requests: 2, unread: 5 })
    vi.mocked(repository.listInboxItems).mockResolvedValue([row({ id: 'a', archivedAt: at, inertAt: at })])
    const page = await listInbox(session, { filter: 'archived' })
    expect(page.counts).toEqual({ requests: 2, unread: 5 })
    expect(page.items[0]).toMatchObject({ state: 'inert', archived: true })
  })
})
