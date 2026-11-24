import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: { getState: () => ({ enabledDataSourceIds: [], availableDataSources: [], setEnabledDataSources: vi.fn() }) },
}))
vi.mock('@/adapters/api/deep-research-client', () => ({ getJobStatus: vi.fn(), cancelJob: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/features/documents/discard-session-resources', () => ({ discardSessionDocumentsResources: vi.fn() }))

const list = vi.hoisted(() => vi.fn())
vi.mock('@/adapters/api/conversations-client', () => ({
  conversationsClient: { list, get: vi.fn(), listMessages: vi.fn().mockResolvedValue([]), newestFrameAge: vi.fn().mockResolvedValue(null) },
}))

import { useChatStore } from '../store'
import { forgetSideLoads } from './session-server-sync'

beforeEach(() => {
  forgetSideLoads()
  list.mockReset().mockResolvedValue([])
  useChatStore.setState({ currentUserId: 'u1', conversations: [], currentConversation: null })
})

describe('a side’s chats are fetched once while fresh (ADR-0193, the rail’s switch)', () => {
  it('the switch’s warm-up, its hover and the page that lands ask once', async () => {
    const { loadServerConversations } = useChatStore.getState()
    await Promise.all([loadServerConversations('p1', 'project'), loadServerConversations('p1', 'project')])
    await loadServerConversations('p1', 'project')

    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith('p1', 'project')
  })

  it('each side is its own fetch', async () => {
    const { loadServerConversations } = useChatStore.getState()
    await loadServerConversations(undefined, 'personal')
    await loadServerConversations('p1', 'project')

    expect(list.mock.calls).toEqual([
      [undefined, 'personal'],
      ['p1', 'project'],
    ])
  })

  it('a failed fetch is not remembered: the next ask fetches again', async () => {
    list.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([])
    const { loadServerConversations } = useChatStore.getState()
    await loadServerConversations('p1', 'project')
    await loadServerConversations('p1', 'project')

    expect(list).toHaveBeenCalledTimes(2)
  })

  it('a fresh side is fetched again when the chat a link asks for is not in it', async () => {
    const { loadServerConversations } = useChatStore.getState()
    await loadServerConversations('p1', 'project')
    await loadServerConversations('p1', 'project', 's_new')

    expect(list).toHaveBeenCalledTimes(2)
  })
})
