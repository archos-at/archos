/**
 * @vitest-environment node
 *
 * An inbox item about a chat that read its owner's shelf carries that chat's
 * title and words; an agent that may not draw on that shelf gets it withheld.
 */
import { describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { InboxItem } from '@/lib/db/schema/inbox'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/conversations/shelf-titles', () => ({
  shelfChatsHiddenFromAgent: vi.fn(async (_org: string, _user: string, ids: string[]) => new Set(ids.filter((id) => id.startsWith('s_shelf')))),
}))

import { shelfChatsHiddenFromAgent } from '@/lib/conversations/shelf-titles'
import { rowsAboutShelfChatsHiddenFromAgent } from './inbox-shelf-chats'

const session = { organizationId: 'org_1', userId: 'user_me' } as AuthorizedSession
const item = (id: string, over: Partial<InboxItem>) => ({ id, resourceType: 'document', resourceId: 'd1', payload: {}, ...over }) as InboxItem

describe('rowsAboutShelfChatsHiddenFromAgent', () => {
  it('withholds an item on such a chat, or naming it in its payload, and nothing else', async () => {
    const rows = [
      item('on_chat', { resourceType: 'conversation', resourceId: 's_shelf_1' }),
      item('names_chat', { payload: { conversationId: 's_shelf_2' } }),
      item('plain_chat', { resourceType: 'conversation', resourceId: 's_plain' }),
      item('document', {}),
    ]

    expect(await rowsAboutShelfChatsHiddenFromAgent(session, rows)).toEqual(new Set(['on_chat', 'names_chat']))
    expect(shelfChatsHiddenFromAgent).toHaveBeenCalledWith('org_1', 'user_me', ['s_shelf_1', 's_shelf_2', 's_plain'])
  })
})
