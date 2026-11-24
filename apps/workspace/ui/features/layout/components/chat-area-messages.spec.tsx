import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatArea } from './ChatArea'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import type { ChatMessage } from '@/features/chat/types'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { TurnView } from '@/lib/turns/turn-fold'
import { useChatStore } from '@/features/chat/store'
import { PRODUCT_NAME } from '@/lib/brand'

type ChatStoreFixture = DeepPartial<ChatStoreWithHydration>

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

const GREETING_RE = /good (morning|afternoon|evening)/i

describe('ChatArea', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUserName = 'Max Mustermann'
    mockSharedThread = { ...INERT_SHARED_THREAD }
    mockProjectId = null
    mockBimModels = null
  })

  describe('the empty canvas offers nothing to read, only something to do', () => {

    test('grows no suggestion chips, not even where a readable model exists', () => {
      mockProjectId = 'proj-1'
      mockBimModels = [{ status: 'ready' }]
      render(<ChatArea isAuthenticated />)

      expect(screen.queryAllByRole('button', { name: /\?$/ })).toHaveLength(0)
      expect(screen.queryByRole('group', { name: /example|beispiel/i })).not.toBeInTheDocument()
      expect(mockSetComposerPrefill).not.toHaveBeenCalled()
    })

    test('leaves the greeting alone under it', () => {
      render(<ChatArea isAuthenticated />)

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(GREETING_RE)
      expect(screen.queryByText(/answers cite their sources/i)).not.toBeInTheDocument()
    })
  })

  test('renders welcome state when not authenticated', () => {
    render(<ChatArea isAuthenticated={false} />)

    expect(
      screen.getByText(new RegExp(`${PRODUCT_NAME} opens after your organization is verified`, 'i'))
    ).toBeInTheDocument()
    expect(screen.getByText(/sign in to open the project workspace/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in with.*sso/i })).toBeInTheDocument()
  })

  test('renders the time-of-day greeting with the first name when authenticated with no messages', () => {
    render(<ChatArea isAuthenticated={true} />)

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(GREETING_RE)
    expect(heading).toHaveTextContent('Max')
    expect(heading).not.toHaveTextContent('Mustermann')
  })

  test('renders the plain greeting when no user name is available', () => {
    mockUserName = null

    render(<ChatArea isAuthenticated={true} />)

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(GREETING_RE)
    expect(heading).not.toHaveTextContent(',')
  })

  test('calls onSignIn when sign in button clicked', async () => {
    const user = userEvent.setup()
    const onSignIn = vi.fn()

    render(<ChatArea isAuthenticated={false} onSignIn={onSignIn} />)

    await user.click(screen.getByRole('button', { name: /sign in with.*sso/i }))

    expect(onSignIn).toHaveBeenCalled()
  })

  test('renders user messages', () => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: {
            messages: [{ id: 'msg-1', role: 'user', content: 'Hello world', messageType: 'user' }],
          },
          isLoading: false,
          hasHydrated: true,
          isStreaming: false,
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByTestId('user-message')).toHaveTextContent('Hello world')
  })

  test('does not render legacy status messages', () => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: {
            messages: [
              {
                id: 'msg-1',
                role: 'assistant',
                content: 'Processing...',
                messageType: 'status',
              },
            ],
          },
          isLoading: false,
          hasHydrated: true,
          isStreaming: false,
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('renders agent prompts', () => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: {
            messages: [
              {
                id: 'msg-1',
                role: 'assistant',
                content: 'Please provide more details',
                messageType: 'prompt',
                promptInputType: 'text',
              },
            ],
          },
          isLoading: false,
          hasHydrated: true,
          isStreaming: false,
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByTestId('agent-prompt')).toBeInTheDocument()
  })

  test('renders agent responses', () => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: {
            messages: [
              {
                id: 'msg-1',
                role: 'assistant',
                content: 'Here is your answer',
                messageType: 'agent_response',
              },
            ],
          },
          isLoading: false,
          hasHydrated: true,
          isStreaming: false,
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByTestId('agent-response')).toHaveTextContent('Here is your answer')
  })

  test('dispatches a message with a run ledger to the run block', () => {
    const runLedger = {
      runId: 'run-1',
      status: 'running' as const,
      phases: [],
      steps: [],
      startedAt: '2026-09-16T08:00:00.000Z',
      updatedAt: '2026-09-16T08:00:00.000Z',
    }
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: {
            messages: [
              {
                id: 'msg-run',
                role: 'assistant',
                content: 'Der Bericht',
                messageType: 'agent_response',
                runLedger,
                runTitle: 'Normprüfung: Fluchtwege',
              },
            ],
          },
          projectId: mockProjectId,
          isLoading: false,
          hasHydrated: true,
          isStreaming: false,
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )

    render(<ChatArea isAuthenticated={true} />)

    const block = screen.getByTestId('run-block')
    expect(block).toHaveAttribute('data-status', 'running')
    expect(block).toHaveTextContent('Normprüfung: Fluchtwege')
    expect(mockUseRunLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: mockProjectId,
        message: expect.objectContaining({ id: 'msg-run' }),
      })
    )
    expect(screen.queryByTestId('agent-response')).not.toBeInTheDocument()
  })

  test('renders file messages', () => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: {
            messages: [
              {
                id: 'msg-1',
                role: 'assistant',
                content: '',
                messageType: 'file',
                fileData: {
                  fileName: 'document.pdf',
                  fileSize: 1024,
                  fileStatus: 'success',
                },
              },
            ],
          },
          isLoading: false,
          hasHydrated: true,
          isStreaming: false,
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByText(/document\.pdf/)).toBeInTheDocument()
  })

  test('renders error banners', () => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: {
            messages: [
              {
                id: 'msg-1',
                role: 'assistant',
                content: '',
                messageType: 'error',
                errorData: {
                  errorCode: 'agent.response_failed',
                  errorMessage: 'Something went wrong',
                },
              },
            ],
          },
          isLoading: false,
          hasHydrated: true,
          isStreaming: false,
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByTestId('error-card')).toBeInTheDocument()
  })

  test('does not render assistant messages (full reports)', () => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: {
            messages: [
              {
                id: 'msg-1',
                role: 'assistant',
                content: 'Full report content',
                messageType: 'assistant',
              },
            ],
          },
          isLoading: false,
          hasHydrated: true,
          isStreaming: false,
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(GREETING_RE)
  })

  test('renders chat messages area with aria-label', () => {
    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByLabelText(/chat messages/i)).toBeInTheDocument()
  })

  test('handles null currentConversation', () => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: null,
          isLoading: false,
          hasHydrated: true,
          isStreaming: false,
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(GREETING_RE)
  })
})
