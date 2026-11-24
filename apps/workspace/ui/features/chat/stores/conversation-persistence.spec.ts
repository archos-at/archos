import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStore, Conversation } from '../types'

const create = vi.fn(async () => ({ temporary: false }))
const createMessage = vi.fn(async () => ({}))
vi.mock('../lib/conversations-client-access', () => ({
  getConversationsClient: async () => ({ create, createMessage }),
  isRightsLost: () => false,
}))

import { createConversationPersistenceSlice } from './conversation-persistence'

const personalChat = {
  id: 's_personal',
  userId: 'u',
  projectId: null,
  title: '',
  messages: [],
  createdAt: new Date(),
  updatedAt: new Date(),
} as Conversation

beforeEach(() => create.mockClear())

describe('a chat’s server row is stamped with its own project, never the open page’s (ADR-0193 rule 2)', () => {
  it('creates a chat without a project as one, while a project page is open', async () => {
    const state = { currentConversation: personalChat, conversations: [personalChat], projectId: 'page_project' }
    const slice = createConversationPersistenceSlice(
      vi.fn(),
      () => state as unknown as ChatStore,
      undefined as never
    )

    await slice._ensureConversationExists()

    expect(create).toHaveBeenCalledWith('s_personal', undefined, null, null, undefined)
  })
})
