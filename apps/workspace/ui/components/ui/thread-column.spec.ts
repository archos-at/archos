import { createElement } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@/test-utils'
import { THREAD_COLUMN, THREAD_COLUMN_INNER, THREAD_GUTTER } from './thread-column'
import { ChatArea } from '@/features/layout/components/ChatArea'
import { MessageListSkeleton } from '@/features/layout/components/chat-area/chat-area-states'
import { InputArea } from '@/features/layout/components/InputArea'
import { ChatToolbar } from '@/features/layout/components/ChatToolbar'
import { NoSourcesBanner } from '@/features/chat/components/NoSourcesBanner'
import { ChatUsageNotice } from '@/features/chat/components/ChatUsageNotice'
import { useAnswerRevealStore } from '@/features/chat/stores/answer-reveal-store'

let mockMessages: Array<Record<string, unknown>> = []
let mockProjectId: string | null = null
let mockStreaming = false

const chatState = () => ({
  currentConversation: { id: 'session-1', messages: mockMessages },
  conversations: [{ id: 'session-1', messages: mockMessages }],
  projectId: mockProjectId,
  isLoading: false,
  isStreaming: mockStreaming,
  hasHydrated: true,
  currentUserMessageId: null,
  respondToPrompt: vi.fn(),
  dismissErrorCard: vi.fn(),
  retryLastUserMessage: vi.fn(),
  setComposerPrefill: vi.fn(),
  updateConversationTitle: vi.fn(),
  saveDataSourcesToConversation: vi.fn(),
  stopStreaming: vi.fn(),
  ensureSession: vi.fn(() => 'session-1'),
  _ensureConversationExists: vi.fn(async () => {}),
  startNewSessionDraft: vi.fn(),
  setRespondToInteractionFn: vi.fn(),
  setChatSendFn: vi.fn(),
  composerPrefill: null,
  consumeComposerPrefill: vi.fn(() => null),
  composerSubject: null,
  setComposerSubject: vi.fn(),
  composerDrafts: {},
  getComposerDraft: () => '',
  setComposerDraft: vi.fn(),
  clearComposerDraft: vi.fn(),
})

vi.mock('@/features/chat/store', () => ({
  useChatStore: Object.assign(
    vi.fn((selector?: (s: ReturnType<typeof chatState>) => unknown) => (selector ? selector(chatState()) : chatState())),
    { getState: () => chatState() },
  ),
}))

vi.mock('@/features/chat', () => ({
  AgentPrompt: ({ content }: { content: string }) => createElement('div', { 'data-testid': 'agent-prompt' }, content),
  AgentResponse: ({ content }: { content: string }) => createElement('div', { 'data-testid': 'agent-response' }, content),
  ErrorBanner: ({ message }: { message: string }) => createElement('div', { 'data-testid': 'error-card' }, message),
  UserMessage: ({ content }: { content: string }) => createElement('div', { 'data-testid': 'user-message' }, content),
  ChatThinking: () => createElement('div', { 'data-testid': 'chat-thinking' }),
  useElapsedSeconds: () => 0,
  formatElapsed: (seconds: number) => `${seconds}s`,
  useWebSocketChat: vi.fn(() => ({
    sendMessage: vi.fn(),
    isStreaming: false,
    isLoading: false,
    respondToInteraction: vi.fn(),
    noteSendIntent: vi.fn(),
    pendingInteraction: null,
  })),
  useIsCurrentSessionBusy: vi.fn(() => false),
}))

let mockLayoutOverrides: Record<string, unknown> = {}
const layoutState = () => ({
  toggleSessionsPanel: vi.fn(),
  setDataSourcesPanelTab: vi.fn(),
  setDataSourcePanelTab: vi.fn(),
  enabledDataSourceIds: [] as string[],
  knowledgeLayerAvailable: false,
  availableDataSources: [] as Array<{ id: string; name?: string }>,
  activeSourcePreset: null,
  applySourcePreset: vi.fn(),
  toggleDataSource: vi.fn(),
  setEnabledDataSources: vi.fn(),
  fetchDataSources: vi.fn(),
  dataSourcesLoading: false,
  dataSourcesError: null as string | null,
  ...mockLayoutOverrides,
})

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: Object.assign(
    vi.fn((selector?: (s: ReturnType<typeof layoutState>) => unknown) => (selector ? selector(layoutState()) : layoutState())),
    { getState: () => layoutState() },
  ),
}))

