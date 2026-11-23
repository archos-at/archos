import { act, render, screen, waitFor } from '@/test-utils'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatArea } from './ChatArea'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import type { ChatMessage } from '@/features/chat/types'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { TurnView } from '@/lib/turns/turn-fold'
import { useAnswerRevealStore } from '@/features/chat/stores/answer-reveal-store'
import { RESTORING_NOTE_AFTER_MS, watchRestoring } from '@/features/chat/connection-restoring'
import { useChatStore } from '@/features/chat/store'

type ChatStoreFixture = DeepPartial<ChatStoreWithHydration>
type MessageFixture = DeepPartial<ChatMessage>

const mockRespondToPrompt = vi.fn()
const mockDismissErrorCard = vi.fn()
const mockSetComposerPrefill = vi.fn()

const mockChatThinking = vi.fn((_props: unknown) => (
  <div data-testid="chat-thinking">Thinking...</div>
))

const mockUseRunLedger = vi.fn((input: { message: ChatMessage }) => ({
  ledger: input.message.runLedger ?? null,
  live: false,
}))
vi.mock('@/features/runs/hooks/use-run-ledger', () => ({
  useRunLedger: (input: { message: ChatMessage }) => mockUseRunLedger(input),
}))
vi.mock('@/features/runs/hooks/use-project-inventory', () => ({
  useProjectInventory: () => ({ documents: null, loading: false }),
}))
vi.mock('@/features/runs/components/RunBlock', () => ({
  RunBlock: ({ ledger, title }: { ledger: { status: string }; title?: string | null }) => (
    <div data-testid="run-block" data-status={ledger.status}>
      {title}
    </div>
  ),
}))

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

