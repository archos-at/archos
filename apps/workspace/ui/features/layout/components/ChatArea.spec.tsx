import { act, render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { ChatArea } from './ChatArea'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import type { ChatMessage } from '@/features/chat/types'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { UseSpectatedTurnOptions } from '@/features/collaboration/hooks/use-spectated-turn'
import { initialTurnView, type TurnView } from '@/lib/turns/turn-fold'
import { useAnswerRevealStore } from '@/features/chat/stores/answer-reveal-store'
import { RESTORING_NOTE_AFTER_MS, watchRestoring } from '@/features/chat/connection-restoring'

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

const pendingRequest = (
  overrides: Partial<(typeof mockAwaitingPending)[number]> = {}
): (typeof mockAwaitingPending)[number] => ({
  id: 'r-1',
  person: { userId: 'user_anna', name: 'Anna Berger' },
  requestedBy: { userId: 'user-1', name: 'Max Mustermann' },
  createdAt: '2026-07-29T09:00:00.000Z',
  note: null,
  ...overrides,
})

vi.mock('@/features/collaboration/hooks/use-sharing', () => ({
  useAwaitingState: vi.fn((_conversationId: string | null, enabled: boolean) => ({
    awaiting: enabled ? { pending: mockAwaitingPending, awaitingMe: false } : null,
    refresh: vi.fn(),
    release: vi.fn(),
  })),
}))

import { useChatStore } from '@/features/chat/store'
import { PRODUCT_NAME } from '@/lib/brand'

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

  test('keeps earlier interrupted thinking state after a later completed turn', () => {

    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: {
            messages: [
              {
                id: 'user-1',
                role: 'user',
                content: 'First question',
                messageType: 'user',
                thinkingSteps: [thinkingStep()],
              },
              {
                id: 'user-2',
                role: 'user',
                content: 'Second question',
                messageType: 'user',
                thinkingSteps: [thinkingStep({ id: 'step-2', userMessageId: 'user-2' })],
              },
              {
                id: 'answer-2',
                role: 'assistant',
                content: 'Second answer',
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

    expect(mockChatThinking).toHaveBeenCalledTimes(2)

    const firstCallProps = mockChatThinking.mock.calls[0][0] as {
      isInterrupted?: boolean
      isThinking?: boolean
    }
    const secondCallProps = mockChatThinking.mock.calls[1][0] as {
      isInterrupted?: boolean
      isThinking?: boolean
    }

    expect(firstCallProps.isInterrupted).toBe(true)
    expect(firstCallProps.isThinking).toBe(false)

    expect(secondCallProps.isInterrupted).toBe(false)
    expect(secondCallProps.isThinking).toBe(false)
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

  test('keeps earlier interrupted thinking state while a new message is actively streaming', () => {

    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) => {
        const state: ChatStoreFixture = {
          currentConversation: {
            messages: [
              {
                id: 'user-1',
                role: 'user',
                content: 'First question',
                messageType: 'user',
                thinkingSteps: [thinkingStep()],
              },
              {
                id: 'user-2',
                role: 'user',
                content: 'Second question',
                messageType: 'user',
                thinkingSteps: [thinkingStep({ id: 'step-2', userMessageId: 'user-2' })],
              },
            ],
          },
          isLoading: true,
          isStreaming: true,
          hasHydrated: true,
          currentUserMessageId: 'user-2',
          respondToPrompt: mockRespondToPrompt,
          dismissErrorCard: mockDismissErrorCard,
        }
        return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
      }
    )

    render(<ChatArea isAuthenticated={true} />)

    expect(mockChatThinking).toHaveBeenCalledTimes(2)

    const firstCallProps = mockChatThinking.mock.calls[0][0] as {
      isInterrupted?: boolean
      isThinking?: boolean
    }
    const secondCallProps = mockChatThinking.mock.calls[1][0] as {
      isInterrupted?: boolean
      isThinking?: boolean
    }

    expect(firstCallProps.isInterrupted).toBe(true)
    expect(firstCallProps.isThinking).toBe(false)

    expect(secondCallProps.isThinking).toBe(true)
    expect(secondCallProps.isInterrupted).toBe(false)
  })

})

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

describe('ChatArea — a working cue after an answered HITL prompt', () => {
  const stateWithLastMessage = (
    message: MessageFixture,
    isStreaming: boolean
  ): ChatStoreFixture => ({
    currentConversation: {
      id: 'c1',
      messages: [{ id: 'user-1', role: 'user', content: 'Frage', messageType: 'user' }, message],
    },
    isLoading: isStreaming,
    isStreaming,
    currentUserMessageId: 'user-1',
    hasHydrated: true,
    respondToPrompt: mockRespondToPrompt,
    dismissErrorCard: mockDismissErrorCard,
  })

  const mount = (state: ChatStoreFixture) => {
    vi.mocked(useChatStore).mockImplementation(
      (selector?: StoreSelector<ChatStoreWithHydration>) =>
        selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
    )
    render(<ChatArea isAuthenticated={true} />)
  }

  test('shows the working cue once an answered prompt is the last message and streaming resumed', () => {
    mount(
      stateWithLastMessage(
        {
          id: 'prompt-1',
          role: 'assistant',
          content: 'Welche Bauklasse?',
          messageType: 'prompt',
          promptInputType: 'choice',
          isPromptResponded: true,
          promptResponse: 'Bauklasse 4',
        },
        true
      )
    )

    expect(screen.getByRole('status', { name: 'Thinking …' })).toBeInTheDocument()
  })

  test('shows nothing while the prompt is still unanswered — that state is the prompt bubble itself', () => {
    mount(
      stateWithLastMessage(
        {
          id: 'prompt-1',
          role: 'assistant',
          content: 'Welche Bauklasse?',
          messageType: 'prompt',
          promptInputType: 'choice',
          isPromptResponded: false,
        },
        true
      )
    )

    expect(screen.getByTestId('agent-prompt')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Thinking …' })).not.toBeInTheDocument()
  })

  test('shows nothing once the session has stopped streaming, even if the prompt is answered', () => {
    mount(
      stateWithLastMessage(
        {
          id: 'prompt-1',
          role: 'assistant',
          content: 'Welche Bauklasse?',
          messageType: 'prompt',
          promptInputType: 'choice',
          isPromptResponded: true,
          promptResponse: 'Bauklasse 4',
        },
        false
      )
    )

    expect(screen.queryByRole('status', { name: 'Thinking …' })).not.toBeInTheDocument()
  })

  test('an answer that has already arrived replaces the cue instead of stacking with it', () => {
    mount({
      currentConversation: {
        id: 'c1',
        messages: [
          { id: 'user-1', role: 'user', content: 'Frage', messageType: 'user' },
          {
            id: 'prompt-1',
            role: 'assistant',
            content: 'Welche Bauklasse?',
            messageType: 'prompt',
            promptInputType: 'choice',
            isPromptResponded: true,
            promptResponse: 'Bauklasse 4',
          },
          {
            id: 'answer-1',
            role: 'assistant',
            content: 'Für Bauklasse 4 gilt …',
            messageType: 'agent_response',
          },
        ],
      },
      isLoading: true,
      isStreaming: true,
      currentUserMessageId: 'user-1',
      hasHydrated: true,
      respondToPrompt: mockRespondToPrompt,
      dismissErrorCard: mockDismissErrorCard,
    })

    expect(screen.getByTestId('agent-response')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Thinking …' })).not.toBeInTheDocument()
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

describe('ChatArea — the awaiting banner is reachable', () => {
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

  const waitingThread = (): MessageFixture[] => [
    {
      id: 'm1',
      role: 'user',
      messageType: 'user',
      content: 'm1',
      authorUserId: ME,
      addressees: { agent: false, users: [ANNA] },
    },
  ]

  beforeEach(() => {
    mockAwaitingPending = []
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

  test('a waiting shared thread renders the banner, naming who holds it', () => {
    mockAwaitingPending = [pendingRequest()]
    setThread(waitingThread())

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.getByTestId('awaiting-banner')).toHaveTextContent('Waiting for Anna Berger')
  })

  test('the release action — the way out of a wait — is present', () => {
    mockAwaitingPending = [pendingRequest()]
    setThread(waitingThread())

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.getByRole('button', { name: 'Continue without Anna Berger' })).toBeInTheDocument()
  })

  test('no banner when nothing is outstanding', () => {
    setThread(waitingThread())

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.queryByTestId('awaiting-banner')).not.toBeInTheDocument()
  })

  test('a solo thread never shows it — collaboration furniture stays out (NF-8)', () => {
    mockAwaitingPending = [pendingRequest()]
    mockSharedThread = { ...INERT_SHARED_THREAD }
    setThread(waitingThread())

    render(<ChatArea isAuthenticated canCollaborate={false} />)

    expect(screen.queryByTestId('awaiting-banner')).not.toBeInTheDocument()
  })

  test('"ask the agent instead" pre-fills rather than sending, like every other hand-off action', async () => {
    const user = userEvent.setup()
    mockAwaitingPending = [pendingRequest()]
    setThread(waitingThread())

    render(<ChatArea isAuthenticated canCollaborate />)
    await user.click(screen.getByRole('button', { name: `Ask ${PRODUCT_NAME} instead` }))

    expect(mockSetComposerPrefill).toHaveBeenCalledWith(`@${PRODUCT_NAME} `, [
      { targetId: 'agent:piloti', display: PRODUCT_NAME },
    ])
  })
})

describe('ChatArea — the hand-back offer', () => {
  const ME = 'user-1'
  const ANNA = 'user_anna'
  const TOBIAS = 'user_tobias'

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

  const userMessage = (
    id: string,
    authorUserId: string | null,
    extra: MessageFixture = {}
  ): MessageFixture => ({
    id,
    role: 'user',
    messageType: 'user',
    content: id,
    authorUserId,
    ...extra,
  })

  const asks = (users: string[]): MessageFixture => ({ addressees: { agent: false, users } })

  const resolvedThread = (): MessageFixture[] => [
    userMessage('m1', ME, asks([ANNA])),
    userMessage('m2', ANNA),
  ]

  beforeEach(() => {
    mockAwaitingPending = []
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
          : userId === TOBIAS
            ? { userId: TOBIAS, name: 'Tobias Kern' }
            : userId === ME
              ? { userId: ME, name: 'Max Mustermann' }
              : null,
    }
  })

  test('offers to let the agent carry on once the person who was asked has answered', () => {
    setThread(resolvedThread())

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.getByTestId('handback-offer')).toHaveTextContent(
      `Anna Berger replied — let ${PRODUCT_NAME} carry on?`
    )
  })

  test('names everyone who answered when several were asked', () => {
    setThread([
      userMessage('m1', ME, asks([ANNA, TOBIAS])),
      userMessage('m2', ANNA),
      userMessage('m3', TOBIAS),
    ])

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.getByTestId('handback-offer')).toHaveTextContent(
      `Anna Berger, Tobias Kern replied — let ${PRODUCT_NAME} carry on?`
    )
  })

  test('falls back to the structured mentions when the ruling was not stored', () => {
    setThread([
      userMessage('m1', ME, { mentions: [{ targetId: ANNA, display: 'Anna Berger' }] }),
      userMessage('m2', ANNA),
    ])

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.getByTestId('handback-offer')).toBeInTheDocument()
  })

  test('accepting PRE-FILLS the composer with the agent mention and never sends', async () => {
    const user = userEvent.setup()
    setThread(resolvedThread())

    render(<ChatArea isAuthenticated canCollaborate />)
    await user.click(screen.getByRole('button', { name: `Let ${PRODUCT_NAME} carry on` }))

    expect(mockSetComposerPrefill).toHaveBeenCalledWith(`@${PRODUCT_NAME} — please carry on from here.`, [
      { targetId: 'agent:piloti', display: PRODUCT_NAME },
    ])
    await waitFor(() => expect(screen.queryByTestId('handback-offer')).not.toBeInTheDocument())
  })

  test('dismissing it takes it away', async () => {
    const user = userEvent.setup()
    setThread(resolvedThread())

    render(<ChatArea isAuthenticated canCollaborate />)
    await user.click(screen.getByRole('button', { name: 'Not now' }))

    await waitFor(() => expect(screen.queryByTestId('handback-offer')).not.toBeInTheDocument())
    expect(mockSetComposerPrefill).not.toHaveBeenCalled()
  })

  test('stays away while the thread is still waiting on someone — and the BANNER is what owns that state', () => {
    mockAwaitingPending = [pendingRequest()]
    setThread(resolvedThread())

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.queryByTestId('handback-offer')).not.toBeInTheDocument()
    expect(screen.getByTestId('awaiting-banner')).toBeInTheDocument()
  })

  test('stays away once the agent has already answered — there is nothing to hand back', () => {
    setThread([
      ...resolvedThread(),
      { id: 'a1', role: 'assistant', messageType: 'agent_response', content: 'answer' },
    ])

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.queryByTestId('handback-offer')).not.toBeInTheDocument()
  })

  test('stays away when the reader had the last word', () => {
    setThread([...resolvedThread(), userMessage('m3', ME)])

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.queryByTestId('handback-offer')).not.toBeInTheDocument()
  })

  test('stays away for a remark by somebody who was never asked', () => {
    setThread([userMessage('m1', ME, asks([ANNA])), userMessage('m2', TOBIAS)])

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.queryByTestId('handback-offer')).not.toBeInTheDocument()
  })

  test('stays away when nobody was ever asked at all', () => {
    setThread([userMessage('m1', ME), userMessage('m2', ANNA)])

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.queryByTestId('handback-offer')).not.toBeInTheDocument()
  })

  test('renders nothing for a thread the server says is not shared (spec NF-8)', () => {
    mockSharedThread = { ...INERT_SHARED_THREAD }
    setThread(resolvedThread())

    render(<ChatArea isAuthenticated canCollaborate />)

    expect(screen.queryByTestId('handback-offer')).not.toBeInTheDocument()
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
