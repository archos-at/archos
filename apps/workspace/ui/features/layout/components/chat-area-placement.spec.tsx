import { render, screen } from '@/test-utils'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { ChatArea } from './ChatArea'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import type { ChatMessage } from '@/features/chat/types'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import { initialTurnView, type TurnView } from '@/lib/turns/turn-fold'
import { useAnswerRevealStore } from '@/features/chat/stores/answer-reveal-store'
import { useChatStore } from '@/features/chat/store'

type ChatStoreFixture = DeepPartial<ChatStoreWithHydration>
type MessageFixture = DeepPartial<ChatMessage>

const mockRespondToPrompt = vi.fn()
const mockDismissErrorCard = vi.fn()
const mockSetComposerPrefill = vi.fn()

const mockChatThinking = vi.fn((_props: unknown) => (
  <div data-testid="chat-thinking">Thinking...</div>
))

const mockUserName: string | null = 'Max Mustermann'

vi.mock('@/adapters/auth', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: mockUserName ? { id: 'user-1', name: mockUserName } : null,
  })),
}))

let mockProjectId: string | null = null

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

let mockSpectated: { turn: TurnView | null; live: boolean } = { turn: null, live: false }

vi.mock('@/features/collaboration/hooks/use-spectated-turn', () => ({
  useSpectatedTurn: () => mockSpectated,
}))

const spectatedTurn = (overrides: Partial<TurnView> = {}): TurnView => ({
  ...initialTurnView('turn-1', 'conv-1'),
  ...overrides,
})

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

