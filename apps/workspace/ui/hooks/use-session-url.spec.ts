import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionUrl } from './use-session-url'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import type { ChatMessage, Conversation } from '@/features/chat/types'

const mockRouter = {
  replace: vi.fn(),
  push: vi.fn(),
}

const mockPathname = '/'
let mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}))

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'c-1',
  userId: 'user-1',
  title: 'Rettungswege',
  messages: [],
  createdAt: new Date('2026-07-29T08:00:00Z'),
  updatedAt: new Date('2026-07-29T08:00:00Z'),
  ...overrides,
})

const message = (): ChatMessage => ({
  id: 'm-1',
  role: 'user',
  content: 'Wie breit muss der Fluchtweg sein?',
  timestamp: new Date('2026-07-29T08:00:00Z'),
})

const mockChatStore = {
  currentConversation: null as Conversation | null,
  currentUserId: null as string | null,
  conversations: [] as Conversation[],
  serverConversationsLoaded: true as boolean,
  selectConversation: vi.fn(),
  getUserConversations: vi.fn((): Conversation[] => []),
} satisfies DeepPartial<ChatStoreWithHydration>

vi.mock('@/features/chat/store', () => ({
  useChatStore: vi.fn((selector?: StoreSelector<ChatStoreWithHydration>) =>
    selector ? selector(asStoreState<ChatStoreWithHydration>(mockChatStore)) : mockChatStore
  ),
}))

