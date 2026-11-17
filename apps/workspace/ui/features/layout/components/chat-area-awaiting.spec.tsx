import { render, screen, waitFor } from '@/test-utils'
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

const mockSpectated: { turn: TurnView | null; live: boolean } = { turn: null, live: false }

vi.mock('@/features/collaboration/hooks/use-spectated-turn', () => ({
  useSpectatedTurn: () => mockSpectated,
}))

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
