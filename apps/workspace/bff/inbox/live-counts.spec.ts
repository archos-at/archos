/**
 * A project's „wartet auf Ablage“ row says what waits now, not what arrived
 * since it was read (dev, 2026-11-06: „Eine E-Mail … wartet“ beside two).
 */

import { describe, expect, it, vi } from 'vitest'
import type { InboxItem } from '@/lib/db/schema/inbox'

vi.mock('server-only', () => ({}))
const waitingMailCounts = vi.fn(async (ids: readonly string[]) => new Map(ids.filter((id) => id === 'p1').map((id) => [id, 2])))
vi.mock('@/lib/inbound-mail/notice-repository', () => ({ waitingMailCounts: (ids: readonly string[]) => waitingMailCounts(ids) }))

const { withLiveCounts } = await import('./live-counts')

const row = (over: Partial<InboxItem>): InboxItem =>
  ({ id: 'r', type: 'inbound_mail.waiting', resourceType: 'project', resourceId: 'p1', count: 0, ...over }) as InboxItem

describe('withLiveCounts', () => {
  it('replaces a waiting row’s since-read tally with the mails that wait in its project', async () => {
    const [read, fresh] = await withLiveCounts([row({ id: 'a', count: 0 }), row({ id: 'b', count: 1 })])
    expect(read.count).toBe(2)
    expect(fresh.count).toBe(2)
  })

  it('says none for a project where nothing waits any more, and leaves every other type alone', async () => {
    const [empty, other] = await withLiveCounts([row({ resourceId: 'p2', count: 3 }), row({ type: 'conversation.activity', count: 5 })])
    expect(empty.count).toBe(0)
    expect(other.count).toBe(5)
  })

  it('reads nothing when no row is live-counted', async () => {
    waitingMailCounts.mockClear()
    await withLiveCounts([row({ type: 'mention.requested' })])
    expect(waitingMailCounts).not.toHaveBeenCalled()
  })
})
