import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { MainLayout } from './MainLayout'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { LayoutStore } from '../types'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import { useFilePreviewStore } from '@/features/documents/stores/file-preview-store'

const mockUpdateSessionUrl = vi.fn()
const mockClearSessionUrl = vi.fn()
const mockSelectConversation = vi.fn()
const mockStartNewSessionDraft = vi.fn()
const mockDeleteConversation = vi.fn()
const mockDeleteAllConversations = vi.fn()
const mockUpdateConversationTitle = vi.fn()

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
    updateSessionUrl: mockUpdateSessionUrl,
    clearSessionUrl: mockClearSessionUrl,
  })),
}))

let chatStoreOverrides: Record<string, unknown> = {}

vi.mock('@/features/chat', () => ({
  NoSourcesBanner: () => <div data-testid="no-sources-banner">No Sources Banner</div>,
  ChatUsageNotice: ({ isAuthenticated }: { isAuthenticated?: boolean }) =>
    isAuthenticated ? <div data-testid="usage-notice-slot" /> : null,
}))
vi.mock('@/features/chat/store', () => ({
  useChatStore: vi.fn((selector?: StoreSelector<ChatStoreWithHydration>) => {
    const state: DeepPartial<ChatStoreWithHydration> = {
      currentConversation: { id: 'session-1', title: 'Test Session' },
      getUserConversations: vi.fn(() => []),
      selectConversation: mockSelectConversation,
      startNewSessionDraft: mockStartNewSessionDraft,
      deleteConversation: mockDeleteConversation,
      deleteAllConversations: mockDeleteAllConversations,
      updateConversationTitle: mockUpdateConversationTitle,
      isStreaming: false,
      pendingInteraction: null,
      ...chatStoreOverrides,
    }
    return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
  }),
}))

vi.mock('../store', () => ({
  useLayoutStore: vi.fn((selector?: StoreSelector<LayoutStore>) => {
    const state: DeepPartial<LayoutStore> = {
      isSessionsPanelOpen: false,
      setSessionsPanelOpen: vi.fn(),
      enabledDataSourceIds: ['source-1', 'source-2'],
    }
    return selector ? selector(asStoreState<LayoutStore>(state)) : state
  }),
}))

vi.mock('./ChatToolbar', () => ({
  ChatToolbar: ({
    sessionTitle,
    onNewSession,
  }: {
    sessionTitle: string
    onNewSession?: () => void
  }) => (
    <>
      <div data-testid="app-bar">{sessionTitle}</div>
      <button type="button" onClick={onNewSession}>
        Header New Session
      </button>
    </>
  ),
}))

vi.mock('./SessionsPanel', () => ({
  SessionsPanel: ({ sessions }: { sessions?: Array<{ id: string }> }) => (
    <div data-testid="sessions-panel">
      {(sessions ?? []).map((s) => (
        <div key={s.id} data-testid={`session-item-${s.id}`} />
      ))}
    </div>
  ),
}))

vi.mock('./ChatArea', () => ({
  ChatArea: () => <div data-testid="chat-area">Chat Area</div>,
}))

vi.mock('./InputArea', () => ({
  InputArea: () => <div data-testid="input-area">Input Area</div>,
}))

import { useChatStore } from '@/features/chat/store'
import { useLayoutStore } from '../store'

