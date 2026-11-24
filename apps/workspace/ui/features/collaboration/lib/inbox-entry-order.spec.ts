import { describe, expect, test } from 'vitest'
import type { InboxItemView } from '@/lib/inbox/types'
import { newestFirstOverdueOnTop, nextAfterLeaving, sameDocumentAs } from './inbox-entry-order'

const item = (id: string, updatedAt: string, over: Partial<InboxItemView> = {}): InboxItemView =>
  ({ id, updatedAt, actionable: true, state: 'unread', archived: false, variant: null, dueOn: null, ...over }) as InboxItemView

describe('newestFirstOverdueOnTop', () => {
  test('newest first, with no grouping', () => {
    const order = newestFirstOverdueOnTop([item('a', '2026-11-01T08:00:00Z'), item('b', '2026-11-03T08:00:00Z'), item('c', '2026-11-02T08:00:00Z')])
    expect(order.map((entry) => entry.id)).toEqual(['b', 'c', 'a'])
  })

  test('what is overdue stays on top, however old it is', () => {
    const order = newestFirstOverdueOnTop(
      [item('new', '2026-11-19T08:00:00Z'), item('late', '2026-10-01T08:00:00Z', { variant: 'overdue', dueOn: '2026-11-10' }), item('flagged', '2026-10-05T08:00:00Z', { variant: 'overdue' })]
    )
    expect(order.map((entry) => entry.id)).toEqual(['flagged', 'late', 'new'])
  })

  test('a settled request is not overdue, whatever its flag', () => {
    const order = newestFirstOverdueOnTop([item('new', '2026-11-19T08:00:00Z'), item('done', '2026-10-01T08:00:00Z', { variant: 'overdue', state: 'resolved' })])
    expect(order.map((entry) => entry.id)).toEqual(['new', 'done'])
  })
})

const onDocument = (id: string, documentId: string | null): InboxItemView =>
  item(id, '2026-11-01T08:00:00Z', {
    type: documentId ? 'annotation.assigned_to_you' : 'conversation.activity',
    resourceType: documentId ? 'document' : 'conversation',
    resourceId: documentId ?? `c-${id}`,
    anchorId: documentId ? `mark-${id}` : null,
    href: documentId ? `/app/projects/p1/files?doc=${documentId}&review=1&mark=mark-${id}` : `/app/projects/p1/chat?session=c-${id}`,
  })
const idsOf = (entries: readonly InboxItemView[]): string[] => entries.map((entry) => entry.id)

describe('sameDocumentAs', () => {
  test('the other marks on the entry’s document, the ones below it first, then from the top', () => {
    const entries = [onDocument('a', 'd1'), onDocument('b', 'd2'), onDocument('c', 'd1'), onDocument('d', 'd1'), onDocument('e', 'd3')]
    expect(idsOf(sameDocumentAs(entries, entries[2]))).toEqual(['d', 'a'])
  })

  test('an entry about no mark has no document to stay on', () => {
    const entries = [onDocument('a', null), onDocument('b', 'd1')]
    expect(sameDocumentAs(entries, entries[0])).toEqual([])
  })

  test('an entry that is about the same document but no longer about a mark does not count', () => {
    const entries = [onDocument('a', 'd1'), { ...onDocument('b', 'd1'), state: 'inert' as const }]
    expect(sameDocumentAs(entries, entries[0])).toEqual([])
  })
})

describe('nextAfterLeaving', () => {
  test('stays on the document: the next mark there wins over the entry below', () => {
    const entries = [onDocument('a', 'd1'), onDocument('b', 'd2'), onDocument('c', 'd1')]
    expect(nextAfterLeaving(entries, 'a')?.id).toBe('c')
  })

  test('stays on the document even when its next mark is above', () => {
    const entries = [onDocument('a', 'd1'), onDocument('b', 'd2'), onDocument('c', 'd1')]
    expect(nextAfterLeaving(entries, 'c')?.id).toBe('a')
  })

  test('otherwise opens the entry that slides into the place', () => {
    const entries = [onDocument('a', 'd1'), onDocument('b', 'd2'), onDocument('c', 'd3')]
    expect(nextAfterLeaving(entries, 'b')?.id).toBe('c')
  })

  test('and the one above when the last entry leaves', () => {
    const entries = [onDocument('a', null), onDocument('b', 'd2'), onDocument('c', null)]
    expect(nextAfterLeaving(entries, 'c')?.id).toBe('b')
  })

  test('nothing when the last entry of the tab leaves, or the entry is not in the list', () => {
    expect(nextAfterLeaving([onDocument('a', 'd1')], 'a')).toBeNull()
    expect(nextAfterLeaving([onDocument('a', 'd1')], 'gone')).toBeNull()
    expect(nextAfterLeaving([], 'a')).toBeNull()
  })
})
