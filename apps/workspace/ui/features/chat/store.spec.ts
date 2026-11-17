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

  describe('initial state', () => {
    test('has correct default values', () => {
      const state = useChatStore.getState()

      expect(state.currentUserId).toBeNull()
      expect(state.currentConversation).toBeNull()
      expect(state.conversations).toEqual([])
      expect(state.isStreaming).toBe(false)
      expect(state.isLoading).toBe(false)
      expect(state.currentUserMessageId).toBeNull()
      expect(state.pendingInteraction).toBeNull()
    })
  })

  describe('setCurrentUser', () => {
    test('sets user ID', () => {
      useChatStore.getState().setCurrentUser('user-1')

      expect(useChatStore.getState().currentUserId).toBe('user-1')
    })

    test('auto-selects first conversation for new user', () => {
      const conv1: Conversation = {
        id: 'conv-1',
        userId: 'user-1',
        title: 'Conv 1',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const conv2: Conversation = {
        id: 'conv-2',
        userId: 'user-2',
        title: 'Conv 2',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: conv1,
        conversations: [conv1, conv2],
      })

      useChatStore.getState().setCurrentUser('user-2')

      expect(useChatStore.getState().currentConversation).toEqual(conv2)
      expect(mockLayoutState.setEnabledDataSources).toHaveBeenCalledWith([
        'web_search',
        'knowledge_base',
      ])
    })

    test('clears current conversation when logging out', () => {
      const conv: Conversation = {
        id: 'conv-1',
        userId: 'user-1',
        title: 'Conv 1',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: conv,
        conversations: [conv],
      })

      useChatStore.getState().setCurrentUser(null)

      expect(useChatStore.getState().currentConversation).toBeNull()
    })
  })

  describe('getUserConversations', () => {
    test('returns empty array when no user', () => {
      useChatStore.setState({
        currentUserId: null,
        conversations: [
          {
            id: 'conv-1',
            userId: 'user-1',
            title: 'Conv',
            messages: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      })

      expect(useChatStore.getState().getUserConversations()).toEqual([])
    })

    test('returns only conversations for current user', () => {
      const conv1: Conversation = {
        id: 'conv-1',
        userId: 'user-1',
        title: 'User 1 Conv',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const conv2: Conversation = {
        id: 'conv-2',
        userId: 'user-2',
        title: 'User 2 Conv',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      useChatStore.setState({
        currentUserId: 'user-1',
        conversations: [conv1, conv2],
      })

      const result = useChatStore.getState().getUserConversations()

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('conv-1')
    })
  })

  describe('createConversation', () => {
    test('creates new conversation for current user', () => {
      useChatStore.setState({ currentUserId: 'user-1' })

      const conv = useChatStore.getState().createConversation()

      expect(conv.userId).toBe('user-1')
      expect(conv.title).toBe('')
      expect(conv.messages).toEqual([])
      expect(useChatStore.getState().currentConversation).toEqual(conv)
      expect(useChatStore.getState().conversations).toContainEqual(conv)
    })

    test('enables all available data sources for new conversations by default', () => {
      useChatStore.setState({ currentUserId: 'user-1' })

      const conv = useChatStore.getState().createConversation()

      expect(conv.enabledDataSourceIds).toEqual(['web_search', 'knowledge_base'])
      expect(mockLayoutState.setEnabledDataSources).toHaveBeenCalledWith([
        'web_search',
        'knowledge_base',
      ])
    })

    test('throws when no user is authenticated', () => {
      expect(() => useChatStore.getState().createConversation()).toThrow(
        'Cannot create conversation without authenticated user'
      )
    })

  })

  describe('ensureSession', () => {
    test('returns existing conversation ID', () => {
      const conv: Conversation = {
        id: 'existing-conv',
        userId: 'user-1',
        title: 'Existing',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useChatStore.setState({ currentUserId: 'user-1', currentConversation: conv })

      const result = useChatStore.getState().ensureSession()

      expect(result).toBe('existing-conv')
    })

    test('creates new conversation if none exists', () => {
      useChatStore.setState({ currentUserId: 'user-1', currentConversation: null })

      const result = useChatStore.getState().ensureSession()

      expect(result).toBeDefined()
      expect(useChatStore.getState().currentConversation).not.toBeNull()
    })

    test('returns undefined when no user', () => {
      useChatStore.setState({ currentUserId: null, currentConversation: null })

      const result = useChatStore.getState().ensureSession()

      expect(result).toBeUndefined()
    })
  })

  describe('addUserMessage', () => {
    test('adds user message to current conversation', () => {
      const conv: Conversation = {
        id: 'conv-1',
        userId: 'user-1',
        title: '',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: conv,
        conversations: [conv],
      })

      const msg = useChatStore.getState().addUserMessage('Hello')

      expect(msg.role).toBe('user')
      expect(msg.content).toBe('Hello')
      expect(useChatStore.getState().currentConversation?.messages).toHaveLength(1)
    })

    test('updates title on first message', () => {
      const conv: Conversation = {
        id: 'conv-1',
        userId: 'user-1',
        title: '',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: conv,
        conversations: [conv],
      })

      useChatStore.getState().addUserMessage('What is the capital of France?')

      expect(useChatStore.getState().currentConversation?.title).toBe(
        'What is the capital of France?'
      )
    })

    test('updates title on first user message when file upload status messages exist', () => {
      const conv: Conversation = {
        id: 'conv-1',
        userId: 'user-1',
        title: '',
        messages: [
          {
            id: 'status-1',
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            messageType: 'status',
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: conv,
        conversations: [conv],
      })

      useChatStore.getState().addUserMessage('Summarize my document')

      expect(useChatStore.getState().currentConversation?.title).toBe('Summarize my document')
    })

    test('truncates long titles to 50 characters', () => {
      const conv: Conversation = {
        id: 'conv-1',
        userId: 'user-1',
        title: '',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: conv,
        conversations: [conv],
      })

      const longMessage = 'A'.repeat(100)
      useChatStore.getState().addUserMessage(longMessage)

      expect(useChatStore.getState().currentConversation?.title).toBe('A'.repeat(50) + '...')
    })

    test('creates conversation if none exists', () => {
      mockLayoutState.enabledDataSourceIds = ['web_search', 'knowledge_base']
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: null,
        conversations: [],
      })

      useChatStore.getState().addUserMessage('Hello')

      expect(useChatStore.getState().currentConversation).not.toBeNull()
      expect(useChatStore.getState().conversations).toHaveLength(1)
      expect(useChatStore.getState().currentConversation?.enabledDataSourceIds).toEqual([
        'web_search',
        'knowledge_base',
      ])
    })

    test('throws when no user authenticated', () => {
      useChatStore.setState({ currentUserId: null, currentConversation: null })

      expect(() => useChatStore.getState().addUserMessage('Hello')).toThrow(
        'Cannot create conversation without authenticated user'
      )
    })

    test('sets loading state and updates currentUserMessageId', () => {
      const conv: Conversation = {
        id: 'conv-1',
        userId: 'user-1',
        title: '',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: conv,
        conversations: [conv],
        currentUserMessageId: 'old-msg-id',
      })

      const message = useChatStore.getState().addUserMessage('Hello')

      expect(useChatStore.getState().isLoading).toBe(true)
      expect(useChatStore.getState().currentUserMessageId).toBe(message.id)
    })
  })

  describe('error cards', () => {
    const setupConversation = () => {
      const conv: Conversation = {
        id: 'conv-1',
        userId: 'user-1',
        title: 'Test',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: conv,
        conversations: [conv],
      })
      return conv
    }

    test('addErrorCard adds error message with defaults from registry', () => {
      setupConversation()

      useChatStore.getState().addErrorCard('connection.lost')

      const messages = useChatStore.getState().currentConversation?.messages
      expect(messages).toHaveLength(1)
      expect(messages?.[0].messageType).toBe('error')
      expect(messages?.[0].errorData?.errorCode).toBe('connection.lost')
    })

    test('addErrorCard uses custom message', () => {
      setupConversation()

      useChatStore
        .getState()
        .addErrorCard('connection.failed', 'Custom error message', 'Details here')

      const msg = useChatStore.getState().currentConversation?.messages[0]
      expect(msg?.content).toBe('Custom error message')
      expect(msg?.errorData?.errorDetails).toBe('Details here')
    })

    test('dismissErrorCard removes error message', () => {
      setupConversation()
      useChatStore.getState().addErrorCard('system.unknown')
      const msgId = useChatStore.getState().currentConversation!.messages[0].id!

      useChatStore.getState().dismissErrorCard(msgId)

      expect(useChatStore.getState().currentConversation?.messages).toHaveLength(0)
    })
  })
})
