import { render, screen } from '@/test-utils'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatArea } from './ChatArea'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import type { ChatMessage } from '@/features/chat/types'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { UseSpectatedTurnOptions } from '@/features/collaboration/hooks/use-spectated-turn'
import { initialTurnView, type TurnView } from '@/lib/turns/turn-fold'
import { useChatStore } from '@/features/chat/store'
import { PRODUCT_NAME } from '@/lib/brand'

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

const mockProjectId: string | null = null

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
let mockSpectatedOptions: UseSpectatedTurnOptions | null = null

vi.mock('@/features/collaboration/hooks/use-spectated-turn', () => ({
  useSpectatedTurn: (options: UseSpectatedTurnOptions) => {
    mockSpectatedOptions = options
    return mockSpectated
  },
}))

const spectatedTurn = (overrides: Partial<TurnView> = {}): TurnView => ({
  ...initialTurnView('turn-1', 'conv-1'),
  ...overrides,
})

let mockAwaitingPending: Array<{
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

describe('ChatArea — shared thread', () => {
  const ME = 'user-1'
  const ANNA = 'user_anna'

  const setThread = (messages: MessageFixture[]) => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: { id: 's_conv_1', messages },
          isLoading: false,
          isStreaming: false,
          hasHydrated: true,
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
          setComposerPrefill: mockSetComposerPrefill,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )
  }

  const userMessage = (id: string, authorUserId: string | null, content = id): MessageFixture => ({
    id,
    role: 'user',
    messageType: 'user',
    content,
    authorUserId,
  })

  beforeEach(() => {
    mockSharedThread = {
      ...INERT_SHARED_THREAD,
      shared: true,
      participants: [
        { userId: ME, name: 'Max Mustermann' },
        { userId: ANNA, name: 'Anna Berger' },
      ],
      authorOf: (userId?: string | null) =>
        userId === ANNA
          ? { userId: ANNA, name: 'Anna Berger' }
          : userId === ME
            ? { userId: ME, name: 'Max Mustermann' }
            : null,
    }
  })

  test("attributes each human message, and marks the reader's own as theirs", () => {
    setThread([userMessage('m1', ME, 'my question'), userMessage('m2', ANNA, "Anna's answer")])

    render(<ChatArea isAuthenticated canCollaborate />)

    const bubbles = screen.getAllByTestId('user-message')
    expect(bubbles[0]).toHaveAttribute('data-author', 'you')
    expect(bubbles[1]).toHaveAttribute('data-author', 'Anna Berger')
  })

  test('groups consecutive messages from the same author, and only those', () => {
    setThread([
      userMessage('m1', ANNA, 'first'),
      userMessage('m2', ANNA, 'second'),
      userMessage('m3', ME, 'mine'),
    ])

    render(<ChatArea isAuthenticated canCollaborate />)

    const bubbles = screen.getAllByTestId('user-message')
    expect(bubbles[0]).not.toHaveAttribute('data-grouped')
    expect(bubbles[1]).toHaveAttribute('data-grouped', 'true')
    expect(bubbles[2]).not.toHaveAttribute('data-grouped')
  })

  test('the agent answering breaks a run, so the next message gets its own header', () => {
    setThread([
      userMessage('m1', ANNA, 'question'),
      { id: 'a1', role: 'assistant', messageType: 'agent_response', content: 'answer' },
      userMessage('m2', ANNA, 'follow-up'),
    ])

    render(<ChatArea isAuthenticated canCollaborate />)

    const bubbles = screen.getAllByTestId('user-message')
    expect(bubbles[1]).not.toHaveAttribute('data-grouped')
  })

  test('draws the unread separator where the reader left off (spec CC-19)', () => {
    mockSharedThread = { ...mockSharedThread, unreadAfterMessageId: 'm1' }
    setThread([userMessage('m1', ME), userMessage('m2', ANNA)])

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.getByTestId('unread-divider')).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: /new/i })).toBeInTheDocument()
  })

  test("does not draw the separator when everything after the mark is the reader's own", () => {
    mockSharedThread = { ...mockSharedThread, unreadAfterMessageId: 'm1' }
    setThread([userMessage('m1', ME), userMessage('m2', ME)])

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.queryByTestId('unread-divider')).not.toBeInTheDocument()
  })

  test('tells an observer whose question the agent is answering (spec CC-13)', () => {
    mockSharedThread = { ...mockSharedThread, turnInFlight: { actorUserId: ANNA } }
    setThread([userMessage('m1', ANNA, 'question')])

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.getByTestId('turn-in-flight')).toHaveTextContent(/Anna Berger/)
  })

  test("words the banner differently when the turn is the reader's own", () => {
    mockSharedThread = { ...mockSharedThread, turnInFlight: { actorUserId: ME } }
    setThread([userMessage('m1', ME, 'question')])

    render(<ChatArea isAuthenticated canCollaborate />)

    const banner = screen.getByTestId('turn-in-flight')
    expect(banner).toBeInTheDocument()
    expect(banner).not.toHaveTextContent(/Max Mustermann/)
  })

  test("announces a colleague's arrival politely", () => {
    mockSharedThread = {
      ...mockSharedThread,
      lastArrival: { messageId: 'm2', authorUserId: ANNA, authorName: 'Anna Berger' },
    }
    setThread([userMessage('m1', ME), userMessage('m2', ANNA)])

    const { container } = render(<ChatArea isAuthenticated canCollaborate />)

    const live = container.querySelector('[aria-live="polite"]')
    expect(live).toHaveTextContent(/Anna Berger/)
  })

  test('renders nothing extra for a thread the server says is not shared (spec NF-8)', () => {
    mockSharedThread = { ...INERT_SHARED_THREAD, unreadAfterMessageId: 'm1' }
    setThread([userMessage('m1', ME), userMessage('m2', ANNA)])

    render(<ChatArea isAuthenticated canCollaborate />)

    for (const bubble of screen.getAllByTestId('user-message')) {
      expect(bubble).not.toHaveAttribute('data-author')
      expect(bubble).not.toHaveAttribute('data-grouped')
    }
    expect(screen.queryByTestId('unread-divider')).not.toBeInTheDocument()
    expect(screen.queryByTestId('turn-in-flight')).not.toBeInTheDocument()
  })
})

