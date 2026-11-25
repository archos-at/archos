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

async function startChatWhere(projectId: string | null): Promise<string> {
  const store = useChatStore.getState()
  store.setProjectId(projectId)
  useChatStore.getState().startNewSessionDraft()
  const id = useChatStore.getState().ensureSession()!
  await useChatStore.getState()._ensureConversationExists()
  return id
}

beforeEach(() => {
  conversationsClient.create.mockClear()
  useChatStore.setState({ currentUserId: 'u-me', currentConversation: null, conversations: [] })
})

describe('a new chat is created in the place it was started (ADR-0193)', () => {
  it('under Persönlich, without a project', async () => {
    const id = await startChatWhere(null)

    expect(conversationsClient.create).toHaveBeenCalledTimes(1)
    expect(conversationsClient.create).toHaveBeenCalledWith(id, undefined, null, null, undefined)
  })

  it('under Projekt, in that project', async () => {
    const id = await startChatWhere('p-seestadt')

    expect(conversationsClient.create).toHaveBeenCalledTimes(1)
    expect(conversationsClient.create).toHaveBeenCalledWith(
      id,
      undefined,
      'p-seestadt',
      null,
      undefined
    )
  })

  it('under Persönlich after a project was open, still without one', async () => {
    await startChatWhere('p-seestadt')
    conversationsClient.create.mockClear()

    const id = await startChatWhere(null)

    expect(conversationsClient.create).toHaveBeenCalledWith(id, undefined, null, null, undefined)
  })
})
