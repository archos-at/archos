import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import type { ComposerPrefill, ComposerSubject } from '@/features/chat/types'
import { InputArea } from './InputArea'
import { emptyRunLedger, setRunStatus } from '@/lib/runs/run-ledger'
import { publishThreadRole, publishThreadSharing, resetThreadSharing } from '@/shared/collaboration/thread-sharing'
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

  test('disables input when the session is busy with no local turn of its own', () => {
    vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)

    render(<InputArea isAuthenticated={true} connectionMode="sse" />)

    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByPlaceholderText('Please wait...')).toBeInTheDocument()
  })

  test('disables input when session is busy (loading)', () => {
    vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)

    render(<InputArea isAuthenticated={true} connectionMode="sse" />)

    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByPlaceholderText('Please wait...')).toBeInTheDocument()
  })

  test('disables input when isBusy is true (session has active operations)', () => {
    vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)

    render(<InputArea isAuthenticated={true} connectionMode="websocket" />)

    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByPlaceholderText('Please wait...')).toBeInTheDocument()
  })

  test('enables input when isBusy returns to false', () => {
    vi.mocked(useIsCurrentSessionBusy).mockReturnValue(false)

    render(<InputArea isAuthenticated={true} connectionMode="websocket" />)

    expect(screen.getByRole('textbox')).not.toBeDisabled()
  })

  test('does not allow sending when session is busy', () => {
    vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)

    render(<InputArea isAuthenticated={true} connectionMode="websocket" />)

    const input = screen.getByRole('textbox')
    expect(input).toBeDisabled()
  })

  test('input enabled during plan approval even when session is busy (HITL override)', async () => {
    vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
    vi.mocked(useWebSocketChat).mockReturnValue({
      sendMessage: mockSendMessage,
      isStreaming: false,
      isLoading: false,
      respondToInteraction: mockRespondToInteraction,
      noteSendIntent: mockNoteSendIntent,
      pendingInteraction: { id: 'prompt-1', type: 'input', content: 'Approve plan?' },
    } as unknown as ReturnType<typeof useWebSocketChat>)

    render(<InputArea isAuthenticated={true} connectionMode="websocket" />)

    expect(screen.getByRole('textbox')).not.toBeDisabled()
    expect(screen.getByPlaceholderText(`Type your response to ${PRODUCT_NAME}...`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send response/i })).toBeInTheDocument()
  })

  test('does not assign positive tab indexes in response mode', () => {
    vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
    vi.mocked(useWebSocketChat).mockReturnValue({
      sendMessage: mockSendMessage,
      isStreaming: false,
      isLoading: false,
      respondToInteraction: mockRespondToInteraction,
      noteSendIntent: mockNoteSendIntent,
      pendingInteraction: {
        id: 'prompt-1',
        parentId: 'agent-1',
        inputType: 'approval',
        text: 'Approve plan?',
      },
    } as unknown as ReturnType<typeof useWebSocketChat>)

    render(<InputArea isAuthenticated={true} connectionMode="websocket" />)

    expect(screen.getByRole('textbox')).not.toHaveAttribute('tabindex')
    expect(screen.getByRole('button', { name: /send response/i })).not.toHaveAttribute('tabindex')
  })

  test('the composer stays open while a run is going in the thread', () => {
    mockConversationMessages = [
      {
        messageType: 'agent_response',
        runLedger: setRunStatus(emptyRunLedger('run-1'), 'running'),
      },
    ]

    render(<InputArea isAuthenticated={true} connectionMode="websocket" />)

    expect(screen.getByRole('textbox')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start new session/i })).not.toBeInTheDocument()
  })

  test('the composer stays open after a run finished: a follow-up runs in the same thread', () => {
    mockConversationMessages = [
      {
        messageType: 'agent_response',
        runLedger: setRunStatus(emptyRunLedger('run-1'), 'done'),
      },
    ]

    render(<InputArea isAuthenticated={true} connectionMode="websocket" />)

    expect(screen.getByRole('textbox')).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: /start new session/i })).not.toBeInTheDocument()
  })

  test('input enabled during HITL even when a run is in progress', async () => {
    const user = userEvent.setup()
    vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
    mockConversationMessages = [
      {
        messageType: 'agent_response',
        runLedger: setRunStatus(emptyRunLedger('run-1'), 'running'),
      },
    ]
    vi.mocked(useWebSocketChat).mockReturnValue({
      sendMessage: mockSendMessage,
      isStreaming: false,
      isLoading: false,
      respondToInteraction: mockRespondToInteraction,
      noteSendIntent: mockNoteSendIntent,
      pendingInteraction: { id: 'prompt-1', type: 'input', content: 'Approve report plan?' },
    } as unknown as ReturnType<typeof useWebSocketChat>)

    render(<InputArea isAuthenticated={true} connectionMode="websocket" />)

    expect(screen.getByRole('textbox')).not.toBeDisabled()
    expect(screen.getByPlaceholderText(`Type your response to ${PRODUCT_NAME}...`)).toBeInTheDocument()
    const sendButton = screen.getByRole('button', { name: /send response/i })
    expect(sendButton).toBeInTheDocument()

    await user.type(screen.getByRole('textbox'), 'approve')
    await user.click(sendButton)
    expect(mockRespondToInteraction).toHaveBeenCalledWith('approve')
  })

  describe('a viewer in a shared thread', () => {
    const asViewer = () => {
      publishThreadSharing('session-1', true)
      publishThreadRole('session-1', 'viewer')
    }

    const withFiles = () => {
      vi.mocked(useFileUpload).mockReturnValue({
        uploadFiles: mockUploadFiles,
        deleteFile: mockDeleteFile,
        retryFile: mockRetryFile,
        sessionFiles: [
          { id: 'file-1', fileName: 'doc.pdf', status: 'success', collectionName: 'session-1' },
          { id: 'file-2', fileName: 'kaputt.pdf', status: 'failed', collectionName: 'session-1' },
        ],
        isUploading: false,
        error: null,
        clearError: vi.fn(),
      } as unknown as ReturnType<typeof useFileUpload>)
    }

    test('cannot attach, cannot change the Datengrundlage, cannot send', () => {
      asViewer()
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      expect(screen.getByRole('textbox')).toBeDisabled()
      expect(screen.getByRole('button', { name: /attach files/i })).toBeDisabled()
      expect(screen.queryByRole('button', { name: /data basis/i })).not.toBeInTheDocument()
    })

    test.skip('cannot apply a preset either, which also writes the Datenbasis', async () => {
      const user = userEvent.setup()
      asViewer()
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      const trigger = screen.getByRole('button', { name: /data basis/i })
      expect(trigger).toBeDisabled()
      await user.click(trigger)
      expect(
        screen.queryByRole('radio', { name: /building law & guidelines/i })
      ).not.toBeInTheDocument()
      expect(mockApplySourcePreset).not.toHaveBeenCalled()
    })

    test('cannot remove or retry a file off somebody else’s thread', () => {
      asViewer()
      withFiles()
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      expect(screen.getByText('doc.pdf')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /open .*doc\.pdf/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    })

    test('has no route to the manage-files surface, on a phone either', () => {
      asViewer()
      withFiles()
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      expect(screen.getByRole('button', { name: /manage attached files/i })).toBeDisabled()
      expect(screen.queryByRole('button', { name: /^manage \d/i })).not.toBeInTheDocument()
    })

    test('is not invited to mention anybody either', () => {
      asViewer()
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      expect(screen.queryByTestId('composer-mention-offer')).not.toBeInTheDocument()
    })

    test('a collaborator keeps every one of those', () => {
      publishThreadSharing('session-1', true)
      publishThreadRole('session-1', 'collaborator')
      withFiles()
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      expect(screen.getByRole('textbox')).not.toBeDisabled()
      expect(screen.getByRole('button', { name: /attach files/i })).not.toBeDisabled()
      expect(screen.getAllByRole('button', { name: /remove/i }).length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^manage \d/i })).toBeInTheDocument()
      expect(screen.getByTestId('composer-mention-offer')).toBeInTheDocument()
    })

    test.skip('the presets outlive onboarding — they are in the picker, not on a chip row', async () => {
      const user = userEvent.setup()
      mockConversationMessages = [{ id: 'm1', role: 'user', content: 'hello' }]
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      await user.click(screen.getByRole('button', { name: /data basis/i }))
      expect(screen.getByRole('radio', { name: /building law & guidelines/i })).toBeInTheDocument()
    })
  })

})
