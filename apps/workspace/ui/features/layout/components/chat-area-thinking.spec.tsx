import { render } from '@/test-utils'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatArea } from './ChatArea'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
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

const thinkingStep = (overrides: Partial<StoredThinkingStep> = {}): StoredThinkingStep => ({
  id: 'step-1',
  userMessageId: 'user-1',
  kind: 'tool',
  tool: 'web_search',
  timestamp: '2026-07-29T08:00:00.000Z',
  isComplete: true,
  ...overrides,
})

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
