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

    describe('deleteAllConversations scoping', () => {
      test("deletes only the current project's sessions and unscoped legacy sessions", () => {
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: 'proj-a',
          conversations: [
            makeConv('a-1', 'user-1', 'proj-a'),
            makeConv('a-2', 'user-1', 'proj-a'),
            makeConv('legacy', 'user-1', null),
            makeConv('b-1', 'user-1', 'proj-b'),
            makeConv('other-user', 'user-2', 'proj-a'),
          ],
          currentConversation: makeConv('a-1', 'user-1', 'proj-a'),
        })

        useChatStore.getState().deleteAllConversations()

        const state = useChatStore.getState()
        expect(state.conversations.map((c) => c.id).sort()).toEqual(['b-1', 'other-user'])
        expect(state.currentConversation).toBeNull()
      })

      test('keeps a foreign-project current conversation untouched', () => {
        const foreignCurrent = makeConv('b-1', 'user-1', 'proj-b')
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: 'proj-a',
          conversations: [makeConv('a-1', 'user-1', 'proj-a'), foreignCurrent],
          currentConversation: foreignCurrent,
        })

        useChatStore.getState().deleteAllConversations()

        const state = useChatStore.getState()
        expect(state.conversations.map((c) => c.id)).toEqual(['b-1'])
        expect(state.currentConversation?.id).toBe('b-1')
      })

      test("without a project context, deletes all of the user's sessions (org-wide view)", () => {
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: null,
          conversations: [
            makeConv('a-1', 'user-1', 'proj-a'),
            makeConv('b-1', 'user-1', 'proj-b'),
            makeConv('other-user', 'user-2', 'proj-a'),
          ],
          currentConversation: null,
        })

        useChatStore.getState().deleteAllConversations()

        expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual(['other-user'])
      })

      test("drops drafts for exactly the removed sessions, keeping other projects' drafts", () => {
        useChatStore.setState({
          currentUserId: 'user-1',
          projectId: 'proj-a',
          conversations: [
            makeConv('a-1', 'user-1', 'proj-a'),
            makeConv('legacy', 'user-1', null),
            makeConv('b-1', 'user-1', 'proj-b'),
          ],
          currentConversation: null,
        })
        useChatStore.getState().setComposerDraft('a-1', 'in scope')
        useChatStore.getState().setComposerDraft('legacy', 'legacy in scope')
        useChatStore.getState().setComposerDraft('b-1', 'other project')

        useChatStore.getState().deleteAllConversations()

        expect('a-1' in useChatStore.getState().composerDrafts).toBe(false)
        expect('legacy' in useChatStore.getState().composerDrafts).toBe(false)
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
