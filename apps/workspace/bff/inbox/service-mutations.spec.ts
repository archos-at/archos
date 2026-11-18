import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/events/bus', () => ({ publishToUser: vi.fn().mockResolvedValue(undefined) }))
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

import { NotFoundError } from '@/lib/api/errors'
import { publishToUser } from '@/lib/events/bus'
import { getPlatformOrganizationId, hasPlatformPermission } from '@/lib/authz/platform'
import * as repository from './repository'
import {
  archiveItem,
  markAllRead,
  markAnchorItemsReadFor,
  markMarksSetReadFor,
  markRead,
  markResourceItemsReadFor,
  markUnread,
  unarchiveItem,
} from './service'
import { ALL_TYPES, featureGrants, session } from './service.fixtures'

beforeEach(() => {
  vi.stubEnv('REQUIRE_AUTH', 'true')
  featureGrants.collaboration = true
  laneScopes.length = 0
  vi.mocked(hasPlatformPermission).mockResolvedValue(false)
  vi.mocked(getPlatformOrganizationId).mockResolvedValue('org_platform')
  vi.mocked(repository.countPendingInboxItems).mockResolvedValue(3)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('mutations are scoped to the caller\'s own inbox', () => {
  it('marks read with the caller\'s user + organization, so foreign ids match nothing', async () => {
    vi.mocked(repository.markInboxItemsRead).mockResolvedValue(0)

    const result = await markRead(session, ['item_of_another_user'])

    expect(repository.markInboxItemsRead).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      ['item_of_another_user'],
      [...ALL_TYPES],
    )
    expect(result).toEqual({ affected: 0, pending: 3 })
  })

  it('publishes the recomputed badge count after marking read', async () => {
    vi.mocked(repository.markInboxItemsRead).mockResolvedValue(2)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(1)

    const result = await markRead(session, ['item_1', 'item_2'])

    expect(result).toEqual({ affected: 2, pending: 1 })
    expect(publishToUser).toHaveBeenCalledWith('user_1', { kind: 'inbox.changed', pending: 1 })
  })

  it('marks everything read for the caller only', async () => {
    vi.mocked(repository.markAllInboxItemsRead).mockResolvedValue(5)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(0)

    expect(await markAllRead(session)).toEqual({ affected: 5, pending: 0 })
    expect(repository.markAllInboxItemsRead).toHaveBeenCalledWith('org_1', 'user_1', [
      ...ALL_TYPES,
    ])
    expect(publishToUser).toHaveBeenCalledWith('user_1', { kind: 'inbox.changed', pending: 0 })
  })

  it('answers 404 for archiving an item that is not the caller\'s', async () => {
    vi.mocked(repository.archiveInboxItem).mockResolvedValue(false)

    await expect(archiveItem(session, 'item_of_another_user')).rejects.toBeInstanceOf(NotFoundError)

    expect(repository.archiveInboxItem).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      'item_of_another_user',
      [...ALL_TYPES],
    )
    expect(publishToUser).not.toHaveBeenCalled()
  })

  it('narrows both mutations to the types the caller may see', async () => {
    featureGrants.collaboration = false
    vi.mocked(repository.markInboxItemsRead).mockResolvedValue(0)
    vi.mocked(repository.archiveInboxItem).mockResolvedValue(false)

    await markRead(session, ['collab_item'])
    const readScope = vi.mocked(repository.markInboxItemsRead).mock.calls[0]![3]
    expect(readScope).not.toContain('mention.requested')
    expect(readScope).toContain('storage.quota_warning')

    await expect(archiveItem(session, 'collab_item')).rejects.toBeInstanceOf(NotFoundError)
    const archiveScope = vi.mocked(repository.archiveInboxItem).mock.calls[0]![3]
    expect(archiveScope).toEqual(readScope)
  })

  it('archives the caller\'s own item and refreshes the badge', async () => {
    vi.mocked(repository.archiveInboxItem).mockResolvedValue(true)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(2)

    expect(await archiveItem(session, 'item_1')).toEqual({ affected: 1, pending: 2 })
    expect(publishToUser).toHaveBeenCalledWith('user_1', { kind: 'inbox.changed', pending: 2 })
  })

  it('clears a resource\'s items for the caller when they open it (IB-9)', async () => {
    vi.mocked(repository.markResourceItemsRead).mockResolvedValue(4)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(1)

    const result = await markResourceItemsReadFor(session, 'conversation', 'conv_1')

    expect(repository.markResourceItemsRead).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      'conversation',
      'conv_1',
    )
    expect(result).toEqual({ affected: 4, pending: 1 })
  })
})

describe('the reader’s own read state and archive', () => {
  it('marks items unread for the caller only, in the types they may see, and refreshes the badge', async () => {
    vi.mocked(repository.markInboxItemsUnread).mockResolvedValue(1)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(4)

    expect(await markUnread(session, ['item_1'])).toEqual({ affected: 1, pending: 4 })
    expect(repository.markInboxItemsUnread).toHaveBeenCalledWith('org_1', 'user_1', ['item_1'], [...ALL_TYPES])
    expect(publishToUser).toHaveBeenCalledWith('user_1', { kind: 'inbox.changed', pending: 4 })
  })

  it('restores an archived item, and answers 404 for one that is not the caller’s', async () => {
    vi.mocked(repository.unarchiveInboxItem).mockResolvedValueOnce(true)
    expect(await unarchiveItem(session, 'item_1')).toEqual({ affected: 1, pending: 3 })
    expect(repository.unarchiveInboxItem).toHaveBeenCalledWith('org_1', 'user_1', 'item_1', [...ALL_TYPES])

    vi.mocked(repository.unarchiveInboxItem).mockResolvedValueOnce(false)
    await expect(unarchiveItem(session, 'item_of_another_user')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('reads the news about one mark when the caller opens it, in the types they may see', async () => {
    vi.mocked(repository.markAnchorItemsRead).mockResolvedValue(2)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(1)

    expect(await markAnchorItemsReadFor(session, 'document', 'doc_1', 'mark_4')).toEqual({ affected: 2, pending: 1 })
    expect(repository.markAnchorItemsRead).toHaveBeenCalledWith('org_1', 'user_1', 'document', 'doc_1', 'mark_4', [
      ...ALL_TYPES,
    ])
    expect(publishToUser).toHaveBeenCalledWith('user_1', { kind: 'inbox.changed', pending: 1 })
  })

  it('reads the rows about new marks when the caller opens the document’s review, and only those', async () => {
    vi.mocked(repository.markResourceItemsRead).mockResolvedValue(1)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(0)

    expect(await markMarksSetReadFor(session, 'document', 'doc_1')).toEqual({ affected: 1, pending: 0 })
    expect(repository.markResourceItemsRead).toHaveBeenCalledWith('org_1', 'user_1', 'document', 'doc_1', {
      groupAnchor: 'set:',
      types: [...ALL_TYPES],
    })
    expect(publishToUser).toHaveBeenCalledWith('user_1', { kind: 'inbox.changed', pending: 0 })
  })

  it('nudges nobody when the mark had no news: every open inbox would re-read for nothing', async () => {
    vi.mocked(repository.markAnchorItemsRead).mockResolvedValue(0)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(4)

    expect(await markAnchorItemsReadFor(session, 'document', 'doc_1', 'mark_4')).toEqual({ affected: 0, pending: 4 })
    expect(publishToUser).not.toHaveBeenCalled()
  })
})