describe('useSessionUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    mockChatStore.currentConversation = null
    mockChatStore.currentUserId = null
    mockChatStore.conversations = []
    mockChatStore.serverConversationsLoaded = true
    mockChatStore.getUserConversations.mockReturnValue([])
  })

  describe('initialization', () => {
    test('returns updateSessionUrl and clearSessionUrl functions', () => {
      const { result } = renderHook(() => useSessionUrl({ isAuthenticated: false }))

      expect(result.current.updateSessionUrl).toBeInstanceOf(Function)
      expect(result.current.clearSessionUrl).toBeInstanceOf(Function)
    })
  })

  describe('updateSessionUrl', () => {
    test('adds session parameter to URL', () => {
      const { result } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      act(() => {
        result.current.updateSessionUrl('session-123')
      })

      expect(mockRouter.replace).toHaveBeenCalledWith('/?session=session-123')
    })

    test('removes session parameter when null', () => {
      mockSearchParams = new URLSearchParams('session=old-session')

      const { result } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      act(() => {
        result.current.updateSessionUrl(null)
      })

      expect(mockRouter.replace).toHaveBeenCalledWith('/')
    })

    test('preserves other query parameters', () => {
      mockSearchParams = new URLSearchParams('other=param')

      const { result } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      act(() => {
        result.current.updateSessionUrl('session-123')
      })

      expect(mockRouter.replace).toHaveBeenCalledWith('/?other=param&session=session-123')
    })
  })

  describe('clearSessionUrl', () => {
    test('removes session parameter from URL', () => {
      mockSearchParams = new URLSearchParams('session=old-session')

      const { result } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      act(() => {
        result.current.clearSessionUrl()
      })

      expect(mockRouter.replace).toHaveBeenCalledWith('/')
    })
  })

  describe('initial URL sync', () => {
    test('selects conversation when session exists in URL', async () => {
      mockSearchParams = new URLSearchParams('session=session-123')
      mockChatStore.currentUserId = 'user-1'
      mockChatStore.getUserConversations.mockReturnValue([
        conversation({ id: 'session-123', title: 'Test Session' }),
      ])

      renderHook(() => useSessionUrl({ isAuthenticated: true }))

      expect(mockChatStore.selectConversation).toHaveBeenCalledWith('session-123')
    })

    test('clears invalid session from URL', async () => {
      mockSearchParams = new URLSearchParams('session=invalid-session')
      mockChatStore.currentUserId = 'user-1'
      mockChatStore.getUserConversations.mockReturnValue([
        conversation({ id: 'session-123', title: 'Test Session' }),
      ])

      renderHook(() => useSessionUrl({ isAuthenticated: true }))

      expect(mockRouter.replace).toHaveBeenCalledWith('/')
    })

    test('holds an unknown session id until the server list has been fetched', () => {
      mockSearchParams = new URLSearchParams('session=s_shared_1')
      mockChatStore.currentUserId = 'user-anna'
      mockChatStore.serverConversationsLoaded = false
      mockChatStore.getUserConversations.mockReturnValue([])

      const { rerender } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      expect(mockRouter.replace).not.toHaveBeenCalled()
      expect(mockChatStore.selectConversation).not.toHaveBeenCalled()

      mockChatStore.conversations = [conversation({ id: 's_shared_1' })]
      mockChatStore.serverConversationsLoaded = true
      mockChatStore.getUserConversations.mockReturnValue([
        conversation({ id: 's_shared_1', title: 'Brandschutz Halle 3' }),
      ])
      rerender()

      expect(mockChatStore.selectConversation).toHaveBeenCalledWith('s_shared_1')
      expect(mockRouter.replace).not.toHaveBeenCalled()
    })

    test('still clears a genuinely stale id once the server has answered', () => {
      mockSearchParams = new URLSearchParams('session=s_deleted')
      mockChatStore.currentUserId = 'user-anna'
      mockChatStore.serverConversationsLoaded = false

      const { rerender } = renderHook(() => useSessionUrl({ isAuthenticated: true }))
      expect(mockRouter.replace).not.toHaveBeenCalled()

      mockChatStore.serverConversationsLoaded = true
      mockChatStore.conversations = [conversation({ id: 'other' })]
      rerender()

      expect(mockRouter.replace).toHaveBeenCalledWith('/')
    })

    test('does nothing when not authenticated', async () => {
      mockSearchParams = new URLSearchParams('session=session-123')
      mockChatStore.currentUserId = 'user-1'
      mockChatStore.getUserConversations.mockReturnValue([
        conversation({ id: 'session-123', title: 'Test Session' }),
      ])

      renderHook(() => useSessionUrl({ isAuthenticated: false }))

      expect(mockChatStore.selectConversation).not.toHaveBeenCalled()
    })

    test('does nothing when no currentUserId', async () => {
      mockSearchParams = new URLSearchParams('session=session-123')
      mockChatStore.currentUserId = null
      mockChatStore.getUserConversations.mockReturnValue([
        conversation({ id: 'session-123', title: 'Test Session' }),
      ])

      renderHook(() => useSessionUrl({ isAuthenticated: true }))

      expect(mockChatStore.selectConversation).not.toHaveBeenCalled()
    })

    test('does nothing when no session in URL', async () => {
      mockSearchParams = new URLSearchParams()
      mockChatStore.currentUserId = 'user-1'

      renderHook(() => useSessionUrl({ isAuthenticated: true }))

      expect(mockChatStore.selectConversation).not.toHaveBeenCalled()
    })
  })

  describe('resuming the last session when the URL carries none', () => {
    const conv = (over: Partial<Conversation> = {}): Conversation =>
      conversation({ updatedAt: new Date(Date.now() - 60_000), messages: [message()], ...over })

    test('opens the most recent session and puts it back in the URL', () => {
      mockChatStore.currentUserId = 'u-1'
      mockChatStore.getUserConversations.mockReturnValue([conv({ id: 'recent' })])

      renderHook(() => useSessionUrl({ isAuthenticated: true }))

      expect(mockChatStore.selectConversation).toHaveBeenCalledWith('recent')
      expect(mockRouter.replace).toHaveBeenCalledWith('/?session=recent')
    })

    test('leaves a stale session alone — a new day starts fresh', () => {
      mockChatStore.currentUserId = 'u-1'
      mockChatStore.getUserConversations.mockReturnValue([
        conv({ id: 'stale', updatedAt: new Date(Date.now() - 36 * 60 * 60 * 1000) }),
      ])

      renderHook(() => useSessionUrl({ isAuthenticated: true }))

      expect(mockChatStore.selectConversation).not.toHaveBeenCalled()
      expect(mockRouter.replace).not.toHaveBeenCalled()
    })

    test('does not resume for a signed-out visitor', () => {
      mockChatStore.currentUserId = null
      mockChatStore.getUserConversations.mockReturnValue([conv({ id: 'recent' })])

      renderHook(() => useSessionUrl({ isAuthenticated: false }))

      expect(mockChatStore.selectConversation).not.toHaveBeenCalled()
    })
  })

  describe('URL sync on conversation change', () => {
    test('updates URL when current conversation changes', async () => {
      mockChatStore.currentUserId = 'user-1'
      mockChatStore.currentConversation = conversation({ id: 'session-123' })

      const { rerender } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      rerender()

      mockChatStore.currentConversation = conversation({ id: 'session-456' })
      rerender()

      expect(mockRouter.replace).toHaveBeenCalledWith('/?session=session-456')
    })

    test('clears URL when conversation is cleared', async () => {
      mockSearchParams = new URLSearchParams('session=session-123')
      mockChatStore.currentUserId = 'user-1'
      mockChatStore.currentConversation = conversation({ id: 'session-123' })
      mockChatStore.getUserConversations.mockReturnValue([
        conversation({ id: 'session-123', title: 'Test Session' }),
      ])

      const { rerender } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      rerender()

      mockChatStore.currentConversation = null
      rerender()

      expect(mockRouter.replace).toHaveBeenCalledWith('/')
    })
  })
})
