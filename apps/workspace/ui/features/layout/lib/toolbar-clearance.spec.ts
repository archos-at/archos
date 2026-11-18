import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test-utils'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import { initialTurnView, type TurnView } from '@/lib/turns/turn-fold'
import { useAnswerRevealStore } from '@/features/chat/stores/answer-reveal-store'
import { useChatStore, type ChatStoreWithHydration } from '@/features/chat/store'
import { useFilePreviewStore } from '@/features/documents/stores/file-preview-store'
import type { ChatAreaProps } from '../components/chat-area/use-chat-area-controller'
import type { LayoutStore } from '../types'
import { ChatArea } from '../components/ChatArea'
import { MainLayout } from '../components/MainLayout'
import {
  TOOLBAR_CLEAR_PADDING,
  TOOLBAR_CLEAR_SCROLL_MARGIN,
  TOOLBAR_CLEAR_VAR,
  toolbarClearance,
} from './toolbar-clearance'

const MEASURED_TOOLBAR_PX = 163

let renderRealChatArea = false

vi.mock('../components/ChatArea', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/ChatArea')>()
  return {
    ChatArea: (props: ChatAreaProps) =>
      renderRealChatArea
        ? createElement(actual.ChatArea, props)
        : createElement('div', { 'data-testid': 'chat-area' }),
  }
})

vi.mock('../components/ChatToolbar', async () => {
  const { createElement: h, useEffect } = await import('react')
  return {
    ChatToolbar: ({
      sessionTitle,
      onHeightChange,
    }: {
      sessionTitle: string
      onHeightChange?: (height: number) => void
    }) => {
      useEffect(() => {
        onHeightChange?.(MEASURED_TOOLBAR_PX)
      }, [onHeightChange])
      return h('div', { 'data-testid': 'app-bar' }, sessionTitle)
    },
  }
})

vi.mock('../components/SessionsPanel', () => ({
  SessionsPanel: () => createElement('div', { 'data-testid': 'sessions-panel' }),
}))

vi.mock('../components/InputArea', () => ({
  InputArea: () => createElement('div', { 'data-testid': 'input-area' }),
}))

vi.mock('@/adapters/auth', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: { id: 'user-1', name: 'Max Mustermann' },
  })),
}))

vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    fileUpload: {
      acceptedTypes: '.pdf',
      acceptedMimeTypes: ['application/pdf'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 100 * 1024 * 1024,
      maxFileCount: 10,
    },
  }),
}))

vi.mock('@/hooks/use-session-url', () => ({
  useSessionUrl: vi.fn(() => ({
    updateSessionUrl: vi.fn(),
    clearSessionUrl: vi.fn(),
  })),
}))

vi.mock('@/features/chat', () => ({
  AgentPrompt: ({ content }: { content: string }) =>
    createElement('div', { 'data-testid': 'agent-prompt' }, content),
  AgentResponse: ({ content }: { content: string }) =>
    createElement('div', { 'data-testid': 'agent-response' }, content),
  ErrorBanner: ({ message }: { message: string }) =>
    createElement('div', { 'data-testid': 'error-card' }, message),
  UserMessage: ({
    content,
    author,
    grouped,
  }: {
    content: string
    author?: { name?: string | null; isYou?: boolean }
    grouped?: boolean
  }) =>
    createElement(
      'div',
      {
        'data-testid': 'user-message',
        'data-author': author ? (author.isYou ? 'you' : (author.name ?? 'unknown')) : undefined,
        'data-grouped': grouped ? 'true' : undefined,
      },
      content,
    ),
  ChatThinking: () => createElement('div', { 'data-testid': 'chat-thinking' }, 'Thinking...'),
  NoSourcesBanner: () => createElement('div', { 'data-testid': 'no-sources-banner' }),
  ChatUsageNotice: ({ isAuthenticated }: { isAuthenticated?: boolean }) =>
    isAuthenticated ? createElement('div', { 'data-testid': 'usage-notice-slot' }) : null,
  useElapsedSeconds: () => 0,
  formatElapsed: (seconds: number) => `${seconds}s`,
}))

vi.mock('@/features/chat/store', () => ({
  useChatStore: vi.fn(),
}))

vi.mock('../store', () => ({
  useLayoutStore: vi.fn(),
}))

vi.mock('@/features/collaboration/hooks/use-shared-thread', () => ({
  useSharedThread: () => INERT_SHARED_THREAD,
}))

vi.mock('@/features/collaboration/hooks/use-spectated-turn', () => ({
  useSpectatedTurn: () => ({ turn: null, live: false }),
}))

