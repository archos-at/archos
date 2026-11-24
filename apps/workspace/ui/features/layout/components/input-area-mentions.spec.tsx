import { fireEvent, render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import type { ComposerPrefill, ComposerSubject } from '@/features/chat/types'
import { InputArea } from './InputArea'
import { publishThreadSharing, resetThreadSharing } from '@/shared/collaboration/thread-sharing'
import { useWebSocketChat, useIsCurrentSessionBusy } from '@/features/chat'
import { useFileUpload, useFileDragDrop } from '@/features/documents'
import { PRODUCT_NAME } from '@/lib/brand'
import { AGENT_CANDIDATE, ANNA_CANDIDATE, MARKUS_CANDIDATE } from './input-area.fixtures'

const mockSendMessage = vi.fn()
const mockRespondToInteraction = vi.fn()
const mockNoteSendIntent = vi.fn()

let mockConversationMessages: unknown[] | undefined = []
let mockCurrentSessionId: string | null = 'session-1'
let mockComposerPrefill: ComposerPrefill | null = null
let mockComposerSubject: ComposerSubject | null = null
const mockSetComposerSubject = vi.fn((next: ComposerSubject | null) => {
  mockComposerSubject = next
})
let mockDrafts: Record<string, string> = {}
let mockIsStreaming = false
const mockStopStreaming = vi.fn()
const mockStartNewSessionDraft = vi.fn()

const mockSaveDataSourcesToConversation = vi.fn()

const mockEnsureConversationExists = vi.fn(async () => {})

function mockChatState() {
  return {
    currentConversation: mockCurrentSessionId
      ? { id: mockCurrentSessionId, messages: mockConversationMessages }
      : null,
    conversations: mockCurrentSessionId
      ? [{ id: mockCurrentSessionId, messages: mockConversationMessages ?? [] }]
      : [],
    saveDataSourcesToConversation: mockSaveDataSourcesToConversation,
    isStreaming: mockIsStreaming,
    stopStreaming: mockStopStreaming,
    ensureSession: vi.fn(() => {
      if (!mockCurrentSessionId) mockCurrentSessionId = 'session-new'
      return mockCurrentSessionId
    }),
    _ensureConversationExists: mockEnsureConversationExists,
    startNewSessionDraft: mockStartNewSessionDraft,
    setRespondToInteractionFn: vi.fn(),
    setChatSendFn: vi.fn(),
    composerPrefill: mockComposerPrefill,
    consumeComposerPrefill: vi.fn(() => {
      const value = mockComposerPrefill
      mockComposerPrefill = null
      return value
    }),
    composerSubject: mockComposerSubject,
    setComposerSubject: mockSetComposerSubject,
    composerDrafts: mockDrafts,
    getComposerDraft: (id: string) => mockDrafts[id] ?? '',
    setComposerDraft: (id: string, text: string) => {
      if (text === '') {
        delete mockDrafts[id]
        return
      }
      mockDrafts[id] = text
    },
    clearComposerDraft: (id: string) => {
      delete mockDrafts[id]
    },
  }
}

vi.mock('@/features/chat', () => ({
  useWebSocketChat: vi.fn(() => ({
    sendMessage: mockSendMessage,
    isStreaming: false,
    isLoading: false,
    respondToInteraction: mockRespondToInteraction,
    noteSendIntent: mockNoteSendIntent,
    pendingInteraction: null,
  })),
  useIsCurrentSessionBusy: vi.fn(() => false),
}))
vi.mock('@/features/chat/store', () => ({
  useChatStore: Object.assign(
    vi.fn((selector: (s: ReturnType<typeof mockChatState>) => unknown) => selector(mockChatState())),
    { getState: () => mockChatState() },
  ),
}))

const mockSetDataSourcePanelTab = vi.fn()

const mockSetDataSourcesPanelTab = vi.fn()
const mockApplySourcePreset = vi.fn()
let mockActiveSourcePreset: string | null = null
let mockAvailableDataSources: Array<{ id: string; name?: string }> = [
  { id: 'source-1', name: 'Quelle eins' },
  { id: 'source-2', name: 'Quelle zwei' },
]
let mockEnabledDataSourceIds: string[] = ['source-1', 'source-2']

const mockToggleDataSource = vi.fn()
const mockSetEnabledDataSources = vi.fn()
const mockFetchDataSources = vi.fn()

const mockLayoutState = () => ({
  setDataSourcesPanelTab: mockSetDataSourcesPanelTab,
  setDataSourcePanelTab: mockSetDataSourcePanelTab,
  enabledDataSourceIds: mockEnabledDataSourceIds,
  knowledgeLayerAvailable: true,
  availableDataSources: mockAvailableDataSources,
  activeSourcePreset: mockActiveSourcePreset,
  applySourcePreset: mockApplySourcePreset,
  toggleDataSource: mockToggleDataSource,
  setEnabledDataSources: mockSetEnabledDataSources,
  fetchDataSources: mockFetchDataSources,
  dataSourcesLoading: false,
  dataSourcesError: null as string | null,
})

type MockLayoutState = ReturnType<typeof mockLayoutState>

vi.mock('../store', () => ({
  useLayoutStore: Object.assign(
    vi.fn((selector?: (s: MockLayoutState) => unknown) => {
      const state = mockLayoutState()
      return selector ? selector(state) : state
    }),
    { getState: () => mockLayoutState() }
  ),
}))

vi.mock('@/adapters/auth', () => ({
  useAuth: () => ({ idToken: 'test-token', authRequired: true }),
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

const mockUploadFiles = vi.fn()

const mockDeleteFile = vi.fn()
const mockRetryFile = vi.fn()

vi.mock('@/features/documents', () => ({
  UploadAnywayButton: () => null,
  useFileUpload: vi.fn(() => ({
    uploadFiles: mockUploadFiles,
    sessionFiles: [],
    deleteFile: mockDeleteFile,
    retryFile: mockRetryFile,
    isUploading: false,
    error: null,
    clearError: vi.fn(),
  })),
  useFileDragDrop: vi.fn(() => ({
    isDragging: false,
    isUnsupportedDrag: false,
    refusal: null,
    dragHandlers: {
      onDragEnter: vi.fn(),
      onDragLeave: vi.fn(),
      onDragOver: vi.fn(),
      onDrop: vi.fn(),
    },
  })),
}))

let mockMentionData: unknown = {
  candidates: [AGENT_CANDIDATE, ANNA_CANDIDATE, MARKUS_CANDIDATE],
  canInvite: true,
}
let mockMentionsLoading = false
const mockRestartMentionCandidates = vi.fn()

let mockAwaitingPending: Array<{ id: string }> = []

vi.mock('@/features/collaboration/hooks/use-sharing', () => ({
  useMentionCandidates: vi.fn((conversationId: string | null, enabled: boolean) => {
    const answering = enabled && conversationId !== null
    return {
      data: answering ? mockMentionData : null,
      loading: answering ? mockMentionsLoading : false,
      restart: mockRestartMentionCandidates,
    }
  }),
  useAwaitingState: vi.fn((_conversationId: string | null, enabled: boolean) => ({
    awaiting: enabled ? { pending: mockAwaitingPending, awaitingMe: false } : null,
    refresh: vi.fn(),
    release: vi.fn(),
  })),
}))

describe('InputArea', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConversationMessages = []
    mockCurrentSessionId = 'session-1'
    mockComposerPrefill = null
    mockComposerSubject = null
    mockDrafts = {}
    mockActiveSourcePreset = null
    mockIsStreaming = false
    mockAvailableDataSources = [
      { id: 'source-1', name: 'Quelle eins' },
      { id: 'source-2', name: 'Quelle zwei' },
    ]
    mockEnabledDataSourceIds = ['source-1', 'source-2']
    mockMentionData = {
      candidates: [AGENT_CANDIDATE, ANNA_CANDIDATE, MARKUS_CANDIDATE],
      canInvite: true,
    }
    mockMentionsLoading = false
    mockRestartMentionCandidates.mockClear()
    mockAwaitingPending = []
    resetThreadSharing()
    vi.mocked(useFileDragDrop).mockReturnValue({
      isDragging: false,
      isUnsupportedDrag: false,
      refusal: null,
      dragHandlers: {
        onDragEnter: vi.fn(),
        onDragLeave: vi.fn(),
        onDragOver: vi.fn(),
        onDrop: vi.fn(),
      },
    })
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      retryFile: mockRetryFile,
      sessionFiles: [],
      isUploading: false,
      error: null,
      clearError: vi.fn(),
    } as unknown as ReturnType<typeof useFileUpload>)
    mockSendMessage.mockReset()
    vi.mocked(useIsCurrentSessionBusy).mockReturnValue(false)
    vi.mocked(useWebSocketChat).mockReturnValue({
      sendMessage: mockSendMessage,
      isStreaming: false,
      isLoading: false,
      respondToInteraction: mockRespondToInteraction,
      noteSendIntent: mockNoteSendIntent,
      pendingInteraction: null,
    } as unknown as ReturnType<typeof useWebSocketChat>)
  })

  describe('@-mentions', () => {
    const composer = () => screen.getByPlaceholderText(`Ask ${PRODUCT_NAME} about this project …`)
    const optionTargets = () =>
      screen.getAllByTestId('mention-option').map((row) => row.getAttribute('data-target-id'))

    test('typing @ at a word boundary opens the picker', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('Frage an @')

      expect(await screen.findByTestId('mention-picker')).toBeInTheDocument()
      expect(screen.getByText('Anna Weber')).toBeInTheDocument()
      expect(screen.getByText(PRODUCT_NAME)).toBeInTheDocument()
    })

    test('typing after the @ filters the candidates', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@hof')

      expect(await screen.findByTestId('mention-picker')).toBeInTheDocument()
      expect(optionTargets()).toEqual(['u-markus'])
    })

    test('does not open inside a word — an email address is not a mention', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('anna@example.com')

      expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument()
    })

    test('Enter inserts the selected candidate and does NOT send the message', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')

      expect(composer()).toHaveValue('@Anna Weber ')
      expect(mockSendMessage).not.toHaveBeenCalled()
      expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument()
    })

    test('Tab inserts too', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Tab}')

      expect(composer()).toHaveValue('@Anna Weber ')
    })

    test('a press on a candidate keeps the focus in the field, and the tap still inserts', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      const [row] = await screen.findAllByTestId('mention-option')

      expect(fireEvent.pointerDown(row!)).toBe(false)
      expect(fireEvent.mouseDown(row!)).toBe(false)
      expect(composer()).toHaveFocus()

      fireEvent.click(row!)
      expect(composer()).toHaveValue('@Anna Weber ')
      expect(composer()).toHaveFocus()
    })

    test('the arrow keys choose which candidate is inserted', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{ArrowDown}{Enter}')

      expect(composer()).toHaveValue('@Anna Weber ')
    })

    test('Escape closes the picker, and a fresh @ opens it again', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@an')
      await screen.findByTestId('mention-picker')

      await user.keyboard('{Escape}')
      expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument()

      await user.keyboard(' und @ma')
      expect(await screen.findByTestId('mention-picker')).toBeInTheDocument()
      expect(optionTargets()).toEqual(['u-markus'])
    })

    test('deleting the @ closes the picker', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@a')
      await screen.findByTestId('mention-picker')

      await user.keyboard('{Backspace}{Backspace}')
      expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument()
    })

    test('the textarea is a combobox pointing at the active option while open', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@an')
      await screen.findByTestId('mention-picker')

      const input = composer()
      expect(input).toHaveAttribute('role', 'combobox')
      expect(input).toHaveAttribute('aria-expanded', 'true')
      expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
      await waitFor(() =>
        expect(input).toHaveAttribute(
          'aria-activedescendant',
          screen.getAllByRole('option')[0].id,
        ),
      )

      await user.keyboard('{Escape}')
      expect(composer()).not.toHaveAttribute('aria-controls')
      expect(composer()).not.toHaveAttribute('aria-expanded')
    })

  })

  describe('addressee indicator', () => {
    const composer = () => screen.getByPlaceholderText(`Ask ${PRODUCT_NAME} about this project …`)
    const addressee = () => screen.getByTestId('composer-addressee')

    test('says nothing about a plain message, which goes to the agent', () => {
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      expect(addressee()).toHaveAttribute('data-mode', 'agent')
      expect(addressee()).not.toHaveTextContent(/goes to/i)
      expect(screen.getByTestId('composer-mention-offer')).toBeInTheDocument()
    })

    test('switches to the tagged person as the mention is inserted', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      expect(addressee()).not.toHaveTextContent(/goes to/i)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')

      expect(addressee()).toHaveTextContent('Goes to Anna Weber')
      expect(addressee()).toHaveAttribute('data-mode', 'people')
      await user.clear(composer())
      expect(addressee()).toHaveAttribute('data-mode', 'agent')
      expect(addressee()).not.toHaveTextContent(/goes to/i)
      expect(screen.getByTestId('composer-mention-offer')).toBeInTheDocument()
    })

    test('says the message goes to the CHAT while the thread awaits a person, and how to reach the agent', () => {
      mockAwaitingPending = [{ id: 'r-1' }]
      publishThreadSharing('session-1', true)
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      expect(addressee()).toHaveTextContent('Goes to everyone in the chat')
      expect(screen.getByTestId('composer-agent-hint')).toHaveTextContent(
        `Type @${PRODUCT_NAME} to ask ${PRODUCT_NAME}`,
      )
    })

    test('typing the agent mention while awaiting flips the line back to the agent', async () => {
      const user = userEvent.setup()
      mockAwaitingPending = [{ id: 'r-1' }]
      publishThreadSharing('session-1', true)
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard(`@${PRODUCT_NAME.slice(0, 3).toLowerCase()}`)
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')

      expect(addressee()).toHaveAttribute('data-mode', 'agent')
      expect(addressee()).not.toHaveTextContent('everyone in the chat')
      expect(screen.queryByTestId('composer-agent-hint')).not.toBeInTheDocument()
    })

    test('tagging a person AND the agent names both and drops the "stays quiet" claim', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')
      await user.keyboard(`@${PRODUCT_NAME.slice(0, 3).toLowerCase()}`)
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')

      expect(addressee()).toHaveTextContent(`Goes to Anna Weber, ${PRODUCT_NAME}`)
      expect(screen.queryByTestId('composer-mention-hint')).not.toBeInTheDocument()
    })

    test('with collaboration off the composer is exactly today’s — no line, no hint (NF-8)', async () => {
      const user = userEvent.setup()
      mockAwaitingPending = [{ id: 'r-1' }]
      publishThreadSharing('session-1', true)
      render(<InputArea isAuthenticated connectionMode="sse" />)

      expect(screen.queryByTestId('composer-addressee')).not.toBeInTheDocument()
      expect(screen.queryByTestId('composer-agent-hint')).not.toBeInTheDocument()

      await user.click(composer())
      await user.keyboard('Frage')
      await user.click(screen.getByRole('button', { name: /send message/i }))
      expect(mockSendMessage).toHaveBeenCalledWith('Frage')
    })
  })

})