vi.mock('@/adapters/auth', () => ({
  useAuth: () => ({ idToken: 'test-token', authRequired: true, isAuthenticated: true, user: { id: 'user-1', name: 'Max Mustermann' } }),
}))

vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    authRequired: true,
    fileUpload: {
      acceptedTypes: '.pdf,.docx,.txt,.md',
      acceptedMimeTypes: ['application/pdf', 'text/plain', 'text/markdown'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 100 * 1024 * 1024,
      maxFileCount: 10,
    },
  }),
}))

vi.mock('@/features/documents', () => ({
  UploadAnywayButton: () => null,
  useFileUpload: vi.fn(() => ({
    uploadFiles: vi.fn(),
    sessionFiles: [],
    deleteFile: vi.fn(),
    retryFile: vi.fn(),
    isUploading: false,
    error: null,
    clearError: vi.fn(),
  })),
  useFileDragDrop: vi.fn(() => ({
    isDragging: false,
    isUnsupportedDrag: false,
    refusal: null,
    dragHandlers: { onDragEnter: vi.fn(), onDragLeave: vi.fn(), onDragOver: vi.fn(), onDrop: vi.fn() },
  })),
}))

vi.mock('@/features/collaboration/hooks/use-sharing', () => ({
  useMentionCandidates: vi.fn(() => ({ data: null, loading: false, restart: vi.fn() })),
  useAwaitingState: vi.fn(() => ({ awaiting: null, refresh: vi.fn(), release: vi.fn() })),
  useSharing: () => ({
    state: null,
    loading: false,
    loadError: false,
    failure: null,
    dismissFailure: vi.fn(),
    saving: false,
    refresh: vi.fn(),
    setVisibility: vi.fn(async () => true),
    grant: vi.fn(async () => true),
    changeRole: vi.fn(async () => true),
    revoke: vi.fn(async () => true),
    escalate: vi.fn(async () => true),
  }),
  useShareCandidates: () => ({ candidates: [], loading: false, error: false, reload: vi.fn() }),
}))

vi.mock('@/features/collaboration/hooks/use-shared-thread', () => ({
  useSharedThread: () => ({
    shared: false,
    myRole: null,
    loading: false,
    connected: false,
    turnInFlight: null,
    typists: [],
    participants: [],
    unreadAfterMessageId: null,
    lastArrival: null,
    authorOf: () => null,
    engagement: 'ask',
    engagementSuggestion: null,
    setEngagement: async () => true,
    refresh: () => {},
    clearTurnInFlight: vi.fn(),
    noteTurnActivity: vi.fn(),
  }),
}))

vi.mock('@/features/collaboration/hooks/use-spectated-turn', () => ({
  useSpectatedTurn: () => ({ turn: null, live: false }),
}))

vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/shared/hooks/use-connection-presence', () => ({ useConnectionPresence: () => 'connected' }))

const sentAt = new Date('2026-10-09T08:00:00.000Z')
const exchange = [
  { id: 'user-1', role: 'user', content: 'Frage', messageType: 'user', timestamp: sentAt, thinkingSteps: [] },
  { id: 'answer-1', role: 'assistant', content: 'Antwort', messageType: 'agent_response' },
]

const WIDE_CLASS = /^max-w-\d+xl$/

const classesIn = (root: Element): string[] =>
  [root, ...root.querySelectorAll('*')].flatMap((el) => [...el.classList])

const rem = (cls: string, pattern: RegExp): number => {
  const match = cls.match(pattern)
  if (!match) throw new Error(`no ${pattern} in ${cls}`)
  return Number(match[1])
}

function expectRecipe(element: Element, recipe: string): void {
  expect([...element.classList]).toEqual(expect.arrayContaining(recipe.split(' ')))
}

function expectOnlyColumnWidths(root: Element, recipe: string): void {
  const own = recipe.split(' ')
  expect(classesIn(root).filter((cls) => WIDE_CLASS.test(cls) && !own.includes(cls))).toEqual([])
}