describe('ChatArea — the engagement notice is reachable', () => {
  const setThread = (messages: MessageFixture[]) => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: { id: 's_conv_1', messages },
          isLoading: false,
          isStreaming: false,
          hasHydrated: true,
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
          setComposerPrefill: mockSetComposerPrefill,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )
  }

  const thread = (): MessageFixture[] => [
    { id: 'm1', role: 'user', messageType: 'user', content: 'm1', authorUserId: 'user-1' },
  ]

  beforeEach(() => {
    mockAwaitingPending = []
    mockSharedThread = { ...INERT_SHARED_THREAD, shared: true, engagement: 'mention' }
  })

  test('a mention-mode shared thread explains the rule', () => {
    setThread(thread())

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.getByTestId('engagement-notice')).toHaveTextContent(
      `${PRODUCT_NAME} answers when mentioned`
    )
  })

  test('an ask-mode thread with nothing to offer stays quiet about it', () => {
    mockSharedThread = { ...INERT_SHARED_THREAD, shared: true, engagement: 'ask' }
    setThread(thread())

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.queryByTestId('engagement-notice')).not.toBeInTheDocument()
  })

  test('a multi-person ask-mode thread is OFFERED mention, and still answers to the agent', () => {
    mockSharedThread = {
      ...INERT_SHARED_THREAD,
      shared: true,
      engagement: 'ask',
      engagementSuggestion: 'mention',
    }
    setThread(thread())

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.getByTestId('engagement-notice')).toHaveTextContent(
      `Should ${PRODUCT_NAME} wait to be mentioned?`
    )
  })

  test('a solo thread never shows it — collaboration furniture stays out (NF-8)', () => {
    mockSharedThread = { ...INERT_SHARED_THREAD, engagement: 'mention' }
    setThread(thread())

    render(<ChatArea isAuthenticated canCollaborate={false} />)

    expect(screen.queryByTestId('engagement-notice')).not.toBeInTheDocument()
  })

  test('a viewer gets the explanation without the control', () => {
    mockSharedThread = {
      ...INERT_SHARED_THREAD,
      shared: true,
      engagement: 'mention',
      myRole: 'viewer',
    }
    setThread(thread())

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.getByTestId('engagement-notice')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: `Let ${PRODUCT_NAME} answer everything` })
    ).not.toBeInTheDocument()
  })
})

describe('ChatArea — the spectated stream feeds the turn banner', () => {
  const ANNA = 'user_anna'

  const setThread = (messages: MessageFixture[]) => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: { id: 's_conv_1', messages },
          isLoading: false,
          isStreaming: false,
          hasHydrated: true,
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
          setComposerPrefill: mockSetComposerPrefill,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )
  }

  beforeEach(() => {
    mockAwaitingPending = []
    mockSpectated = { turn: null, live: false }
    mockSpectatedOptions = null
    mockSharedThread = {
      ...INERT_SHARED_THREAD,
      shared: true,
      turnInFlight: { actorUserId: ANNA },
      participants: [
        { userId: 'user-1', name: 'Max Mustermann' },
        { userId: ANNA, name: 'Anna Berger' },
      ],
      authorOf: (userId?: string | null) =>
        userId === ANNA ? { userId: ANNA, name: 'Anna Berger' } : null,
    }
    setThread([
      { id: 'm1', role: 'user', messageType: 'user', content: 'question', authorUserId: ANNA },
    ])
  })

  test('a failed turn clears the banner — nothing else ever will', () => {
    mockSpectated = { turn: spectatedTurn({ phase: 'failed' }), live: true }

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(mockClearTurnInFlight).toHaveBeenCalled()
  })

  test('a DONE turn keeps it, so the finished answer survives until the message lands', () => {
    mockSpectated = {
      turn: spectatedTurn({ text: 'Ja, ab drei Geschossen.', phase: 'finished' }),
      live: true,
    }

    const { rerender } = render(<ChatArea isAuthenticated canCollaborate onSignIn={vi.fn()} />)

    expect(mockClearTurnInFlight).not.toHaveBeenCalled()

    rerender(<ChatArea isAuthenticated canCollaborate onSignIn={vi.fn()} />)
    expect(screen.getByTestId('spectated-turn')).toHaveTextContent('Ja, ab drei Geschossen.')
  })

  test('every frame restarts the staleness clock', () => {
    render(<ChatArea isAuthenticated canCollaborate />)

    expect(mockNoteTurnActivity).not.toHaveBeenCalled()
    mockSpectatedOptions?.onFrame?.()

    expect(mockNoteTurnActivity).toHaveBeenCalledTimes(1)
  })
})
