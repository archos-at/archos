import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: {
    getState: () => ({
      enabledDataSourceIds: [],
      availableDataSources: [],
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
  listMessages: vi.fn().mockResolvedValue([]),
  listReadableMessages: vi.fn().mockResolvedValue({ messages: [] }),
  createMessage: vi.fn().mockResolvedValue({}),
  createMessages: vi.fn(),
  newestFrameAge: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/adapters/api/conversations-client', () => ({ conversationsClient: client }))

import { useChatStore } from '../store'
import { selectThreadPhase } from '@/features/layout/lib/thread-phase'
import { forgetSideLoads } from './session-server-sync'
import { markConversationOnServer } from '../lib/conversation-on-server'

const listedElsewhere = {
  id: 's_srv',
  title: 'Vom Server',
  projectId: null,
  createdBy: 'u1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('the draft a first keystroke opens', () => {
  beforeEach(() => {
    forgetSideLoads()
    localStorage.clear()
    vi.clearAllMocks()
    useChatStore.setState({
      currentUserId: 'u1',
      conversations: [],
      currentConversation: null,
      projectId: null,
      pendingMessagesFor: null,
      composerDrafts: {},
    })
  })

  // The URL takes the draft's id and the page loads its side for it; asking the server for a
  // chat it never had marked the thread „loading“, which is what draws the message-list skeleton
  // (use-chat-area-controller's showSkeleton): one letter typed flashed it.
  it('is never asked of the server, so the loading skeleton never shows', async () => {
    client.list.mockResolvedValue([listedElsewhere])
    const draftId = useChatStore.getState().ensureSession()!
    const phases: string[] = []
    const stop = useChatStore.subscribe((state) => phases.push(selectThreadPhase(state)))

    await useChatStore.getState().loadServerConversations(undefined, 'personal', draftId)
    await new Promise((resolve) => setTimeout(resolve, 20))
    stop()

    expect(client.listReadableMessages).not.toHaveBeenCalledWith(draftId)
    expect(phases).not.toContain('loading')
    expect(useChatStore.getState().currentConversation?.id).toBe(draftId)
  })

  it('is not fetched when the link opens it, nor once an @ has put it on the server', async () => {
    const draftId = useChatStore.getState().ensureSession()!
    markConversationOnServer(draftId)
    client.list.mockResolvedValue([{ ...listedElsewhere, id: draftId, title: null }])
    const phases: string[] = []
    const stop = useChatStore.subscribe((state) => phases.push(selectThreadPhase(state)))

    useChatStore.getState().selectConversation(draftId)
    await useChatStore.getState().loadServerConversations(undefined, 'personal', draftId)
    await new Promise((resolve) => setTimeout(resolve, 20))
    stop()

    expect(client.listReadableMessages).not.toHaveBeenCalled()
    expect(phases).not.toContain('loading')
  })

  it('a listed chat this tab did not open is still fetched', async () => {
    client.list.mockResolvedValue([listedElsewhere])
    await useChatStore.getState().loadServerConversations(undefined, 'personal')
    useChatStore.getState().selectConversation('s_srv')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(client.listReadableMessages).toHaveBeenCalledWith('s_srv')
  })
})
