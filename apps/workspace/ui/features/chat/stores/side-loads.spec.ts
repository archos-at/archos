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

  it('a link’s ask joins the side’s fetch still in flight instead of racing it', async () => {
    const { loadServerConversations } = useChatStore.getState()
    const first = loadServerConversations('p1', 'project')
    await loadServerConversations('p1', 'project', 's_new')
    await first

    expect(list).toHaveBeenCalledTimes(1)
  })

  it('a slower, older fetch never overwrites the side’s newer listing', async () => {
    let finishOld: (rows: unknown[]) => void = () => {}
    list
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce([row('s_new')])
    const { loadServerConversations } = useChatStore.getState()
    const old = loadServerConversations('p1', 'project')
    forgetSideLoads()
    await loadServerConversations('p1', 'project')
    finishOld([])
    await old

    expect(useChatStore.getState().serverSides['project:p1']?.ids).toEqual(['s_new'])
  })

  it('another person’s sign-in leaves their list unloaded until their own fetch answers', async () => {
    const { loadServerConversations, setCurrentUser } = useChatStore.getState()
    setCurrentUser('u1')
    await loadServerConversations(undefined, 'personal')
    expect(useChatStore.getState().serverConversationsLoaded).toBe(true)

    let finishOld: (rows: unknown[]) => void = () => {}
    list.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    const old = loadServerConversations('p1', 'project')
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    setCurrentUser('u2')
    expect(useChatStore.getState().serverConversationsLoaded).toBe(false)
    finishOld([])
    await old
    expect(useChatStore.getState().serverConversationsLoaded).toBe(false)

    await loadServerConversations(undefined, 'personal')
    expect(useChatStore.getState().serverConversationsLoaded).toBe(true)
  })

  it('the other side’s warm-up answering first does not mark the list loaded while the linked side still loads', async () => {
    let finishLinked: (rows: unknown[]) => void = () => {}
    list.mockImplementationOnce(() => new Promise((resolve) => { finishLinked = resolve })).mockResolvedValue([])
    useChatStore.setState({ serverConversationsLoaded: false })
    const { loadServerConversations } = useChatStore.getState()
    const linked = loadServerConversations('p1', 'project', 's_linked')
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    await loadServerConversations(undefined, 'personal')
    expect(useChatStore.getState().serverConversationsLoaded).toBe(false)

    finishLinked([row('s_linked')])
    await linked
    expect(useChatStore.getState().serverConversationsLoaded).toBe(true)
  })

  it('another person signing in on the same tab fetches their sides afresh', async () => {
    const { loadServerConversations, setCurrentUser } = useChatStore.getState()
    setCurrentUser('u1')
    await loadServerConversations(undefined, 'personal')
    setCurrentUser(null)
    setCurrentUser('u2')
    expect(useChatStore.getState().serverSides).toEqual({})
    await loadServerConversations(undefined, 'personal')

    expect(list).toHaveBeenCalledTimes(2)
  })

  it('signing in after a load without a person keeps the sides already asked for', async () => {
    const { loadServerConversations, setCurrentUser } = useChatStore.getState()
    setCurrentUser(null)
    await loadServerConversations(undefined, 'personal')
    setCurrentUser('u1')
    await loadServerConversations(undefined, 'personal')

    expect(list).toHaveBeenCalledTimes(1)
  })
})

function row(id: string) {
  const at = new Date().toISOString()
  return { id, title: 'Plan', projectId: 'p1', createdAt: at, updatedAt: at }
}