function columnAbove(anchor: Element): HTMLElement {
  const column = anchor.closest<HTMLElement>('[class*="max-w-"]')
  expect(column).not.toBeNull()
  return column as HTMLElement
}

beforeEach(() => {
  mockMessages = []
  mockProjectId = null
  mockStreaming = false
  mockLayoutOverrides = {}
  useAnswerRevealStore.setState({ revealingId: null })
  vi.unstubAllGlobals()
})

describe('the chat column', () => {
  test('ChatArea takes its width from thread-column.ts', () => {
    const { container } = render(createElement(ChatArea, { isAuthenticated: true }))
    const dock = screen.getByTestId('thread-status-dock')
    expectRecipe(columnAbove(dock), THREAD_COLUMN)
    expectRecipe(columnAbove(dock), THREAD_GUTTER)
    expectOnlyColumnWidths(container, THREAD_COLUMN)
  })

  test('chat-message-list takes its width from thread-column.ts', () => {
    mockMessages = exchange
    const { container } = render(createElement(ChatArea, { isAuthenticated: true }))
    const column = columnAbove(screen.getByTestId('agent-response'))
    expectRecipe(column, THREAD_COLUMN)
    expectRecipe(column, THREAD_GUTTER)
    expectOnlyColumnWidths(container, THREAD_COLUMN)
  })

  test('chat-area-states takes its width from thread-column.ts', () => {
    const { container } = render(createElement(MessageListSkeleton))
    const column = container.firstElementChild as HTMLElement
    expectRecipe(column, THREAD_COLUMN)
    expectRecipe(column, THREAD_GUTTER)
    expectOnlyColumnWidths(container, THREAD_COLUMN)
  })

  test('InputArea takes its width from thread-column.ts', () => {
    const { container } = render(createElement(InputArea, { isAuthenticated: true }))
    const column = columnAbove(screen.getByRole('textbox'))
    expectRecipe(column, THREAD_COLUMN)
    expectRecipe(column, THREAD_GUTTER)
    expectOnlyColumnWidths(container, THREAD_COLUMN)
  })

  test('ChatToolbar takes its width from thread-column.ts', () => {
    const { container } = render(createElement(ChatToolbar, { conversationId: 'session-1', isCollaborationEnabled: false }))
    const column = columnAbove(screen.getByTestId('thread-menu'))
    expectRecipe(column, THREAD_COLUMN_INNER)
    expectOnlyColumnWidths(container, THREAD_COLUMN_INNER)
  })

  test('NoSourcesBanner takes its width from thread-column.ts', () => {
    const { container } = render(createElement(NoSourcesBanner, { isAuthenticated: true }))
    const column = columnAbove(container.querySelector('[data-attr="chat-dismiss"]') as HTMLElement)
    expectRecipe(column, THREAD_COLUMN)
    expectRecipe(column, THREAD_GUTTER)
    expectOnlyColumnWidths(container, THREAD_COLUMN)
  })

  test('ChatUsageNotice takes its width from thread-column.ts', async () => {
    mockProjectId = 'proj-1'
    const notice = {
      level: 'warning',
      scope: 'organization',
      window: 'day',
      unit: 'credit',
      percent: 82,
      amounts: null,
      resetsAt: '2099-01-01T00:00:00.000Z',
      runsOutAt: null,
      canChange: false,
      href: '/app/organization/budgets',
      key: 'organization::day:2098-12-31:warning',
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ notice }), { status: 200 })))
    const { container } = render(createElement(ChatUsageNotice, { isAuthenticated: true }))
    const column = columnAbove(await screen.findByTestId('usage-notice'))
    expectRecipe(column, THREAD_COLUMN)
    expectRecipe(column, THREAD_GUTTER)
    expectOnlyColumnWidths(container, THREAD_COLUMN)
  })

  test('the inner column is the column less the `sm` gutter on both sides', () => {
    expect(THREAD_COLUMN).toContain('max-w-5xl')
    const gutter = rem(THREAD_GUTTER, /sm:pl-\[max\(([\d.]+)rem/)
    expect(rem(THREAD_GUTTER, /sm:pr-\[max\(([\d.]+)rem/)).toBe(gutter)
    expect(rem(THREAD_COLUMN_INNER, /max-w-\[([\d.]+)rem\]/)).toBe(64 - 2 * gutter)
  })
})