describe('MainLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatStoreOverrides = {}
    useFilePreviewStore.setState({ file: null, mode: 'modal', hidden: false })
  })

  test('renders authenticated main sections', () => {
    render(<MainLayout isAuthenticated={true} />)

    expect(screen.getByTestId('app-bar')).toBeInTheDocument()
    expect(screen.getByTestId('sessions-panel')).toBeInTheDocument()
    expect(screen.getByTestId('chat-area')).toBeInTheDocument()
    expect(screen.getByTestId('input-area')).toBeInTheDocument()
    expect(screen.getByTestId('usage-notice-slot')).toBeInTheDocument()
  })

  test('renders core sections when unauthenticated', () => {
    render(<MainLayout />)

    expect(screen.getByTestId('app-bar')).toBeInTheDocument()
    expect(screen.getByTestId('sessions-panel')).toBeInTheDocument()
    expect(screen.getByTestId('chat-area')).toBeInTheDocument()
    expect(screen.getByTestId('input-area')).toBeInTheDocument()
    expect(screen.queryByTestId('usage-notice-slot')).toBeNull()
  })

  test('a chat the reader may no longer read shows the state instead of the transcript and the composer (ADR-0088)', () => {
    chatStoreOverrides = {
      currentConversation: { id: 'session-1', title: '', messages: [], contentLocked: true },
    }

    render(<MainLayout isAuthenticated={true} />)

    expect(screen.getByTestId('rights-lost')).toHaveTextContent('You no longer have the rights to view this chat')
    expect(screen.getByTestId('rights-lost')).toHaveTextContent('Shared chat')
    expect(screen.queryByTestId('chat-area')).toBeNull()
    expect(screen.queryByTestId('input-area')).toBeNull()
    expect(screen.queryByTestId('no-sources-banner')).toBeNull()
  })

  test('an ordinary chat shows its thread and no rights notice', () => {
    render(<MainLayout isAuthenticated={true} />)

    expect(screen.queryByTestId('rights-lost')).toBeNull()
    expect(screen.getByTestId('chat-area')).toBeInTheDocument()
  })

  test('passes session title to AppBar', () => {
    render(<MainLayout />)

    expect(screen.getByTestId('app-bar')).toHaveTextContent('Test Session')
  })

  test('shows no session title when no current conversation', () => {
    chatStoreOverrides = { currentConversation: null }

    render(<MainLayout />)

    expect(screen.getByTestId('app-bar')).toHaveTextContent('')
  })

  test('passes auth state to components', () => {
    render(<MainLayout isAuthenticated={true} />)

    expect(screen.getByTestId('app-bar')).toBeInTheDocument()
    expect(screen.getByTestId('chat-area')).toBeInTheDocument()
    expect(screen.getByTestId('input-area')).toBeInTheDocument()
  })

  test('wires the AppBar new session action to draft session flow', async () => {
    const user = userEvent.setup()

    render(<MainLayout isAuthenticated={true} />)

    await user.click(screen.getByRole('button', { name: /header new session/i }))

    expect(mockStartNewSessionDraft).toHaveBeenCalledOnce()
    expect(mockClearSessionUrl).toHaveBeenCalledOnce()
  })

  test('does not open data sources from new session while unauthenticated', async () => {
    const user = userEvent.setup()

    render(<MainLayout />)

    await user.click(screen.getByRole('button', { name: /header new session/i }))

    expect(mockStartNewSessionDraft).toHaveBeenCalledOnce()
    expect(mockClearSessionUrl).toHaveBeenCalledOnce()
  })

  test('keeps the new session action available while an answer is still being written', () => {
    vi.mocked(useChatStore).mockImplementation((selector?: StoreSelector<ChatStoreWithHydration>) => {
      const state: DeepPartial<ChatStoreWithHydration> = {
        currentConversation: { id: 'session-1', title: 'Test Session' },
        getUserConversations: vi.fn(() => []),
        selectConversation: vi.fn(),
        startNewSessionDraft: vi.fn(),
        deleteConversation: vi.fn(),
        deleteAllConversations: vi.fn(),
        updateConversationTitle: vi.fn(),
        isStreaming: true,
        pendingInteraction: null,
      }
      return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
    })

    render(<MainLayout />)

    expect(screen.getByRole('button', { name: /header new session/i })).not.toBeDisabled()
  })

  test('sessions panel only lists the active project\'s sessions (legacy unscoped fail open)', () => {
    const makeConv = (id: string, projectId?: string | null) => ({
      id,
      userId: 'user-1',
      projectId,
      title: id,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    vi.mocked(useChatStore).mockImplementation((selector?: StoreSelector<ChatStoreWithHydration>) => {
      const state: DeepPartial<ChatStoreWithHydration> = {
        currentConversation: null,
        currentUserId: 'user-1',
        projectId: 'proj-a',
        conversations: [
          makeConv('in-project', 'proj-a'),
          makeConv('other-project', 'proj-b'),
          makeConv('legacy', null),
          { ...makeConv('other-user', 'proj-a'), userId: 'user-2' },
        ],
        turns: {},
        unseenAnswers: {},
        getUserConversations: vi.fn(() => []),
        selectConversation: vi.fn(),
        startNewSessionDraft: vi.fn(),
        deleteConversation: vi.fn(),
        deleteAllConversations: vi.fn(),
        updateConversationTitle: vi.fn(),
        isStreaming: false,
        pendingInteraction: null,
      }
      return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
    })

    render(<MainLayout isAuthenticated={true} />)

    expect(screen.getByTestId('session-item-in-project')).toBeInTheDocument()
    expect(screen.getByTestId('session-item-legacy')).toBeInTheDocument()
    expect(screen.queryByTestId('session-item-other-project')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-item-other-user')).not.toBeInTheDocument()
  })

  test('keeps full width while a file is peeked — the split already made the room', () => {
    useFilePreviewStore.setState({
      file: { id: 'doc-1', filename: 'Brandschutzplan_EG.pdf' } as never,
      mode: 'peek',
      hidden: false,
    })
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
          isSessionsPanelOpen: false,
        setSessionsPanelOpen: vi.fn(),
        enabledDataSourceIds: ['source-1', 'source-2'],
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })

    const { container } = render(<MainLayout />)

    const chatContainer = container.querySelector('[style*="width"]')
    expect(chatContainer).toHaveStyle({ width: '100%' })
  })

  test('shows full width', () => {
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
          isSessionsPanelOpen: false,
        setSessionsPanelOpen: vi.fn(),
        enabledDataSourceIds: ['source-1', 'source-2'],
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })

    const { container } = render(<MainLayout />)

    const chatContainer = container.querySelector('[style*="width"]')
    expect(chatContainer).toHaveStyle({ width: '100%' })
  })
})
