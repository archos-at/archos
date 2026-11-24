import { describe, expect, it } from 'vitest'

import type { InboxItemView } from '@/lib/inbox/types'
import { isOpenRequest } from './inbox-queue'

const row = (id: string, overrides: Partial<InboxItemView> = {}): InboxItemView => ({
  id,
  type: 'annotation.assigned_to_you',
  state: 'unread',
  archived: false,
  read: false,
  actionable: true,
  resourceType: 'document',
  resourceId: 'doc-eg',
  anchorId: `mark-${id}`,
  actorName: 'Anna Weber',
  actorUserId: 'u-anna',
  count: 1,
  href: '/app/projects/p1/files?doc=doc-eg',
  subject: 'Grundriss EG',
  related: '4',
  excerpt: 'Türbreite prüfen',
  mentions: [],
  variant: null,
  answerIn: 'row',
  createdAt: '2026-10-29T08:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
  ...overrides,
})

describe('isOpenRequest', () => {
  it('is an actionable row nobody has answered, that the reader can still reach and has not put away', () => {
    expect(isOpenRequest(row('a'))).toBe(true)
    expect(isOpenRequest(row('a', { actionable: false }))).toBe(false)
    expect(isOpenRequest(row('a', { state: 'resolved' }))).toBe(false)
    expect(isOpenRequest(row('a', { state: 'inert' }))).toBe(false)
    expect(isOpenRequest(row('a', { archived: true }))).toBe(false)
  })
})
