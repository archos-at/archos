import { act, render, screen, waitFor } from '@/test-utils'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatArea } from './ChatArea'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import type { ChatMessage } from '@/features/chat/types'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
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

describe('ChatArea — the live derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSharedThread = { ...INERT_SHARED_THREAD }
    mockProjectId = null
    useAnswerRevealStore.setState({ revealingId: null })
  })

  const sentAt = new Date('2026-10-09T08:00:00.000Z')
  const question = (overrides: MessageFixture = {}): MessageFixture => ({
    id: 'user-1',
    role: 'user',
    content: 'Frage',
    messageType: 'user',
    timestamp: sentAt,
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
  const turnState = (
    messages: MessageFixture[],
    isStreaming: boolean,
    extra: ChatStoreFixture = {}
  ): ChatStoreFixture => ({
    currentConversation: { id: 'c1', messages },
    isLoading: false,
    isStreaming,
    hasHydrated: true,
    currentUserMessageId: 'user-1',
    respondToPrompt: mockRespondToPrompt,
    dismissErrorCard: mockDismissErrorCard,
    retryLastUserMessage: vi.fn(),
    ...extra,
  })
  type DerivationProps = {
    isThinking?: boolean
    autoOpen?: boolean
    answering?: boolean
    since?: Date
    isInterrupted?: boolean
    isStopped?: boolean
  }
  const derivation = () => mockChatThinking.mock.calls.at(-1)![0] as DerivationProps

  test('is there from the send, before any step — and no typing bubble stands in for it', () => {
    use(turnState([question({ thinkingSteps: [] })], true))
    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByTestId('chat-thinking')).toBeInTheDocument()
    expect(derivation()).toMatchObject({ isThinking: true, autoOpen: false, answering: false })
    expect(screen.queryByRole('status', { name: 'Thinking …' })).not.toBeInTheDocument()
  })

  test('counts its timer from the question, not from its own mount', () => {
    use(turnState([question()], true))
    render(<ChatArea isAuthenticated={true} />)

    expect(derivation().since).toBe(sentAt)
  })

  test('folds when the answer starts, and its header stays live until the answer settles', () => {
    use(turnState([question(), answer('')], true))
    const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    expect(derivation()).toMatchObject({ isThinking: true, autoOpen: true, answering: false })

    use(turnState([question(), answer('Die')], true))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    expect(derivation()).toMatchObject({ isThinking: true, autoOpen: false, answering: true })

    useAnswerRevealStore.setState({ revealingId: 'answer-1' })
    use(turnState([question(), answer('Die Antwort.')], false))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    expect(derivation()).toMatchObject({ isThinking: true, autoOpen: false })

    act(() => useAnswerRevealStore.getState().end('answer-1'))
    expect(derivation()).toMatchObject({ isThinking: false, autoOpen: false })
  })

  test('a masthead (or a card) before the first word folds it too', () => {
    use(turnState([question(), answer('', { answerMeta: { v: 1, topic: 'Fluchtwege' } })], true))
    render(<ChatArea isAuthenticated={true} />)
    expect(derivation()).toMatchObject({ isThinking: true, autoOpen: false, answering: true })
  })

  test('the answer is withheld while the derivation above it folds, then placed under the bar', async () => {
    use(turnState([question()], true))
    const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    use(turnState([question(), answer('Die')], true))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)

    expect(screen.queryByTestId('agent-response')).not.toBeInTheDocument()
    expect(await screen.findByTestId('agent-response')).toBeInTheDocument()
  })

  test('a turn that took no step keeps its bar after the settle, so the answer is not pulled up', () => {
    use(turnState([question({ thinkingSteps: [] }), answer('Hallo')], true))
    const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    expect(screen.getByTestId('chat-thinking')).toBeInTheDocument()

    use(turnState([question({ thinkingSteps: [] }), answer('Hallo')], false))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    expect(screen.getByTestId('chat-thinking')).toBeInTheDocument()
    expect(derivation().isThinking).toBe(false)
  })

  test('says the settle once, in a polite status, with the answer\'s gist', () => {
    use(turnState([question(), answer('Die Antwort ist ja. Mehr dazu unten.')], true))
    const { rerender, container } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    const note = () =>
      Array.from(container.querySelectorAll('[role="status"][aria-atomic="true"]')).map(
        (el) => el.textContent
      )
    expect(note()).not.toContain('Answer ready: Die Antwort ist ja.')

    use(turnState([question(), answer('Die Antwort ist ja. Mehr dazu unten.')], false))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    expect(note()).toContain('Answer ready: Die Antwort ist ja.')
  })

  test('a stopped turn says „Stopped", never done', () => {
    use(turnState([question(), answer('Die Antw', { stopped: true })], true))
    const { rerender, container } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    use(turnState([question(), answer('Die Antw', { stopped: true })], false))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)

    expect(derivation().isStopped).toBe(true)
    expect(container.textContent).toContain('Stopped')
  })

  const settleNote = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[role="status"][aria-atomic="true"]'))
      .map((el) => el.textContent ?? '')
      .join(' ')

  test('a failed answer says „Failed", never that the answer is ready', () => {
    use(turnState([question(), answer('Die Antw', { failed: true })], true))
    const { rerender, container } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    use(turnState([question(), answer('Die Antw', { failed: true })], false))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)

    expect(settleNote(container)).toContain('Failed')
    expect(settleNote(container)).not.toContain('Answer ready')
  })

  test('a turn handed to a run says the task was created, not the provisional message as the answer', () => {
    const handedOff: ChatStoreFixture = {
      turns: { 'user-1': { ...initialTurnView('user-1', 'c1'), phase: 'finished', outcome: 'handed_off' } },
    }
    use(turnState([question(), answer('Ich lege einen Auftrag an.')], true, handedOff))
    const { rerender, container } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    use(turnState([question(), answer('Ich lege einen Auftrag an.')], false, handedOff))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)

    expect(settleNote(container)).toContain('Task created')
    expect(settleNote(container)).not.toContain('Answer ready')
  })

  test('an answer row already on screen is not withheld at its first word', () => {
    use(turnState([question()], true))
    const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    use(turnState([question(), answer('')], true))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    const row = document.getElementById('message-answer-1')
    expect(row).not.toBeNull()

    use(turnState([question(), answer('Die')], true))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    expect(screen.getByTestId('agent-response')).toHaveTextContent('Die')
    expect(document.getElementById('message-answer-1')).toBe(row)
  })

  test('a Stop inside the fold still waits for the fold, then places the answer', async () => {
    use(turnState([question()], true))
    const { rerender } = render(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    use(turnState([question(), answer('Die')], true))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    expect(screen.queryByTestId('agent-response')).not.toBeInTheDocument()

    use(turnState([question(), answer('Die', { stopped: true })], false))
    rerender(<ChatArea isAuthenticated={true} onSignIn={vi.fn()} />)
    expect(screen.queryByTestId('agent-response')).not.toBeInTheDocument()
    expect(await screen.findByTestId('agent-response')).toBeInTheDocument()
  })

  test.each([
    ['answered', 'finished'],
    ['refused', 'finished'],
    ['handed_off', 'finished'],
    ['cancelled', 'finished'],
    [undefined, 'failed'],
  ] as const)('is not interrupted for a turn that ended %s (%s)', (outcome, phase) => {
    use(
      turnState([question()], false, {
        turns: {
          'user-1': {
            ...initialTurnView('user-1', 'c1'),
            phase,
            ...(outcome ? { outcome } : {}),
          },
        },
      })
    )
    render(<ChatArea isAuthenticated={true} />)
    expect(derivation().isInterrupted).toBe(false)
  })

  test('a run message counts as the response, and an error card explains a failure', () => {
    use(
      turnState(
        [
          question(),
          {
            id: 'err-1',
            role: 'assistant',
            content: '',
            messageType: 'error',
            errorData: { errorCode: 'agent.response_failed', errorMessage: 'Fehler' },
          },
        ],
        false
      )
    )
    render(<ChatArea isAuthenticated={true} />)
    expect(derivation().isInterrupted).toBe(false)
  })

  test('keeps a partial answer on screen while the stored copy is fetched after a lost connection', () => {
    use(
      turnState(
        [
          question(),
          answer('Die Fluchtweglänge beträgt', { isStreaming: true }),
          {
            id: 'err-1',
            role: 'assistant',
            content: '',
            messageType: 'error',
            errorData: { errorCode: 'connection.failed' },
          },
        ],
        false,
        {
          isRecoveryPending: true,
          turns: { 'user-1': { ...initialTurnView('user-1', 'c1'), phase: 'running' } },
        }
      )
    )
    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByText(/Die Fluchtweglänge beträgt/)).toBeInTheDocument()
    expect(derivation().isInterrupted).toBe(false)
    expect(screen.getByTestId('thread-status-dock')).toHaveTextContent(
      /connection lost.*carries on/i
    )
  })

  test('a turn this client lost track of, with nothing after it, is interrupted', () => {
    use(turnState([question()], false))
    render(<ChatArea isAuthenticated={true} />)
    expect(derivation().isInterrupted).toBe(true)
  })
})