describe('ChatArea — placement and phase across inputs', () => {
  const ANNA = 'user_anna'
  const setPending = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSharedThread = { ...INERT_SHARED_THREAD }
    mockSpectated = { turn: null, live: false }
    mockProjectId = null
    useAnswerRevealStore.setState({ revealingId: null })
  })

  const use = (state: ChatStoreFixture) =>
    vi
      .mocked(useChatStore)
      .mockImplementation((selector?: StoreSelector<ChatStoreWithHydration>) =>
        selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      )
  const thread = (id: string, messages: MessageFixture[], extra: ChatStoreFixture = {}): ChatStoreFixture => ({
    currentConversation: { id, messages },
    isLoading: false,
    isStreaming: false,
    hasHydrated: true,
    currentUserMessageId: null,
    pendingMessagesFor: null,
    setPendingMessagesFor: setPending,
    respondToPrompt: mockRespondToPrompt,
    dismissErrorCard: mockDismissErrorCard,
    setComposerPrefill: mockSetComposerPrefill,
    retryLastUserMessage: vi.fn(),
    ...extra,
  })
  const asked = (id: string, authorUserId?: string): MessageFixture => ({
    id,
    role: 'user',
    messageType: 'user',
    content: `question ${id}`,
    ...(authorUserId ? { authorUserId } : {}),
  })
  const answered = (id: string): MessageFixture => ({
    id,
    role: 'assistant',
    messageType: 'agent_response',
    content: 'Antwort.',
  })

  test("a shared thread's first read names the thread loading in the store, which the layout reads", () => {
    mockSharedThread = { ...INERT_SHARED_THREAD, shared: true, loading: true }
    use(thread('c1', []))
    const { rerender } = render(<ChatArea isAuthenticated canCollaborate onSignIn={vi.fn()} />)
    expect(setPending).toHaveBeenCalledWith('c1')

    mockSharedThread = { ...INERT_SHARED_THREAD, shared: true, loading: false }
    use(thread('c1', [asked('m1')], { pendingMessagesFor: 'c1' }))
    rerender(<ChatArea isAuthenticated canCollaborate onSignIn={vi.fn()} />)
    expect(setPending).toHaveBeenLastCalledWith(null)
  })

  test('a thread the store is already fetching is left to that fetch to release', () => {
    mockSharedThread = { ...INERT_SHARED_THREAD, shared: true, loading: true }
    use(thread('c1', [], { pendingMessagesFor: 'c1' }))
    const { rerender } = render(<ChatArea isAuthenticated canCollaborate onSignIn={vi.fn()} />)

    mockSharedThread = { ...INERT_SHARED_THREAD, shared: true, loading: false }
    rerender(<ChatArea isAuthenticated canCollaborate onSignIn={vi.fn()} />)
    expect(setPending).not.toHaveBeenCalled()
  })

  test("watches the composer's height on its ancestors before the composer has measured itself", () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe')
    try {
      use(thread('c1', [asked('m1')]))
      render(
        <div data-testid="column">
          <ChatArea isAuthenticated onSignIn={vi.fn()} />
        </div>
      )
      const column = screen.getByTestId('column')
      expect(column.style.getPropertyValue('--composer-h')).toBe('')
      expect(observe).toHaveBeenCalledWith(column, { attributes: true, attributeFilter: ['style'] })
    } finally {
      observe.mockRestore()
    }
  })

  describe("a colleague's turns, watched live", () => {
    let questionTop = 300
    let rect: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      questionTop = 300
      mockSharedThread = {
        ...INERT_SHARED_THREAD,
        shared: true,
        turnInFlight: { actorUserId: ANNA },
        authorOf: (userId?: string | null) =>
          userId === ANNA ? { userId: ANNA, name: 'Anna Berger' } : null,
      }
      mockSpectated = { turn: spectatedTurn(), live: true }
      rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: Element
      ) {
        const top = this.id === 'message-m2' ? questionTop : 0
        const bottom = this.classList.contains('overflow-y-auto') ? 900 : top
        return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }
      })
    })
    afterEach(() => rect.mockRestore())

    const anchored = () =>
      Array.from(document.querySelectorAll('[data-chat-anchor="true"]')).map((el) => el.id)

    test('anchors the next turn too, for a reader who watched the last one to its end', () => {
      use(thread('s1', [asked('m1', ANNA)]))
      const { rerender } = render(<ChatArea isAuthenticated canCollaborate onSignIn={vi.fn()} />)
      expect(anchored()).toEqual(['message-m1'])

      use(thread('s1', [asked('m1', ANNA), answered('a1'), asked('m2', ANNA)]))
      rerender(<ChatArea isAuthenticated canCollaborate onSignIn={vi.fn()} />)
      expect(anchored()).toEqual(['message-m2'])
    })

    test('leaves a reader who scrolled up to read where they are', () => {
      questionTop = 1500
      use(thread('s1', [asked('m1', ANNA)]))
      const { rerender } = render(<ChatArea isAuthenticated canCollaborate onSignIn={vi.fn()} />)

      use(thread('s1', [asked('m1', ANNA), answered('a1'), asked('m2', ANNA)]))
      rerender(<ChatArea isAuthenticated canCollaborate onSignIn={vi.fn()} />)
      expect(anchored()).toEqual(['message-m1'])
    })
  })

  test('a deep-linked thread switched away from and back to is placed like any other', () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2000)
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900)
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      const top = this.id.startsWith('message-') ? 5000 : 0
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }
    })
    window.history.replaceState(null, '', '/chat?session=A#message-a1')
    try {
      use(thread('A', [asked('a1')]))
      const { rerender } = render(<ChatArea isAuthenticated onSignIn={vi.fn()} />)
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled()

      use(thread('B', [asked('b1')]))
      rerender(<ChatArea isAuthenticated onSignIn={vi.fn()} />)
      const viewport = screen.getByRole('region', { name: /messages/i })
      viewport.scrollTop = 0

      use(thread('A', [asked('a1')]))
      rerender(<ChatArea isAuthenticated onSignIn={vi.fn()} />)
      expect(viewport.scrollTop).toBe(1100)
    } finally {
      window.history.replaceState(null, '', '/')
      Element.prototype.scrollIntoView = originalScrollIntoView
      scrollHeight.mockRestore()
      clientHeight.mockRestore()
      rect.mockRestore()
    }
  })
})
