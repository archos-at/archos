import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { useChatStore } from './store'
import type { Conversation } from './types'

const mockLayoutState = vi.hoisted(() => ({
  enabledDataSourceIds: ['web_search'],
  availableDataSources: [{ id: 'web_search' }, { id: 'knowledge_base', requires_auth: true }],
  setEnabledDataSources: vi.fn(),
}))

const mockDiscardSessionResources = vi.hoisted(() => vi.fn())

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: {
    getState: () => mockLayoutState,
  },
}))

vi.mock('@/features/documents/discard-session-resources', () => ({
  discardSessionDocumentsResources: mockDiscardSessionResources,
}))

const mockConversationsClient = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue([]),
  get: vi.fn().mockResolvedValue(undefined),
  create: vi.fn().mockResolvedValue(undefined),
  updateTitle: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  deleteOwn: vi.fn().mockResolvedValue({ deleted: [], held: [] }),
  listMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue(undefined),
  createMessages: vi.fn().mockResolvedValue(undefined),
  newestFrameAge: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/adapters/api/conversations-client', () => ({
  conversationsClient: mockConversationsClient,
}))

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.persist.clearStorage()
    mockLayoutState.setEnabledDataSources.mockClear()
    mockLayoutState.enabledDataSourceIds = ['web_search']
    mockLayoutState.availableDataSources = [
      { id: 'web_search' },
      { id: 'knowledge_base', requires_auth: true },
    ]
    mockDiscardSessionResources.mockClear()
    useChatStore.setState({
      currentUserId: null,
      currentConversation: null,
      conversations: [],
      projectId: null,
      isStreaming: false,
      isLoading: false,
      currentUserMessageId: null,
      pendingInteraction: null,
      composerPrefill: null,
      composerSubject: null,
      composerDrafts: {},
      lastChatBySide: {},
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    useChatStore.persist.clearStorage()
  })

  describe('project scoping (UX-8 cross-project bleed)', () => {
    const makeConv = (id: string, userId: string, projectId?: string | null): Conversation => ({
      id,
      userId,
      ...(projectId !== undefined && { projectId }),
      title: `Conv ${id}`,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    describe('getUserConversations', () => {
      test("inside a project, lists that project's sessions plus unscoped legacy sessions (fail-open)", () => {
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: 'proj-a',
          conversations: [
            makeConv('a-1', 'user-1', 'proj-a'),
            makeConv('b-1', 'user-1', 'proj-b'),
            makeConv('legacy-null', 'user-1', null),
            makeConv('legacy-undef', 'user-1'),
            makeConv('other-user', 'user-2', 'proj-a'),
          ],
        })

        const ids = useChatStore
          .getState()
          .getUserConversations()
          .map((c) => c.id)

        expect(ids).toEqual(['a-1', 'legacy-null', 'legacy-undef'])
      })

      test("without a project context, lists all of the user's sessions", () => {
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: null,
          conversations: [
            makeConv('a-1', 'user-1', 'proj-a'),
            makeConv('b-1', 'user-1', 'proj-b'),
            makeConv('legacy', 'user-1', null),
          ],
        })

        expect(useChatStore.getState().getUserConversations()).toHaveLength(3)
      })
    })

    describe('createConversation / ensureSession', () => {
      test('createConversation stamps the active projectId', () => {
        useChatStore.setState({ currentUserId: 'user-1', projectId: 'proj-a' })

        const conv = useChatStore.getState().createConversation()

        expect(conv.projectId).toBe('proj-a')
      })

      test('ensureSession stamps the active projectId on the new session', () => {
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: 'proj-a',
          currentConversation: null,
        })

        const sessionId = useChatStore.getState().ensureSession()

        const created = useChatStore.getState().conversations.find((c) => c.id === sessionId)
        expect(created?.projectId).toBe('proj-a')
      })
    })

    describe('selectConversation guard', () => {
      test("refuses to activate another project's session under the current project", () => {
        const foreign = makeConv('b-1', 'user-1', 'proj-b')
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: 'proj-a',
          conversations: [foreign],
          currentConversation: null,
        })

        useChatStore.getState().selectConversation('b-1')

        expect(useChatStore.getState().currentConversation).toBeNull()
      })

      test('allows selecting an unscoped legacy session in any project (fail-open)', () => {
        const legacy = makeConv('legacy', 'user-1', null)
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: 'proj-a',
          conversations: [legacy],
          currentConversation: null,
        })

        useChatStore.getState().selectConversation('legacy')

        expect(useChatStore.getState().currentConversation?.id).toBe('legacy')
      })
    })

    describe('deleteAllConversations asks the server for one side', () => {
      test('a project sends that project, and only the ids the server deleted leave the store', async () => {
        mockConversationsClient.deleteOwn.mockResolvedValueOnce({ deleted: ['a-1', 'a-2'], held: [] })
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: 'proj-a',
          conversations: [
            makeConv('a-1', 'user-1', 'proj-a'),
            makeConv('a-2', 'user-1', 'proj-a'),
            makeConv('personal', 'user-1', null),
            makeConv('b-1', 'user-1', 'proj-b'),
          ],
          currentConversation: makeConv('a-1', 'user-1', 'proj-a'),
        })

        await useChatStore.getState().deleteAllConversations({ projectId: 'proj-a' })

        expect(mockConversationsClient.deleteOwn).toHaveBeenCalledWith({ projectId: 'proj-a' })
        const state = useChatStore.getState()
        expect(state.conversations.map((c) => c.id).sort()).toEqual(['b-1', 'personal'])
        expect(state.currentConversation).toBeNull()
      })

      test('Persönlich sends no project and keeps every project chat', async () => {
        mockConversationsClient.deleteOwn.mockResolvedValueOnce({ deleted: ['personal'], held: [] })
        const foreignCurrent = makeConv('b-1', 'user-1', 'proj-b')
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: null,
          conversations: [makeConv('personal', 'user-1', null), makeConv('a-1', 'user-1', 'proj-a'), foreignCurrent],
          currentConversation: foreignCurrent,
        })

        await useChatStore.getState().deleteAllConversations({ projectId: null })

        expect(mockConversationsClient.deleteOwn).toHaveBeenCalledWith({ projectId: null })
        const state = useChatStore.getState()
        expect(state.conversations.map((c) => c.id).sort()).toEqual(['a-1', 'b-1'])
        expect(state.currentConversation?.id).toBe('b-1')
      })

      test('a held chat the server kept stays listed', async () => {
        mockConversationsClient.deleteOwn.mockResolvedValueOnce({
          deleted: ['p-1'],
          held: [{ id: 'p-held', title: 'Held' }],
        })
        useChatStore.setState({
          currentUserId: 'user-1',
          conversations: [makeConv('p-1', 'user-1', null), makeConv('p-held', 'user-1', null)],
        })

        const result = await useChatStore.getState().deleteAllConversations({ projectId: null })

        expect(result.held).toEqual([{ id: 'p-held', title: 'Held' }])
        expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual(['p-held'])
      })

      test('a refused delete-all keeps every row and rejects with the reason', async () => {
        const refusal = Object.assign(new Error('Internal server error'), { status: 500 })
        mockConversationsClient.deleteOwn.mockRejectedValueOnce(refusal)
        useChatStore.setState({
          currentUserId: 'user-1',
          conversations: [makeConv('p-1', 'user-1', null), makeConv('p-2', 'user-1', null)],
        })

        await expect(useChatStore.getState().deleteAllConversations({ projectId: null })).rejects.toBe(refusal)

        expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual(['p-1', 'p-2'])
      })

      test("drops drafts for exactly the deleted chats, keeping other chats' drafts", async () => {
        mockConversationsClient.deleteOwn.mockResolvedValueOnce({ deleted: ['a-1'], held: [] })
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: 'proj-a',
          conversations: [makeConv('a-1', 'user-1', 'proj-a'), makeConv('b-1', 'user-1', 'proj-b')],
          currentConversation: null,
        })
        useChatStore.getState().setComposerDraft('a-1', 'in scope')
        useChatStore.getState().setComposerDraft('b-1', 'other project')

        await useChatStore.getState().deleteAllConversations({ projectId: 'proj-a' })

        expect('a-1' in useChatStore.getState().composerDrafts).toBe(false)
        expect(useChatStore.getState().getComposerDraft('b-1')).toBe('other project')
      })
    })

    describe('setProjectId guard (stale state / URL restore)', () => {
      test('clears a persisted current conversation from another project when entering a project', () => {
        const foreign = makeConv('b-1', 'user-1', 'proj-b')
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: null,
          conversations: [foreign],
          currentConversation: foreign,
        })

        useChatStore.getState().setProjectId('proj-a')

        const state = useChatStore.getState()
        expect(state.projectId).toBe('proj-a')
        expect(state.currentConversation).toBeNull()
        expect(state.conversations.map((c) => c.id)).toEqual(['b-1'])
      })

      test('keeps a matching or unscoped current conversation', () => {
        const own = makeConv('a-1', 'user-1', 'proj-a')
        useChatStore.setState({
          currentUserId: 'user-1',
          currentConversation: own,
          conversations: [own],
        })

        useChatStore.getState().setProjectId('proj-a')
        expect(useChatStore.getState().currentConversation?.id).toBe('a-1')

        const legacy = makeConv('legacy', 'user-1', null)
        useChatStore.setState({ currentConversation: legacy, conversations: [legacy] })

        useChatStore.getState().setProjectId('proj-a')
        expect(useChatStore.getState().currentConversation?.id).toBe('legacy')
      })

      test('switching to Persönlich drops the project’s open chat, so its thread never shows on the personal side', () => {
        const project = makeConv('a-1', 'user-1', 'proj-a')
        useChatStore.setState({ currentUserId: 'user-1', projectId: 'proj-a', currentConversation: project, conversations: [project] })

        useChatStore.getState().enterSide(null)

        const state = useChatStore.getState()
        expect(state.projectId).toBeNull()
        expect(state.currentConversation).toBeNull()
        expect(state.conversations.map((c) => c.id)).toEqual(['a-1'])
      })

      test('switching to a project drops the open personal chat, and each side keeps a chat of its own', () => {
        const personal = makeConv('me-1', 'user-1', null)
        useChatStore.setState({ currentUserId: 'user-1', projectId: null, currentConversation: personal, conversations: [personal] })

        useChatStore.getState().enterSide('proj-a')
        expect(useChatStore.getState().currentConversation).toBeNull()

        const own = makeConv('a-1', 'user-1', 'proj-a')
        useChatStore.setState({ currentConversation: own, conversations: [personal, own] })
        useChatStore.getState().enterSide('proj-a')
        expect(useChatStore.getState().currentConversation?.id).toBe('a-1')
      })

      test('switching back to a side reopens the chat left open there', () => {
        const project = makeConv('a-1', 'user-1', 'proj-a')
        const personal = makeConv('me-1', 'user-1', null)
        useChatStore.setState({ currentUserId: 'user-1', projectId: 'proj-a', currentConversation: project, conversations: [project, personal] })

        useChatStore.getState().enterSide(null)
        expect(useChatStore.getState().currentConversation).toBeNull()
        useChatStore.getState().selectConversation('me-1')

        useChatStore.getState().enterSide('proj-a')
        expect(useChatStore.getState().currentConversation?.id).toBe('a-1')

        useChatStore.getState().enterSide(null)
        expect(useChatStore.getState().currentConversation?.id).toBe('me-1')
      })

      test('each project remembers its own chat, and a chat no longer there opens a new one', () => {
        const a = makeConv('a-1', 'user-1', 'proj-a')
        const b = makeConv('b-1', 'user-1', 'proj-b')
        useChatStore.setState({ currentUserId: 'user-1', projectId: 'proj-a', currentConversation: a, conversations: [a, b] })

        useChatStore.getState().enterSide('proj-b')
        expect(useChatStore.getState().currentConversation).toBeNull()
        useChatStore.getState().selectConversation('b-1')

        useChatStore.setState({ conversations: [b] })
        useChatStore.getState().enterSide('proj-a')
        expect(useChatStore.getState().currentConversation).toBeNull()
        expect(useChatStore.getState().lastChatBySide).toEqual({ 'proj-a': 'a-1', 'proj-b': 'b-1' })
      })

      test('another person’s remembered chat is never reopened', () => {
        const theirs = makeConv('a-1', 'user-2', 'proj-a')
        const mine = makeConv('me-1', 'user-1', null)
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: null,
          currentConversation: mine,
          conversations: [theirs, mine],
          lastChatBySide: { 'proj-a': 'a-1' },
        })

        useChatStore.getState().enterSide('proj-a')
        expect(useChatStore.getState().currentConversation).toBeNull()
      })

      test('leaving the project context (null) never clears the current conversation', () => {
        const own = makeConv('a-1', 'user-1', 'proj-a')
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: 'proj-a',
          currentConversation: own,
          conversations: [own],
        })

        useChatStore.getState().setProjectId(null)

        expect(useChatStore.getState().currentConversation?.id).toBe('a-1')
      })
    })
  })
})
