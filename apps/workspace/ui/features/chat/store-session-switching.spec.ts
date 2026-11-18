import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { useChatStore } from './store'
import {
  clearAwaitingServerMessages,
  markAwaitingServerMessages,
} from './stores/chat-storage'
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

  describe('upload-only session cleanup', () => {
    const uploadOnlyConv = (id: string): Conversation => ({
      id,
      userId: 'user-1',
      title: 'New chat',
      messages: [
        {
          id: 'banner-1',
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          messageType: 'status',
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    test('startNewSessionDraft removes upload-only session and discards documents', () => {
      const conv = uploadOnlyConv('upload-only-1')
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: conv,
        conversations: [conv],
      })

      useChatStore.getState().startNewSessionDraft()

      expect(mockDiscardSessionResources).toHaveBeenCalledWith('upload-only-1')
      expect(useChatStore.getState().conversations.some((c) => c.id === 'upload-only-1')).toBe(
        false
      )
      expect(useChatStore.getState().currentConversation).toBeNull()
    })

    test('startNewSessionDraft keeps session after user has chatted', () => {
      const conv: Conversation = {
        ...uploadOnlyConv('with-user'),
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: 'hello',
            timestamp: new Date(),
            messageType: 'user',
          },
        ],
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: conv,
        conversations: [conv],
      })

      useChatStore.getState().startNewSessionDraft()

      expect(mockDiscardSessionResources).not.toHaveBeenCalled()
      expect(useChatStore.getState().conversations.some((c) => c.id === 'with-user')).toBe(true)
    })

    test('startNewSessionDraft clears stale shallow streaming state', () => {
      const conv: Conversation = {
        ...uploadOnlyConv('stale-thinking'),
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: 'hello',
            timestamp: new Date(),
            messageType: 'user',
          },
        ],
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: conv,
        conversations: [conv],
        isStreaming: true,
        isLoading: true,
        currentUserMessageId: 'u1',
      })

      useChatStore.getState().startNewSessionDraft()

      expect(useChatStore.getState().isStreaming).toBe(false)
      expect(useChatStore.getState().isLoading).toBe(false)
      expect(useChatStore.getState().currentUserMessageId).toBeNull()
    })

    test('startNewSessionDraft clears leftover composerSubject', () => {
      useChatStore.setState({
        currentUserId: 'user-1',
        composerSubject: {
          resourceType: 'document',
          resourceId: 'doc-1',
          filename: 'plan.pdf',
        },
      })

      useChatStore.getState().startNewSessionDraft()

      expect(useChatStore.getState().composerSubject).toBeNull()
    })

    test('selectConversation removes prior upload-only session when switching away', () => {
      const uploadOnly = uploadOnlyConv('u-only')
      const other: Conversation = {
        id: 'other',
        userId: 'user-1',
        title: 'Other',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'hi',
            timestamp: new Date(),
            messageType: 'user',
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: uploadOnly,
        conversations: [uploadOnly, other],
      })

      useChatStore.getState().selectConversation('other')

      expect(mockDiscardSessionResources).toHaveBeenCalledWith('u-only')
      expect(useChatStore.getState().conversations.some((c) => c.id === 'u-only')).toBe(false)
      expect(useChatStore.getState().currentConversation?.id).toBe('other')
    })

    test('selectConversation keeps a conversation whose messages are still on the server', () => {
      markAwaitingServerMessages('evicted')
      const evicted: Conversation = {
        id: 'evicted',
        userId: 'user-1',
        title: 'Ältere Sitzung',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const other: Conversation = { ...evicted, id: 'other-3', title: 'Andere' }
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: evicted,
        conversations: [evicted, other],
      })

      useChatStore.getState().selectConversation('other-3')

      expect(useChatStore.getState().conversations.some((c) => c.id === 'evicted')).toBe(true)
      expect(mockConversationsClient.delete).not.toHaveBeenCalledWith('evicted')
      expect(mockDiscardSessionResources).not.toHaveBeenCalledWith('evicted')
      clearAwaitingServerMessages('evicted')
    })

    test('selectConversation does not remove upload-only session while files are uploading', async () => {
      const { useDocumentsStore } = await import('@/features/documents/store')
      const uploadOnly = uploadOnlyConv('u-busy')
      const other: Conversation = {
        id: 'other-2',
        userId: 'user-1',
        title: 'Other',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useDocumentsStore.setState({
        trackedFiles: [
          {
            id: 'tf-1',
            file: new File(['x'], 'x.txt'),
            fileName: 'x.txt',
            fileSize: 1,
            status: 'uploading',
            progress: 0,
            collectionName: 'u-busy',
            uploadedAt: new Date().toISOString(),
          },
        ],
      })
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: uploadOnly,
        conversations: [uploadOnly, other],
      })

      useChatStore.getState().selectConversation('other-2')

      expect(mockDiscardSessionResources).not.toHaveBeenCalled()
      expect(useChatStore.getState().conversations.some((c) => c.id === 'u-busy')).toBe(true)

      useDocumentsStore.setState({ trackedFiles: [] })
    })
  })

  describe('selectConversation', () => {
    test('selects conversation owned by current user', () => {
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
        conversations: [conv],
        currentConversation: null,
      })

      useChatStore.getState().selectConversation('conv-1')

      expect(useChatStore.getState().currentConversation).toEqual(conv)
    })

    test('does not select conversation owned by different user', () => {
      const conv: Conversation = {
        id: 'conv-1',
        userId: 'user-2',
        title: 'Conv 1',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        conversations: [conv],
        currentConversation: null,
      })

      useChatStore.getState().selectConversation('conv-1')

      expect(useChatStore.getState().currentConversation).toBeNull()
    })

    test('selectConversation without a subject file clears leftover composerSubject', () => {
      const conv: Conversation = {
        id: 'conv-1',
        userId: 'user-1',
        title: 'Conv',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        conversations: [conv],
        composerSubject: {
          resourceType: 'document',
          resourceId: 'doc-leftover',
          filename: 'plan.pdf',
        },
      })

      useChatStore.getState().selectConversation('conv-1')

      expect(useChatStore.getState().composerSubject).toBeNull()
    })

    test('restores a subject file without inventing a filename from the title', () => {
      const conv: Conversation = {
        id: 'conv-1',
        userId: 'user-1',
        title: 'fass das dokument zusammen',
        subjectResourceType: 'document',
        subjectResourceId: 'doc-aufsicht',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        conversations: [conv],
        composerSubject: null,
      })

      useChatStore.getState().selectConversation('conv-1')

      const subject = useChatStore.getState().composerSubject
      expect(subject).toEqual({
        resourceType: 'document',
        resourceId: 'doc-aufsicht',
        title: null,
      })
      expect(subject?.title).not.toBe(conv.title)
      expect(subject?.filename).toBeUndefined()
    })
  })
})
