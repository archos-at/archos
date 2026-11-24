import { describe, expect, test } from 'vitest'
import type { InboxItemView } from '@/lib/inbox/types'
import { newestFirstOverdueOnTop } from './inbox-entry-order'

const item = (id: string, updatedAt: string, over: Partial<InboxItemView> = {}): InboxItemView =>
  ({ id, updatedAt, actionable: true, state: 'unread', archived: false, variant: null, dueOn: null, ...over }) as InboxItemView

describe('newestFirstOverdueOnTop', () => {
  test('newest first, with no grouping', () => {
    const order = newestFirstOverdueOnTop([item('a', '2026-11-01T08:00:00Z'), item('b', '2026-11-03T08:00:00Z'), item('c', '2026-11-02T08:00:00Z')], '2026-11-20')
    expect(order.map((entry) => entry.id)).toEqual(['b', 'c', 'a'])
  })

  test('what is overdue stays on top, however old it is', () => {
    const order = newestFirstOverdueOnTop(
      [item('new', '2026-11-19T08:00:00Z'), item('late', '2026-10-01T08:00:00Z', { dueOn: '2026-11-10' }), item('flagged', '2026-10-05T08:00:00Z', { variant: 'overdue' })],
      '2026-11-20'
    )
    expect(order.map((entry) => entry.id)).toEqual(['flagged', 'late', 'new'])
  })

  test('a settled request with a past date is not overdue', () => {
    const order = newestFirstOverdueOnTop([item('new', '2026-11-19T08:00:00Z'), item('done', '2026-10-01T08:00:00Z', { dueOn: '2026-11-10', state: 'resolved' })], '2026-11-20')
    expect(order.map((entry) => entry.id)).toEqual(['new', 'done'])
  })
})