describe('ChatArea — opening a thread, its endings and its dock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSharedThread = { ...INERT_SHARED_THREAD }
    mockProjectId = null
    useAnswerRevealStore.setState({ revealingId: null })
  })

  const question = (overrides: MessageFixture = {}): MessageFixture => ({
    id: 'user-1',
    role: 'user',
    content: 'Frage',
    messageType: 'user',
    timestamp: new Date('2026-10-09T08:00:00.000Z'),
    thinkingSteps: [thinkingStep()],
    ...overrides,
  })
  const answer = (content: string, overrides: MessageFixture = {}): MessageFixture => ({
    id: 'answer-1',
    role: 'assistant',
    content,
    messageType: 'agent_response',
    ...overrides,
  })
  const use = (state: ChatStoreFixture) =>
    vi
      .mocked(useChatStore)
      .mockImplementation((selector?: StoreSelector<ChatStoreWithHydration>) =>
        selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      )
  const thread = (messages: MessageFixture[], extra: ChatStoreFixture = {}): ChatStoreFixture => ({
    currentConversation: { id: 'c1', messages },
    isLoading: false,
    isStreaming: false,
    hasHydrated: true,
    currentUserMessageId: null,
    respondToPrompt: mockRespondToPrompt,
    dismissErrorCard: mockDismissErrorCard,
    retryLastUserMessage: vi.fn(),
    ...extra,
  })
  const derivation = () => mockChatThinking.mock.calls.at(-1)![0] as { endedAs?: string; isInterrupted?: boolean; answering?: boolean }

  test('a thread whose messages are on their way shows the skeleton, never the greeting', () => {
    use(thread([], { pendingMessagesFor: 'c1' }))
    render(<ChatArea isAuthenticated={true} />)

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: /loading/i })).toHaveAttribute('aria-busy', 'true')
  })

  test('a deep link to another thread holds the skeleton over the thread still open', () => {
    use(thread([question()], { pendingMessagesFor: 'c-linked' }))
    render(<ChatArea isAuthenticated={true} />)

    expect(screen.queryByTestId('user-message')).not.toBeInTheDocument()
  })

  test('messages that arrive after the skeleton are placed, not entered', () => {
    use(thread([], { pendingMessagesFor: 'c1' }))
    const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)

    use(thread([question(), answer('Antwort')]))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)

    expect(document.getElementById('message-user-1')?.style.opacity).not.toBe('0')
    expect(document.getElementById('message-answer-1')?.style.opacity).not.toBe('0')
  })

  test('a turn handed to a run keeps its answer row: the run message takes the same node', () => {
    use(thread([question(), answer('Ich lege einen Auftrag an.')]))
    const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    const row = document.getElementById('message-answer-1')
    expect(row).not.toBeNull()

    use(
      thread([
        question(),
        answer('', {
          id: 'run-message-1',
          runLedger: {
            runId: 'run-1',
            status: 'running',
            phases: [],
            steps: [],
            startedAt: '2026-10-09T08:00:00.000Z',
            updatedAt: '2026-10-09T08:00:00.000Z',
          },
        }),
      ])
    )
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)

    expect(document.getElementById('message-run-message-1')).toBe(row)
    expect(derivation().endedAs).toBe('handed_off')
  })

  test('a turn that failed reads as failed, never as interrupted or done', () => {
    use(thread([question(), answer('Halber Satz', { failed: true })]))
    render(<ChatArea isAuthenticated={true} />)

    expect(derivation()).toMatchObject({ endedAs: 'failed', isInterrupted: false })
  })

  test('a turn the queue refused is not handled, not failed and not done', () => {
    use(
      thread([
        question(),
        {
          id: 'err-queue',
          role: 'assistant',
          content: '',
          messageType: 'error',
          errorData: { errorCode: 'research.queue_full', errorMessage: 'Warteschlange voll' },
        },
      ])
    )
    render(<ChatArea isAuthenticated={true} />)

    expect(derivation()).toMatchObject({ endedAs: 'refused', isInterrupted: false })
  })

  test('a retraction does not reopen the derivation over the answer it folded for', () => {
    use(thread([question(), answer('Erster Satz.', { isStreaming: true })], { isStreaming: true, currentUserMessageId: 'user-1' }))
    const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    expect(derivation().answering).toBe(true)

    use(thread([question(), answer('', { isStreaming: true })], { isStreaming: true, currentUserMessageId: 'user-1' }))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)

    expect(derivation().answering).toBe(true)
  })

  test('a dropped connection is a quiet line above the composer, not a card in the thread', async () => {
    const lost: MessageFixture = {
      id: 'err-conn',
      role: 'assistant',
      content: '',
      messageType: 'error',
      errorData: { errorCode: 'connection.failed' },
    }
    use(thread([question(), answer('Antwort'), lost]))
    const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)

    expect(screen.queryByTestId('error-card')).not.toBeInTheDocument()
    const dock = screen.getByTestId('thread-status-dock')
    expect(dock).toHaveTextContent(/connection lost/i)

    use(thread([question(), answer('Antwort')]))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('thread-status-dock')).toHaveTextContent(/reconnected/i))
  })

  test('a socket still reconnecting under a running answer is said in the same line, to a screen reader too, and goes when it is open', async () => {
    vi.useFakeTimers()
    const onStatus = watchRestoring('c1', () => undefined)
    try {
      use(thread([question(), answer('Erster Satz.', { isStreaming: true })], { isStreaming: true, currentUserMessageId: 'user-1' }))
      render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
      const dock = screen.getByTestId('thread-status-dock')
      const announced = () => dock.querySelector('[aria-live="polite"]')

      act(() => onStatus('reconnecting'))
      act(() => void vi.advanceTimersByTime(RESTORING_NOTE_AFTER_MS - 1))
      expect(dock).not.toHaveTextContent(/restoring the connection/i)

      act(() => void vi.advanceTimersByTime(1))
      expect(dock).toHaveTextContent(/restoring the connection/i)
      expect(announced()).toHaveTextContent(/restoring the connection/i)
      expect(screen.queryByTestId('error-card')).not.toBeInTheDocument()
      expect(dock).not.toHaveTextContent(/connection lost/i)

      act(() => onStatus('open'))
      expect(announced()).toBeEmptyDOMElement()
      vi.useRealTimers()
      await waitFor(() => expect(dock).not.toHaveTextContent(/restoring the connection/i))
    } finally {
      act(() => onStatus('closed'))
      vi.useRealTimers()
    }
  })

  test('a socket reconnecting under an idle thread says nothing, and a spent ladder says lost in its place', () => {
    vi.useFakeTimers()
    const onStatus = watchRestoring('c1', () => undefined)
    try {
      use(thread([question(), answer('Antwort')]))
      const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
      const dock = screen.getByTestId('thread-status-dock')
      act(() => onStatus('reconnecting'))
      act(() => void vi.advanceTimersByTime(RESTORING_NOTE_AFTER_MS))
      expect(dock).not.toHaveTextContent(/restoring the connection/i)

      use(thread([question(), answer('Antwort')], { isStreaming: true, currentUserMessageId: 'user-1' }))
      rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
      expect(dock).toHaveTextContent(/restoring the connection/i)

      const lost: MessageFixture = { id: 'err-conn', role: 'assistant', content: '', messageType: 'error', errorData: { errorCode: 'connection.failed' } }
      use(thread([question(), answer('Antwort'), lost], { isStreaming: true, currentUserMessageId: 'user-1' }))
      rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
      expect(dock.querySelector('[aria-live="polite"]')).toHaveTextContent(/connection lost/i)
    } finally {
      act(() => onStatus('closed'))
      vi.useRealTimers()
    }
  })

  test('a colleague typing is said in the dock, outside the thread it would bob', () => {
    mockSharedThread = {
      ...INERT_SHARED_THREAD,
      shared: true,
      typists: [{ userId: 'user_anna', name: 'Anna Berger' }],
    }
    use(thread([question(), answer('Antwort')]))
    render(<ChatArea isAuthenticated={true} />)

    const presence = screen.getByTestId('typing-presence')
    expect(screen.getByTestId('thread-status-dock')).toContainElement(presence)
    expect(screen.getByRole('region')).not.toContainElement(presence)
  })
})
