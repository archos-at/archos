import { render, screen } from '@/test-utils'
import { vi, describe, test, expect } from 'vitest'
import { ChatArea } from './ChatArea'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import type { ChatMessage } from '@/features/chat/types'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { TurnView } from '@/lib/turns/turn-fold'
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
