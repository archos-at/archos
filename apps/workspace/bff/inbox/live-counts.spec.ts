/**
 * A project's „wartet auf Ablage“ row says what waits now, not what arrived
 * since it was read (dev, 2026-11-06: „Eine E-Mail … wartet“ beside two), and
 * only to a reader who may still reach the project.
 */

import { describe, expect, it, vi } from 'vitest'
import type { InboxItemView } from './types'

vi.mock('server-only', () => ({}))
const waitingMailCounts = vi.fn(async (ids: readonly string[]) => new Map(ids.filter((id) => id === 'p1').map((id) => [id, 2])))
vi.mock('@/lib/inbound-mail/notice-repository', () => ({ waitingMailCounts: (ids: readonly string[]) => waitingMailCounts(ids) }))

const { withLiveCounts } = await import('./live-counts')

const view = (over: Partial<InboxItemView>): InboxItemView =>
  ({ id: 'r', type: 'inbound_mail.waiting', resourceType: 'project', resourceId: 'p1', count: 0, href: '/app/projects/p1/files/mail#ready', ...over }) as InboxItemView

describe('withLiveCounts', () => {
  it('replaces a waiting row’s since-read tally with the mails that wait in its project', async () => {
    const [read, fresh] = await withLiveCounts([view({ id: 'a', count: 0 }), view({ id: 'b', count: 1 })])
    expect(read.count).toBe(2)
    expect(fresh.count).toBe(2)
  })

  it('says none for a project where nothing waits any more, and leaves every other type alone', async () => {
    const [empty, other] = await withLiveCounts([view({ resourceId: 'p2', count: 3 }), view({ type: 'conversation.activity', count: 5 })])
    expect(empty.count).toBe(0)
    expect(other.count).toBe(5)
  })

  it('counts nothing for a row whose project the reader can no longer reach, and reads nothing for it', async () => {
    waitingMailCounts.mockClear()
    const [redacted] = await withLiveCounts([view({ href: null, count: 1 })])
    expect(redacted.count).toBe(1)
    expect(waitingMailCounts).not.toHaveBeenCalled()
  })
})
