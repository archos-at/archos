import { act, render, screen } from '@/test-utils'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatArea } from './ChatArea'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { TurnView } from '@/lib/turns/turn-fold'
import { useChatStore } from '@/features/chat/store'

type ChatStoreFixture = DeepPartial<ChatStoreWithHydration>

const mockRespondToPrompt = vi.fn()
const mockDismissErrorCard = vi.fn()
const mockSetComposerPrefill = vi.fn()

const mockChatThinking = vi.fn((_props: unknown) => (
  <div data-testid="chat-thinking">Thinking...</div>
))

const mockGlideScrollTo = vi.fn(
  (_container: HTMLElement, _top: number, _options: { reducedMotion: boolean }) => ({ stop: vi.fn() })
)
vi.mock('@/features/layout/lib/glide-scroll', () => ({
  glideScrollTo: (container: HTMLElement, top: number, options: { reducedMotion: boolean }) =>
    mockGlideScrollTo(container, top, options),
}))

let mockUserName: string | null = 'Max Mustermann'

vi.mock('@/adapters/auth', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: mockUserName ? { id: 'user-1', name: mockUserName } : null,
  })),
}))

let mockProjectId: string | null = null
let mockBimModels: { status: string }[] | null = null

vi.mock('@/features/bim/hooks/use-bim-model', () => ({
  useProjectBimModels: (projectId: string | null) => ({
    data: projectId ? mockBimModels : null,
    isLoading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('@/features/chat', () => ({
  AgentPrompt: ({ content }: { content: string }) => (
    <div data-testid="agent-prompt">{content}</div>
  ),
  AgentResponse: ({ content }: { content: string }) => (
    <div data-testid="agent-response">{content}</div>
  ),
  ErrorBanner: ({ message }: { message: string }) => <div data-testid="error-card">{message}</div>,
  UserMessage: ({
    content,
    author,
    grouped,
  }: {
    content: string
    author?: { name?: string | null; isYou?: boolean }
    grouped?: boolean
  }) => (
    <div
      data-testid="user-message"
      data-author={author ? (author.isYou ? 'you' : (author.name ?? 'unknown')) : undefined}
      data-grouped={grouped ? 'true' : undefined}
    >
      {content}
    </div>
  ),
  ChatThinking: (props: unknown) => mockChatThinking(props),
  useElapsedSeconds: () => 0,
  formatElapsed: (seconds: number) => `${seconds}s`,
}))

vi.mock('@/features/chat/store', () => ({
  useChatStore: vi.fn((selector?: StoreSelector<ChatStoreWithHydration>) => {
    const state: ChatStoreFixture = {
      currentConversation: { messages: [] },
      projectId: mockProjectId,
      isLoading: false,
      isStreaming: false,
      hasHydrated: true,
      respondToPrompt: mockRespondToPrompt,
      dismissErrorCard: mockDismissErrorCard,
      setComposerPrefill: mockSetComposerPrefill,
    }
    return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
  }),
}))

const mockClearTurnInFlight = vi.fn(() => {
  mockSharedThread = { ...mockSharedThread, turnInFlight: null }
})
const mockNoteTurnActivity = vi.fn()

const INERT_SHARED_THREAD = {
  shared: false,
  myRole: null as 'viewer' | 'collaborator' | 'owner' | null,
  loading: false,
  connected: false,
  turnInFlight: null as { actorUserId: string | null } | null,
  typists: [] as Array<{ userId: string; name: string; profilePictureUrl?: string | null }>,
  participants: [] as Array<{ userId: string; name: string }>,
  unreadAfterMessageId: null as string | null,
  lastArrival: null as {
    messageId: string
    authorUserId: string | null
    authorName: string | null
  } | null,
  authorOf: (_userId?: string | null) => null as { userId: string; name: string } | null,
  engagement: 'ask' as 'ask' | 'mention',
  engagementSuggestion: null as 'ask' | 'mention' | null,
  setEngagement: async (_mode: 'ask' | 'mention') => true,
  refresh: () => {},
  clearTurnInFlight: mockClearTurnInFlight,
  noteTurnActivity: mockNoteTurnActivity,
}
let mockSharedThread = { ...INERT_SHARED_THREAD }

vi.mock('@/features/collaboration/hooks/use-shared-thread', () => ({
  useSharedThread: () => mockSharedThread,
}))

const mockSpectated: { turn: TurnView | null; live: boolean } = { turn: null, live: false }

vi.mock('@/features/collaboration/hooks/use-spectated-turn', () => ({
  useSpectatedTurn: () => mockSpectated,
}))

const mockAwaitingPending: Array<{
  id: string
  person: { userId: string; name: string }
  requestedBy: { userId: string; name: string } | null
  createdAt: string
  note?: string | null
}> = []

vi.mock('@/features/collaboration/hooks/use-sharing', () => ({
  useAwaitingState: vi.fn((_conversationId: string | null, enabled: boolean) => ({
    awaiting: enabled ? { pending: mockAwaitingPending, awaitingMe: false } : null,
    refresh: vi.fn(),
    release: vi.fn(),
  })),
}))

describe('ChatArea', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUserName = 'Max Mustermann'
    mockSharedThread = { ...INERT_SHARED_THREAD }
    mockProjectId = null
    mockBimModels = null
  })

  test('glides a newly sent user message to the top of the viewport, scrolling only the thread', async () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    const originalRect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const rect = originalRect.call(this)
      if (this.getAttribute('data-chat-anchor') !== 'true') return rect
      return { ...rect.toJSON(), top: 300, y: 300, bottom: 340, height: 40, toJSON: () => ({}) } as DOMRect
    }

    const makeState = (currentUserMessageId: string | null): ChatStoreFixture => ({
      currentConversation: {
        id: 'c1',
        messages: [{ id: 'user-1', role: 'user', content: 'My question', messageType: 'user' }],
      },
      isLoading: false,
      isStreaming: true,
      currentUserMessageId,
      hasHydrated: true,
      isRecoveryPending: false,
      respondToPrompt: mockRespondToPrompt,
      dismissErrorCard: mockDismissErrorCard,
      retryLastUserMessage: vi.fn(),
    })

    try {
      vi.mocked(useChatStore).mockImplementation(
        (selector?: StoreSelector<ChatStoreWithHydration>) =>
          selector ? selector(asStoreState<ChatStoreWithHydration>(makeState(null))) : makeState(null)
      )
      const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      expect(mockGlideScrollTo).not.toHaveBeenCalled()

      vi.mocked(useChatStore).mockImplementation(
        (selector?: StoreSelector<ChatStoreWithHydration>) =>
          selector
            ? selector(asStoreState<ChatStoreWithHydration>(makeState('user-1')))
            : makeState('user-1')
      )
      rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
      await new Promise((resolve) => requestAnimationFrame(resolve))

      expect(mockGlideScrollTo).toHaveBeenCalledTimes(1)
      const [container, , options] = mockGlideScrollTo.mock.calls[0]
      expect((container as HTMLElement).classList.contains('overflow-y-auto')).toBe(true)
      expect(options).toEqual({ reducedMotion: false })
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView
      Element.prototype.getBoundingClientRect = originalRect
    }
  })

  test('a sent question already where it would land is not scrolled', async () => {
    const makeState = (currentUserMessageId: string | null): ChatStoreFixture => ({
      currentConversation: {
        id: 'c1',
        messages: [{ id: 'user-1', role: 'user', content: 'My question', messageType: 'user' }],
      },
      isLoading: false,
      isStreaming: true,
      currentUserMessageId,
      hasHydrated: true,
      respondToPrompt: mockRespondToPrompt,
      dismissErrorCard: mockDismissErrorCard,
    })
    vi.mocked(useChatStore).mockImplementation((selector?: StoreSelector<ChatStoreWithHydration>) =>
      selector ? selector(asStoreState<ChatStoreWithHydration>(makeState(null))) : makeState(null)
    )
    const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    vi.mocked(useChatStore).mockImplementation((selector?: StoreSelector<ChatStoreWithHydration>) =>
      selector ? selector(asStoreState<ChatStoreWithHydration>(makeState('user-1'))) : makeState('user-1')
    )
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(mockGlideScrollTo).not.toHaveBeenCalled()
  })

  test('the anchor spacer holds only the unfilled room, and is not dropped when the answer lands', async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900)
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      const top = this.getAttribute('data-chat-anchor') === 'true' ? 100 : 400
      return {
        top,
        bottom: top,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }
    })

    try {
      const makeState = (
        currentUserMessageId: string | null,
        isStreaming: boolean
      ): ChatStoreFixture => ({
        currentConversation: {
          id: 'c1',
          messages: [{ id: 'user-1', role: 'user', content: 'My question', messageType: 'user' }],
        },
        isLoading: false,
        isStreaming,
        currentUserMessageId,
        hasHydrated: true,
        isRecoveryPending: false,
        respondToPrompt: mockRespondToPrompt,
        dismissErrorCard: mockDismissErrorCard,
        retryLastUserMessage: vi.fn(),
      })
      const use = (state: ChatStoreFixture) =>
        vi
          .mocked(useChatStore)
          .mockImplementation((selector?: StoreSelector<ChatStoreWithHydration>) =>
            selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
          )

      use(makeState(null, false))
      const { container, rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
      use(makeState('user-1', true))
      rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)

      const spacer = container.querySelector<HTMLElement>('[aria-hidden="true"][style*="min-height"]')
      expect(spacer?.style.minHeight).toBe('600px')

      use(makeState('user-1', false))
      rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      expect(spacer?.style.minHeight).toBe('600px')
    } finally {
      clientHeight.mockRestore()
      rect.mockRestore()
      Element.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  test('the anchor spacer shrinks as the list grows and refits when the viewport resizes', () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    let viewportHeight = 900
    let listEnd = 400
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(() => viewportHeight)
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      const top = this.getAttribute('data-chat-anchor') === 'true' ? 100 : listEnd
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }
    })
    const observed: Element[] = []
    let notify: ResizeObserverCallback = () => {}
    const originalResizeObserver = globalThis.ResizeObserver
    class RecordingResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notify = callback
      }
      observe(el: Element) {
        observed.push(el)
      }
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RecordingResizeObserver as unknown as typeof ResizeObserver
    const makeState = (currentUserMessageId: string | null): ChatStoreFixture => ({
      currentConversation: {
        id: 'c1',
        messages: [{ id: 'user-1', role: 'user', content: 'My question', messageType: 'user' }],
      },
      isLoading: false,
      isStreaming: true,
      currentUserMessageId,
      hasHydrated: true,
      isRecoveryPending: false,
      respondToPrompt: mockRespondToPrompt,
      dismissErrorCard: mockDismissErrorCard,
      retryLastUserMessage: vi.fn(),
    })
    const use = (state: ChatStoreFixture) =>
      vi
        .mocked(useChatStore)
        .mockImplementation((selector?: StoreSelector<ChatStoreWithHydration>) =>
          selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
        )
    const fire = (target: Element) =>
      act(() =>
        notify(
          [{ target, contentRect: { height: listEnd } } as unknown as ResizeObserverEntry],
          {} as ResizeObserver
        )
      )

    try {
      use(makeState(null))
      const { container, rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
      use(makeState('user-1'))
      rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
      const spacer = container.querySelector<HTMLElement>('[aria-hidden="true"][style*="min-height"]')
      expect(spacer?.style.minHeight).toBe('600px')

      const list = observed.find(
        (el) =>
          el.contains(screen.getByText('My question')) && !el.classList.contains('overflow-y-auto')
      )
      listEnd = 700
      fire(list as Element)
      expect(spacer?.style.minHeight).toBe('300px')

      const viewport = observed.find((el) => el.classList.contains('overflow-y-auto'))
      expect(viewport).toBeDefined()
      viewportHeight = 1200
      fire(viewport as Element)
      expect(spacer?.style.minHeight).toBe('600px')
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
      clientHeight.mockRestore()
      rect.mockRestore()
      Element.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  test('the resize observer watches the messages, not the spacer it refits', () => {
    const observed: Element[] = []
    const originalResizeObserver = globalThis.ResizeObserver
    class RecordingResizeObserver {
      observe(el: Element) {
        observed.push(el)
      }
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RecordingResizeObserver as unknown as typeof ResizeObserver
    const state: ChatStoreFixture = {
      currentConversation: {
        id: 'c1',
        messages: [{ id: 'user-1', role: 'user', content: 'My question', messageType: 'user' }],
      },
      isLoading: false,
      isStreaming: true,
      currentUserMessageId: null,
      hasHydrated: true,
      isRecoveryPending: false,
      respondToPrompt: mockRespondToPrompt,
      dismissErrorCard: mockDismissErrorCard,
      retryLastUserMessage: vi.fn(),
    }
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) =>
        selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
    )

    try {
      const { container } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
      const spacer = container.querySelector<HTMLElement>(
        '[aria-hidden="true"][style*="min-height"]'
      )
      expect(spacer).not.toBeNull()
      const list = observed.filter(
        (el) =>
          el.contains(screen.getByText('My question')) && !el.classList.contains('overflow-y-auto')
      )
      expect(list.length).toBeGreaterThan(0)
      for (const el of list) expect(el.contains(spacer)).toBe(false)
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
  })

  test('does not re-anchor an already-active user message on unrelated re-renders', () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView

    const state: ChatStoreFixture = {
      currentConversation: {
        id: 'c1',
        messages: [{ id: 'user-1', role: 'user', content: 'My question', messageType: 'user' }],
      },
      isLoading: false,
      isStreaming: true,
      currentUserMessageId: 'user-1',
      hasHydrated: true,
      isRecoveryPending: false,
      respondToPrompt: mockRespondToPrompt,
      dismissErrorCard: mockDismissErrorCard,
      retryLastUserMessage: vi.fn(),
    }

    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) =>
        selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
    )
    const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(mockGlideScrollTo).not.toHaveBeenCalled()

    Element.prototype.scrollIntoView = originalScrollIntoView
  })
})
