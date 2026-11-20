import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/push/enqueue', () => ({ enqueueInboxPushes: vi.fn().mockResolvedValue(0) }))
vi.mock('@/lib/events/bus', () => ({ publishToUser: vi.fn().mockResolvedValue(undefined) }))
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

import type { InboxItemType } from '@/lib/db/schema/inbox'
import { enqueueInboxPushes } from '@/lib/push/enqueue'
import { publishToUser } from '@/lib/events/bus'
import * as repository from './repository'
import { emitInboxItems, markInboxItemsInertAnchoredOn, resolveInboxItemsAnchoredOn, upsertWaves } from './service'
import { row } from './service.fixtures'

describe('emitInboxItems — repeated keys in one call', () => {
  it('splits rows so no wave repeats a (recipient, group) key, keeping order', () => {
    const row = (recipientUserId: string, groupKey: string, n: number) => ({ recipientUserId, groupKey, n })
    const waves = upsertWaves([row('a', 'g', 1), row('b', 'g', 2), row('a', 'g', 3), row('a', 'g', 4), row('a', 'h', 5)])
    expect(waves.map((wave) => wave.map((r) => r.n))).toEqual([[1, 2, 5], [3], [4]])
  })

  it('upserts each wave on its own', async () => {
    vi.mocked(repository.upsertInboxItems).mockResolvedValue([])
    const emission = {
      organizationId: 'org-1',
      recipientUserId: 'reviewer',
      type: 'document.quarantined' as const,
      resourceType: 'organization' as const,
      resourceId: 'org-1',
      actorUserId: 'uploader',
      groupKey: 'document.quarantined:organization:org-1',
    }
    await emitInboxItems([emission, emission])
    expect(repository.upsertInboxItems).toHaveBeenCalledTimes(2)
  })

  it('writes one emission that stands for several occurrences as one row counting them all', async () => {
    vi.mocked(repository.upsertInboxItems).mockResolvedValue([])
    const emission = {
      organizationId: 'org-1',
      recipientUserId: 'lead',
      type: 'annotation.activity' as const,
      resourceType: 'document' as const,
      resourceId: 'doc-1',
      anchorId: 'ann-15',
      actorUserId: 'miriam',
      groupKey: 'annotation.activity:document:doc-1:set:created:miriam',
    }
    await emitInboxItems([{ ...emission, occurrences: 15 }, { ...emission, recipientUserId: 'uploader' }])

    expect(repository.upsertInboxItems).toHaveBeenCalledTimes(1)
    expect(vi.mocked(repository.upsertInboxItems).mock.calls[0]?.[0].map((row) => [row.recipientUserId, row.count])).toEqual([
      ['lead', 15],
      ['uploader', 1],
    ])
  })
})

describe('resolveInboxItemsAnchoredOn', () => {
  it('resolves through the repository and nudges each person whose badge moved, once', async () => {
    vi.mocked(repository.resolveOpenItemsAnchoredOn).mockResolvedValue(['user_a', 'user_b'])
    vi.mocked(publishToUser).mockClear()

    const input = { organizationId: 'org_1', types: ['agent.asks_you'] as InboxItemType[], anchorId: 'ann_1' }
    expect(await resolveInboxItemsAnchoredOn(input)).toBe(2)

    expect(repository.resolveOpenItemsAnchoredOn).toHaveBeenCalledWith(input)
    expect(publishToUser).toHaveBeenCalledTimes(2)
    expect(publishToUser).toHaveBeenCalledWith('user_a', { kind: 'inbox.changed', pending: -1 })
  })

  it('nudges nobody when nothing was open', async () => {
    vi.mocked(repository.resolveOpenItemsAnchoredOn).mockResolvedValue([])
    vi.mocked(publishToUser).mockClear()

    expect(
      await resolveInboxItemsAnchoredOn({ organizationId: 'org_1', types: ['agent.asks_you'], anchorId: 'ann_1' }),
    ).toBe(0)
    expect(publishToUser).not.toHaveBeenCalled()
  })
})

describe('markInboxItemsInertAnchoredOn', () => {
  it('turns the rows inert through the repository and nudges each person whose badge moved', async () => {
    vi.mocked(repository.markItemsInertAnchoredOn).mockResolvedValue(['user_a', 'user_b'])
    vi.mocked(publishToUser).mockClear()

    const input = { organizationId: 'org_1', types: ['annotation.activity'] as InboxItemType[], anchorId: 'ann_1' }
    expect(await markInboxItemsInertAnchoredOn(input)).toBe(2)

    expect(repository.markItemsInertAnchoredOn).toHaveBeenCalledWith(input)
    expect(publishToUser).toHaveBeenCalledTimes(2)
    expect(publishToUser).toHaveBeenCalledWith('user_b', { kind: 'inbox.changed', pending: -1 })
  })
})

describe('emitInboxItems — system notifications (ADR-0112)', () => {
  const emission = {
    organizationId: 'org_1',
    recipientUserId: 'user_1',
    type: 'mention.requested' as const,
    resourceType: 'conversation' as const,
    resourceId: 'conv_1',
    anchorId: 'm1',
    actorUserId: 'user_2',
    groupKey: 'mention.requested:conversation:conv_1:m1',
  }

  it('hands the stored rows to the push queue, after they are stored', async () => {
    const stored = row({ id: 'stored', type: 'mention.requested' })
    vi.mocked(repository.upsertInboxItems).mockResolvedValue([stored])
    vi.mocked(enqueueInboxPushes).mockClear()
    await emitInboxItems([emission])
    expect(enqueueInboxPushes).toHaveBeenCalledWith([stored])
  })

  it('does not queue a push for a notification about one’s own action', async () => {
    vi.mocked(enqueueInboxPushes).mockClear()
    await emitInboxItems([{ ...emission, actorUserId: 'user_1' }])
    expect(enqueueInboxPushes).not.toHaveBeenCalled()
  })
})