vi.mock('@/features/collaboration/hooks/use-sharing', () => ({
  useAwaitingState: vi.fn((_conversationId: string | null, enabled: boolean) => ({
    awaiting: enabled ? { pending: [], awaitingMe: false } : null,
    refresh: vi.fn(),
    release: vi.fn(),
  })),
}))

const INERT_SHARED_THREAD = {
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
  clearTurnInFlight: () => {},
  noteTurnActivity: () => {},
}

type ChatStoreFixture = DeepPartial<ChatStoreWithHydration>

const useStore = (state: ChatStoreFixture) =>
  vi
    .mocked(useChatStore)
    .mockImplementation((selector?: StoreSelector<ChatStoreWithHydration>) =>
      selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state,
    )

const transcript = (id: string, messages: unknown[]): ChatStoreFixture => ({
  currentConversation: { id, messages } as never,
  projectId: null,
  isLoading: false,
  isStreaming: false,
  hasHydrated: true,
  currentUserMessageId: null,
  pendingMessagesFor: null,
  setPendingMessagesFor: vi.fn(),
  respondToPrompt: vi.fn(),
  dismissErrorCard: vi.fn(),
  setComposerPrefill: vi.fn(),
  retryLastUserMessage: vi.fn(),
})

const asked = (id: string) => ({
  id,
  role: 'user',
  messageType: 'user',
  content: `question ${id}`,
})

const layoutChat: ChatStoreFixture = {
  currentConversation: { id: 'session-1', title: 'Test Session' } as never,
  getUserConversations: vi.fn(() => []),
  selectConversation: vi.fn(),
  startNewSessionDraft: vi.fn(),
  deleteConversation: vi.fn(),
  deleteAllConversations: vi.fn(),
  updateConversationTitle: vi.fn(),
  isStreaming: false,
  pendingInteraction: null,
} as ChatStoreFixture

const classesOf = (text: string): string[] => text.split(/\s+/).filter(Boolean)

describe('toolbar clearance', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    renderRealChatArea = false
    useAnswerRevealStore.setState({ revealingId: null })
    useFilePreviewStore.setState({ file: null, mode: 'modal', hidden: false })
    const { useLayoutStore } = await import('../store')
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state = {
        isSessionsPanelOpen: false,
        setSessionsPanelOpen: vi.fn(),
        enabledDataSourceIds: [],
      } as unknown as LayoutStore
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })
  })

  afterEach(() => {
    renderRealChatArea = false
  })

  it('is the measured height plus a breath, in whole pixels', () => {
    expect(toolbarClearance(163)).toBe('171px')
    expect(toolbarClearance(112.4)).toBe('121px')
  })

  it('falls back to the one-row values until the toolbar has been measured', () => {
    expect(TOOLBAR_CLEAR_PADDING).toContain('var(--chat-toolbar-clear,max(5rem,')
    expect(TOOLBAR_CLEAR_PADDING).toContain('sm:pt-[var(--chat-toolbar-clear,max(3.5rem,')
    expect(TOOLBAR_CLEAR_SCROLL_MARGIN).toContain('var(--chat-toolbar-clear,')
  })

  it('is the only place the transcript decides how far down the toolbar reaches', () => {
    renderRealChatArea = true
    useStore(transcript('c1', [asked('m1')]))
    render(createElement(ChatArea, { isAuthenticated: true, canCollaborate: true, onSignIn: vi.fn() }))

    const row = document.getElementById('message-m1')
    expect(row).not.toBeNull()
    expect(classesOf(row!.className)).toEqual(expect.arrayContaining(classesOf(TOOLBAR_CLEAR_SCROLL_MARGIN)))

    const firstPaddingClass = classesOf(TOOLBAR_CLEAR_PADDING)[0]
    let column: HTMLElement | null = row
    while (column && !column.classList.contains(firstPaddingClass)) column = column.parentElement
    expect(column).not.toBeNull()
    expect(classesOf(column!.className)).toEqual(expect.arrayContaining(classesOf(TOOLBAR_CLEAR_PADDING)))
  })

  it('is published on the chat column from the toolbar the column holds', () => {
    useStore(layoutChat)
    render(createElement(MainLayout, { isAuthenticated: true }))

    expect(screen.getByTestId('app-bar')).toBeInTheDocument()
    expect(
      screen.getByTestId('chat-drop-zone').style.getPropertyValue(TOOLBAR_CLEAR_VAR),
    ).toBe(toolbarClearance(MEASURED_TOOLBAR_PX))
  })
})
