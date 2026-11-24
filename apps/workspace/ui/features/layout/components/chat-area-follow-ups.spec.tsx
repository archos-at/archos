import { render, screen } from '@/test-utils'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatArea } from './ChatArea'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import type { ChatMessage } from '@/features/chat/types'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { TurnView } from '@/lib/turns/turn-fold'
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

const thinkingStep = (overrides: Partial<StoredThinkingStep> = {}): StoredThinkingStep => ({
  id: 'step-1',
  userMessageId: 'user-1',
  kind: 'tool',
  tool: 'web_search',
  timestamp: '2026-07-29T08:00:00.000Z',
  isComplete: true,
  ...overrides,
})

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

describe('ChatArea — the Aktenvermerk chip sits under its answer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSharedThread = { ...INERT_SHARED_THREAD }
    mockProjectId = 'project-1'
    useAnswerRevealStore.setState({ revealingId: null })
  })

  const longBody = 'Schritt. '.repeat(150)
  const state = (isStreaming: boolean): ChatStoreFixture => ({
    currentConversation: {
      id: 'c1',
      messages: [
        { id: 'user-1', role: 'user', content: 'Wie gehe ich vor?', messageType: 'user', thinkingSteps: [thinkingStep()] },
        {
          id: 'answer-1',
          role: 'assistant',
          content: longBody,
          messageType: 'agent_response',
          isStreaming,
          answerMeta: { v: 1, kind: 'walkthrough' },
        },
      ],
    },
    projectId: 'project-1',
    isLoading: false,
    isStreaming,
    hasHydrated: true,
    currentUserMessageId: 'user-1',
    respondToPrompt: mockRespondToPrompt,
    dismissErrorCard: mockDismissErrorCard,
  })
  const use = (s: ChatStoreFixture) =>
    vi
      .mocked(useChatStore)
      .mockImplementation((selector?: StoreSelector<ChatStoreWithHydration>) =>
        selector ? selector(asStoreState<ChatStoreWithHydration>(s)) : s
      )

  test('renders in the answer row, after the answer, once it has settled', () => {
    use(state(false))
    render(<ChatArea isAuthenticated={true} />)

    const rail = screen.getByTestId('follow-ups-rail')
    expect(document.getElementById('message-answer-1')!.contains(rail)).toBe(true)
    expect(document.getElementById('message-user-1')!.contains(rail)).toBe(false)
    expect(
      screen.getByTestId('agent-response').compareDocumentPosition(rail) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  test('is not offered while the answer is still streaming or revealing', () => {
    use(state(true))
    const { unmount } = render(<ChatArea isAuthenticated={true} />)
    expect(screen.queryByTestId('follow-ups-rail')).not.toBeInTheDocument()
    unmount()

    useAnswerRevealStore.setState({ revealingId: 'answer-1' })
    use(state(false))
    render(<ChatArea isAuthenticated={true} />)
    expect(screen.queryByTestId('follow-ups-rail')).not.toBeInTheDocument()
  })
})

describe('ChatArea — the follow-ups rail sits below the answer', () => {
  const answerWithChips = (extra: MessageFixture[] = []): ChatStoreFixture => ({
    currentConversation: {
      id: 'c1',
      messages: [
        { id: 'user-1', role: 'user', content: 'Was ist das Fluchtniveau?', messageType: 'user' },
        {
          id: 'answer-1',
          role: 'assistant',
          content: 'Das Fluchtniveau ist …',
          messageType: 'agent_response',
          stages: { followUps: { items: [{ question: 'Und bei Hanglage?' }] } },
        },
        ...extra,
      ],
    },
    isLoading: false,
    hasHydrated: true,
    isStreaming: false,
    respondToPrompt: mockRespondToPrompt,
    dismissErrorCard: mockDismissErrorCard,
    setComposerPrefill: mockSetComposerPrefill,
  })

  const renderWith = (state: ChatStoreFixture) => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) =>
        selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
    )
    return render(<ChatArea isAuthenticated={true} />)
  }

  test('renders the rail outside the answer, as its sibling', () => {
    renderWith(answerWithChips())

    const rail = screen.getByTestId('follow-ups-rail')
    const answer = screen.getByTestId('agent-response')
    expect(rail).toBeInTheDocument()
    expect(answer.contains(rail)).toBe(false)
    expect(answer.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('is the LAST element in its message column, so growing it moves nothing', () => {
    renderWith(answerWithChips())

    const rail = screen.getByTestId('follow-ups-rail')
    const column = document.getElementById('message-answer-1')
    expect(column).not.toBeNull()
    expect(column!.contains(rail)).toBe(true)
    expect(column!.lastElementChild!.contains(rail)).toBe(true)
  })

  test('renders no rail for an answer no stage addressed', () => {
    const state = answerWithChips()
    state.currentConversation!.messages![1]!.stages = undefined
    renderWith(state)

    expect(screen.queryByTestId('follow-ups-rail')).not.toBeInTheDocument()
  })
})
