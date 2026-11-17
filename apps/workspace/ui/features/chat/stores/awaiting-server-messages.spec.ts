import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: {
    getState: () => ({
      enabledDataSourceIds: ['web_search'],
      availableDataSources: [{ id: 'web_search' }],
      setEnabledDataSources: vi.fn(),
    }),
  },
}))
vi.mock('@/adapters/api/deep-research-client', () => ({
  getJobStatus: vi.fn(),
  cancelJob: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/features/documents/discard-session-resources', () => ({
  discardSessionDocumentsResources: vi.fn(),
}))

const client = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn().mockResolvedValue({}),
  updateTitle: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  listMessages: vi.fn(),
  createMessage: vi.fn().mockResolvedValue({}),
  createMessages: vi.fn(),
  newestFrameAge: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/adapters/api/conversations-client', () => ({ conversationsClient: client }))

import { useChatStore } from '../store'
import type { Conversation } from '../types'
import {
  chatIndexKey,
  chatMessagesKey,
  clearAwaitingServerMessages,
  isAwaitingServerMessages,
} from './chat-storage'

const STORE = 'chat-store'
const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

const openConversation: Conversation = {
  id: 's_open',
  userId: 'u1',
  projectId: null,
  title: 'open',
  messages: [
    { id: 'o1', role: 'user', content: 'hi', timestamp: new Date('2026-02-01'), messageType: 'user' },
  ],
  createdAt: new Date('2026-02-01'),
  updatedAt: new Date('2026-02-01'),
}

const serverListing = [
  {
    id: 's_srv',
    title: 'Vom Server',
    projectId: null,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

const reload = async (id: string) => {
  clearAwaitingServerMessages(id)
  await useChatStore.persist.rehydrate()
}

const openAndLeaveBeforeTheHistory = async (id: string) => {
  let resolve!: (rows: unknown[]) => void
  client.listMessages.mockReturnValue(new Promise((r) => (resolve = r)))
  useChatStore.getState().selectConversation(id)
  useChatStore.getState().selectConversation('s_open')
  await flush()
  return resolve
}

describe('a conversation the server listed without its messages', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    useChatStore.setState({
      currentUserId: 'u1',
      conversations: [openConversation],
      currentConversation: openConversation,
      projectId: null,
      isStreaming: false,
      isLoading: false,
      pendingInteraction: null,
      composerDrafts: {},
    })
    client.list.mockResolvedValue(serverListing)
  })

  it('stays awaiting across a reload, and is never deleted on the server', async () => {
    await useChatStore.getState().loadServerConversations()
    expect(isAwaitingServerMessages('s_srv')).toBe(true)
    useChatStore.getState().updateConversationTitle('s_open', 'renamed')

    expect(localStorage.getItem(chatMessagesKey(STORE, 's_srv'))).toBeNull()
    const index = JSON.parse(localStorage.getItem(chatIndexKey(STORE))!)
    expect(index.state.awaitingServerMessages).toEqual(['s_srv'])

    await reload('s_srv')
    expect(isAwaitingServerMessages('s_srv')).toBe(true)

    const resolve = await openAndLeaveBeforeTheHistory('s_srv')
    expect(client.delete).not.toHaveBeenCalled()
    expect(useChatStore.getState().conversations.map((c) => c.id)).toContain('s_srv')
    resolve([])
    await flush()
  })

  it('reads a stored empty list as not loaded (storage the regression already wrote)', async () => {
    await useChatStore.getState().loadServerConversations()
    useChatStore.getState().updateConversationTitle('s_open', 'renamed')
    localStorage.setItem(chatMessagesKey(STORE, 's_srv'), '[]')
    const index = JSON.parse(localStorage.getItem(chatIndexKey(STORE))!)
    delete index.state.awaitingServerMessages
    localStorage.setItem(chatIndexKey(STORE), JSON.stringify(index))

    await reload('s_srv')
    expect(isAwaitingServerMessages('s_srv')).toBe(true)

    const resolve = await openAndLeaveBeforeTheHistory('s_srv')
    expect(client.delete).not.toHaveBeenCalled()
    resolve([])
    await flush()
  })

  it('is discarded only once the server has confirmed it is empty', async () => {
    await useChatStore.getState().loadServerConversations()
    client.listMessages.mockResolvedValue([])

    useChatStore.getState().selectConversation('s_srv')
    await flush()
    expect(isAwaitingServerMessages('s_srv')).toBe(false)
    useChatStore.getState().selectConversation('s_open')

    await flush()
    expect(client.delete).toHaveBeenCalledWith('s_srv')
  })

  it('is not discarded while its history is still being fetched', async () => {
    const empty: Conversation = { ...openConversation, id: 's_local', messages: [] }
    useChatStore.setState({ conversations: [openConversation, empty] })

    const resolve = await openAndLeaveBeforeTheHistory('s_local')
    expect(client.delete).not.toHaveBeenCalled()
    resolve([])
    await flush()
  })
})
