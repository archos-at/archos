import { beforeEach, describe, expect, it, vi } from 'vitest'

const layoutState = vi.hoisted(() => ({
  enabledDataSourceIds: ['web_search'],
  availableDataSources: [{ id: 'web_search' }],
  setEnabledDataSources: vi.fn(),
}))
vi.mock('@/features/layout/store', () => ({
  useLayoutStore: { getState: () => layoutState },
}))

vi.mock('@/adapters/api/deep-research-client', () => ({
  getJobStatus: vi.fn(),
  cancelJob: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/features/documents/discard-session-resources', () => ({
  discardSessionDocumentsResources: vi.fn(),
}))

const conversationsClient = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(async () => ({ temporary: false })),
  updateTitle: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  createMessages: vi.fn(),
  newestFrameAge: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/adapters/api/conversations-client', () => ({ conversationsClient }))

import { useChatStore } from '../store'

beforeEach(() => {
  conversationsClient.create.mockClear()
  useChatStore.setState({ currentUserId: 'u-me', currentConversation: null, conversations: [], composerTemporary: false })
  useChatStore.getState().startNewSessionDraft()
})

describe('a new chat’s temporary switch is a draft that rides along with the first message', () => {
  it('switching it on creates no conversation, so nothing on the page changes but the switch', () => {
    useChatStore.getState().setComposerTemporary(true)

    const state = useChatStore.getState()
    expect(state.composerTemporary).toBe(true)
    expect(state.currentConversation).toBeNull()
    expect(state.conversations).toHaveLength(0)
    expect(conversationsClient.create).not.toHaveBeenCalled()
  })

  it('the first message creates the chat temporary, and the draft is spent', async () => {
    useChatStore.getState().setComposerTemporary(true)

    const id = useChatStore.getState().ensureSession()!
    await useChatStore.getState()._ensureConversationExists()

    expect(useChatStore.getState().currentConversation).toMatchObject({ id, temporary: true })
    expect(useChatStore.getState().composerTemporary).toBe(false)
    expect(conversationsClient.create).toHaveBeenCalledWith(id, undefined, null, null, true)
  })

  it('switched on and off again, the chat is created as an ordinary one', async () => {
    useChatStore.getState().setComposerTemporary(true)
    useChatStore.getState().setComposerTemporary(false)

    const id = useChatStore.getState().ensureSession()!
    await useChatStore.getState()._ensureConversationExists()

    expect(useChatStore.getState().currentConversation?.temporary).toBeUndefined()
    expect(conversationsClient.create).toHaveBeenCalledWith(id, undefined, null, null, undefined)
  })

  it('a fresh new chat, or opening another chat, starts with the switch off', () => {
    useChatStore.getState().setComposerTemporary(true)
    useChatStore.getState().startNewSessionDraft()
    expect(useChatStore.getState().composerTemporary).toBe(false)

    const other = { id: 's_other', userId: 'u-me', projectId: null, title: 'Stellplätze', messages: [], createdAt: new Date(), updatedAt: new Date() }
    useChatStore.setState({ conversations: [other] })
    useChatStore.getState().setComposerTemporary(true)
    useChatStore.getState().selectConversation('s_other')
    expect(useChatStore.getState().composerTemporary).toBe(false)
  })
})