describe('ChatArea — the jump-to-latest button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSharedThread = { ...INERT_SHARED_THREAD }
    mockProjectId = null
    useAnswerRevealStore.setState({ revealingId: null })
  })

  let contentEnd = 600
  const withGeometry = () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      const el = this as HTMLElement
      const isViewport = el.classList.contains('overflow-y-auto')
      const isSpacer = el.getAttribute('aria-hidden') === 'true' && el.style.minHeight !== ''
      const top = isViewport ? 0 : isSpacer ? contentEnd : 0
      const bottom = isViewport ? 900 : top
      return { top, bottom, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }
    })
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900)
    return () => {
      rect.mockRestore()
      clientHeight.mockRestore()
    }
  }
  const settledThread: ChatStoreFixture = {
    currentConversation: {
      id: 'c1',
      messages: [
        { id: 'user-1', role: 'user', content: 'Frage', messageType: 'user' },
        { id: 'answer-1', role: 'assistant', content: 'Antwort', messageType: 'agent_response' },
      ],
    },
    isLoading: false,
    isStreaming: false,
    hasHydrated: true,
    currentUserMessageId: null,
    respondToPrompt: mockRespondToPrompt,
    dismissErrorCard: mockDismissErrorCard,
  }
  const readerScrolls = (viewport: Element) =>
    act(() => {
      viewport.dispatchEvent(new Event('wheel'))
      viewport.dispatchEvent(new Event('scroll'))
    })

  test('shows while content lies unseen below, and goes once it is in view', async () => {
    const restore = withGeometry()
    try {
      vi.mocked(useChatStore).mockImplementation(
        (selector?: StoreSelector<ChatStoreWithHydration>) =>
          selector ? selector(asStoreState<ChatStoreWithHydration>(settledThread)) : settledThread
      )
      render(<ChatArea isAuthenticated={true} />)
      const viewport = screen.getByRole('region', { name: 'Chat messages' })

      contentEnd = 1200
      readerScrolls(viewport)
      expect(screen.getByRole('button', { name: 'Scroll to latest' })).toBeInTheDocument()

      contentEnd = 690
      readerScrolls(viewport)
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Scroll to latest' })).not.toBeInTheDocument()
      )
    } finally {
      restore()
    }
  })

  test('a scroll the page caused never shows it, nor starts following', () => {
    const restore = withGeometry()
    try {
      vi.mocked(useChatStore).mockImplementation(
        (selector?: StoreSelector<ChatStoreWithHydration>) =>
          selector ? selector(asStoreState<ChatStoreWithHydration>(settledThread)) : settledThread
      )
      render(<ChatArea isAuthenticated={true} />)
      const viewport = screen.getByRole('region', { name: 'Chat messages' })

      contentEnd = 1200
      act(() => {
        viewport.dispatchEvent(new Event('scroll'))
      })
      expect(screen.queryByRole('button', { name: 'Scroll to latest' })).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })
})
