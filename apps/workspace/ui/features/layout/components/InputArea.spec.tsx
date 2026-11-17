import { act, fireEvent, render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import type { ComposerPrefill, ComposerSubject } from '@/features/chat/types'
import { InputArea } from './InputArea'
import { ChatDropZone } from './chat-drop-zone'
import { emptyRunLedger, setRunStatus } from '@/lib/runs/run-ledger'

import {
  bumpThreadRevision,
  publishThreadRole,
  publishThreadSharing,
  publishTurnActor,
  resetThreadSharing,
} from '@/shared/collaboration/thread-sharing'
import { useAwaitingState } from '@/features/collaboration/hooks/use-sharing'

vi.mock('@/shared/collaboration/thread-sharing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/collaboration/thread-sharing')>()),
  bumpThreadRevision: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}))

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

const AGENT_CANDIDATE = {
  targetId: 'agent:piloti',
  person: { userId: 'agent:piloti', name: PRODUCT_NAME, email: null, profilePictureUrl: null },
  isAgent: true,
  isParticipant: true,
  needsInvite: false,
}
const ANNA_CANDIDATE = {
  targetId: 'u-anna',
  person: {
    userId: 'u-anna',
    name: 'Anna Weber',
    email: 'anna@example.com',
    profilePictureUrl: null,
  },
  isAgent: false,
  isParticipant: true,
  needsInvite: false,
}
const MARKUS_CANDIDATE = {
  targetId: 'u-markus',
  person: {
    userId: 'u-markus',
    name: 'Markus Hofer',
    email: 'markus@example.com',
    profilePictureUrl: null,
  },
  isAgent: false,
  isParticipant: true,
  needsInvite: false,
}

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

vi.mock('./FileSourcesTab', () => ({
  FileSourcesTab: () => null,
}))

vi.mock('@/features/documents/components/file-preview-dialog', () => ({
  FilePreviewDialog: ({ file }: { file: { filename: string } | null }) =>
    file ? <div data-testid="file-preview">{file.filename}</div> : null,
}))

import { useWebSocketChat, useIsCurrentSessionBusy } from '@/features/chat'
import { useFileUpload, useFileDragDrop } from '@/features/documents'
import { useMentionCandidates } from '@/features/collaboration/hooks/use-sharing'
import { PRODUCT_NAME } from '@/lib/brand'

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

  test('does not render the Auto mode selector button', () => {
    render(<InputArea isAuthenticated={true} />)

    expect(screen.queryByText('Auto')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /query type/i })).not.toBeInTheDocument()
  })

  test('renders text area with default placeholder', () => {
    render(<InputArea isAuthenticated={true} />)

    expect(
      screen.getByPlaceholderText(`Ask ${PRODUCT_NAME} about this project …`)
    ).toBeInTheDocument()
  })

  test('renders with custom placeholder', () => {
    render(<InputArea isAuthenticated={true} placeholder="Type your question" />)

    expect(screen.getByPlaceholderText('Type your question')).toBeInTheDocument()
  })

  test('shows sign in placeholder when not authenticated', () => {
    render(<InputArea isAuthenticated={false} />)

    expect(screen.getByPlaceholderText('Sign in to start working')).toBeInTheDocument()
  })

  test('disables input when not authenticated', () => {
    render(<InputArea isAuthenticated={false} />)

    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  test('disables send button when message is empty', () => {
    render(<InputArea isAuthenticated={true} />)

    expect(screen.getByRole('button', { name: /send message/i })).toBeDisabled()
  })

  test('all composer controls are keyboard reachable via tab', async () => {
    const user = userEvent.setup()
    render(<InputArea isAuthenticated={true} />)

    const input = screen.getByRole('textbox')
    await user.tab()
    expect(input).toHaveFocus()

    await user.type(input, 'Hello')

    await user.tab()
    expect(screen.getByRole('button', { name: /turn on temporary chat/i })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: /effort: medium/i })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: /attach files/i })).toHaveFocus()

    await user.tab()
    expect(screen.getByTestId('dictation-unavailable')).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: /send message/i })).toHaveFocus()
  })

  test('enables send button when message is typed', async () => {
    const user = userEvent.setup()
    render(<InputArea isAuthenticated={true} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'Hello')

    expect(screen.getByRole('button', { name: /send message/i })).not.toBeDisabled()
  })

  test('calls sendMessage when send button is clicked', async () => {
    const user = userEvent.setup()
    render(<InputArea isAuthenticated={true} connectionMode="sse" />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'Hello world')
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(mockSendMessage).toHaveBeenCalledWith('Hello world')
  })

  test('clears input after sending message', async () => {
    const user = userEvent.setup()
    render(<InputArea isAuthenticated={true} connectionMode="sse" />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'Hello world')
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(input).toHaveValue('')
  })

  test('sends message on Enter key', async () => {
    const user = userEvent.setup()
    render(<InputArea isAuthenticated={true} connectionMode="sse" />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'Hello world{enter}')

    expect(mockSendMessage).toHaveBeenCalledWith('Hello world')
  })

  test('sends message on Cmd+Enter (Meta)', async () => {
    const user = userEvent.setup()
    render(<InputArea isAuthenticated={true} connectionMode="sse" />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'Hello world')
    await user.keyboard('{Meta>}{Enter}{/Meta}')

    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(mockSendMessage).toHaveBeenCalledWith('Hello world')
  })

  test('sends message on Ctrl+Enter', async () => {
    const user = userEvent.setup()
    render(<InputArea isAuthenticated={true} connectionMode="sse" />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'Hello world')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(mockSendMessage).toHaveBeenCalledWith('Hello world')
  })

  test('Shift+Enter inserts a newline and does not send', async () => {
    const user = userEvent.setup()
    render(<InputArea isAuthenticated={true} connectionMode="sse" />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'line one')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    await user.type(input, 'line two')

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(input).toHaveValue('line one\nline two')
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

  test('renders attach files button', () => {
    render(<InputArea isAuthenticated={true} />)

    expect(screen.getByRole('button', { name: /attach files/i })).toBeInTheDocument()
  })

  test('shows response mode placeholder when pending interaction', () => {
    vi.mocked(useWebSocketChat).mockReturnValue({
      sendMessage: mockSendMessage,
      isStreaming: false,
      isLoading: false,
      respondToInteraction: mockRespondToInteraction,
      noteSendIntent: mockNoteSendIntent,
      pendingInteraction: { id: 'prompt-1', type: 'input', content: 'Please provide more details' },
    } as unknown as ReturnType<typeof useWebSocketChat>)

    render(<InputArea isAuthenticated={true} connectionMode="websocket" />)

    expect(screen.getByPlaceholderText(`Type your response to ${PRODUCT_NAME}...`)).toBeInTheDocument()
  })

  test('calls respondToInteraction in response mode', async () => {
    const user = userEvent.setup()
    vi.mocked(useWebSocketChat).mockReturnValue({
      sendMessage: mockSendMessage,
      isStreaming: false,
      isLoading: false,
      respondToInteraction: mockRespondToInteraction,
      noteSendIntent: mockNoteSendIntent,
      pendingInteraction: { id: 'prompt-1', type: 'input', content: 'Please provide more details' },
    } as unknown as ReturnType<typeof useWebSocketChat>)

    render(<InputArea isAuthenticated={true} connectionMode="websocket" />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'My response')
    await user.click(screen.getByRole('button', { name: /send response/i }))

    expect(mockRespondToInteraction).toHaveBeenCalledWith('My response')
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  test('shows file count badge and inline chips when files are attached', () => {
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      retryFile: mockRetryFile,
      sessionFiles: [
        { id: 'file-1', fileName: 'doc.pdf', status: 'success', collectionName: 'session-1' },
        { id: 'file-2', fileName: 'doc2.pdf', status: 'uploading', collectionName: 'session-1' },
      ],
      isUploading: false,
      error: null,
      clearError: vi.fn(),
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<InputArea isAuthenticated={true} />)

    expect(screen.getByRole('button', { name: /manage attached files/i })).toHaveTextContent('2')
    expect(screen.getByText('doc.pdf')).toBeInTheDocument()
    expect(screen.getByText('doc2.pdf')).toBeInTheDocument()
  })

  test('clicking a successful file chip opens the read-only preview dialog', async () => {
    const user = userEvent.setup()
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      retryFile: mockRetryFile,
      sessionFiles: [
        {
          id: 'file-1',
          fileName: 'doc.pdf',
          fileSize: 1234,
          status: 'success',
          collectionName: 'session-1',
        },
      ],
      isUploading: false,
      error: null,
      clearError: vi.fn(),
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<InputArea isAuthenticated={true} />)

    expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /open file: doc\.pdf/i }))

    expect(screen.getByTestId('file-preview')).toHaveTextContent('doc.pdf')
  })

  test('a still-uploading file chip is not clickable to open a preview', () => {
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      retryFile: mockRetryFile,
      sessionFiles: [
        { id: 'file-1', fileName: 'up.pdf', status: 'uploading', collectionName: 'session-1' },
      ],
      isUploading: false,
      error: null,
      clearError: vi.fn(),
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<InputArea isAuthenticated={true} />)

    expect(screen.queryByRole('button', { name: /open file: up\.pdf/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument()
  })

  test('removing an inline file chip calls deleteFile', async () => {
    const user = userEvent.setup()
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      retryFile: mockRetryFile,
      sessionFiles: [
        { id: 'file-1', fileName: 'doc.pdf', status: 'success', collectionName: 'session-1' },
      ],
      isUploading: false,
      error: null,
      clearError: vi.fn(),
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<InputArea isAuthenticated={true} />)

    await user.click(screen.getByRole('button', { name: /remove file: doc\.pdf/i }))
    expect(mockDeleteFile).toHaveBeenCalledWith('file-1')
  })

  test('shows upload error when present', () => {
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      sessionFiles: [],
      isUploading: false,
      error: 'File too large',
      clearError: vi.fn(),
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<InputArea isAuthenticated={true} />)

    expect(screen.getByText('File too large')).toBeInTheDocument()
  })

  test('shows drag overlay when dragging files', () => {
    vi.mocked(useFileDragDrop).mockReturnValue({
      isDragging: true,
      isUnsupportedDrag: false,
      refusal: null,
      dragHandlers: {
        onDragEnter: vi.fn(),
        onDragLeave: vi.fn(),
        onDragOver: vi.fn(),
        onDrop: vi.fn(),
      },
    })

    render(
      <ChatDropZone>
        <InputArea isAuthenticated={true} />
      </ChatDropZone>
    )

    expect(screen.getByTestId('chat-drop-overlay')).toHaveTextContent('Drop files to upload')
  })

  test('shows error drag overlay for unsupported files', () => {
    vi.mocked(useFileDragDrop).mockReturnValue({
      isDragging: true,
      isUnsupportedDrag: true,
      refusal: null,
      dragHandlers: {
        onDragEnter: vi.fn(),
        onDragLeave: vi.fn(),
        onDragOver: vi.fn(),
        onDrop: vi.fn(),
      },
    })

    render(
      <ChatDropZone>
        <InputArea isAuthenticated={true} />
      </ChatDropZone>
    )

    expect(screen.getByTestId('chat-drop-overlay')).toHaveTextContent('Unsupported file type')
  })

  const lastDropZone = () => vi.mocked(useFileDragDrop).mock.calls.at(-1)?.[0]

  test('offers the chat panel its attach path while the reader may attach', () => {
    render(
      <ChatDropZone>
        <InputArea isAuthenticated={true} />
      </ChatDropZone>
    )

    expect(lastDropZone()).toMatchObject({ disabled: false, refusal: null })
  })

  test('says why a drop is refused while the agent answers, instead of letting it vanish', () => {
    mockIsStreaming = true
    vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
    render(
      <ChatDropZone>
        <InputArea isAuthenticated={true} />
      </ChatDropZone>
    )

    expect(lastDropZone()).toMatchObject({
      disabled: false,
      refusal: `${PRODUCT_NAME} is answering. Attach files once the answer is complete.`,
    })
  })

  test('is no drop target for a reader who is not signed in', () => {
    render(
      <ChatDropZone>
        <InputArea isAuthenticated={false} />
      </ChatDropZone>
    )

    expect(lastDropZone()).toMatchObject({ disabled: true })
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

  describe('per-session composer drafts', () => {
    test('restores the session draft into the composer on mount (survives remount)', () => {
      mockDrafts = { 'session-1': 'a half-typed question' }

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(screen.getByRole('textbox')).toHaveValue('a half-typed question')
    })

    test('persists typed text to the active session draft', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      await user.type(screen.getByRole('textbox'), 'work in progress')

      expect(mockDrafts['session-1']).toBe('work in progress')
    })

    test('shows each session its own draft when switching sessions', () => {
      mockDrafts = { 'session-1': 'draft one', 'session-2': 'draft two' }

      const { rerender } = render(
        <InputArea isAuthenticated={true} connectionMode="sse" placeholder="a" />
      )
      expect(screen.getByRole('textbox')).toHaveValue('draft one')

      mockCurrentSessionId = 'session-2'
      rerender(<InputArea isAuthenticated={true} connectionMode="sse" placeholder="b" />)

      expect(screen.getByRole('textbox')).toHaveValue('draft two')
    })

    test('clears the session draft on a successful send', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      await user.type(screen.getByRole('textbox'), 'send me')
      expect(mockDrafts['session-1']).toBe('send me')

      await user.click(screen.getByRole('button', { name: /send message/i }))

      expect(mockSendMessage).toHaveBeenCalledWith('send me')
      expect('session-1' in mockDrafts).toBe(false)
      expect(screen.getByRole('textbox')).toHaveValue('')
    })

    test('retains the session draft (and text) when a send fails', async () => {
      const user = userEvent.setup()
      mockSendMessage.mockImplementationOnce(() => {
        throw new Error('network down')
      })
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      await user.type(screen.getByRole('textbox'), 'do not lose me')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      expect(mockDrafts['session-1']).toBe('do not lose me')
      expect(screen.getByRole('textbox')).toHaveValue('do not lose me')
    })

    test('a prefill fills an empty composer and becomes the session draft', () => {
      mockComposerPrefill = { text: 'prefilled question' }

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(screen.getByRole('textbox')).toHaveValue('prefilled question')
      expect(mockDrafts['session-1']).toBe('prefilled question')
    })

    test('a prefill does not clobber an existing non-empty draft', () => {
      mockDrafts = { 'session-1': 'my own in-progress text' }
      mockComposerPrefill = { text: 'chip suggestion' }

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(screen.getByRole('textbox')).toHaveValue('my own in-progress text')
      expect(mockDrafts['session-1']).toBe('my own in-progress text')
      expect(mockComposerPrefill).toBeNull()
    })
  })

  describe('composer control row (WS-3)', () => {
    test.skip('the trigger names the mix rather than counting it, and opens the picker', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      const trigger = screen.getByRole('button', { name: /data basis/i })
      expect(trigger).toHaveTextContent('All sources')
      expect(trigger).not.toHaveTextContent('2')

      await user.click(trigger)

      expect(
        screen.getByText(/what it actually used is in the derivation/i)
      ).toBeInTheDocument()
    })

    test.skip('the office preset reads "Büroablage" on the trigger, never "0"', () => {
      mockActiveSourcePreset = 'office'
      mockEnabledDataSourceIds = []

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      const trigger = screen.getByRole('button', { name: /data basis/i })
      expect(trigger).toHaveTextContent('Office filing')
      expect(trigger).not.toHaveTextContent('0')
    })

    test.skip('with every external source off the trigger says project knowledge only', () => {
      mockEnabledDataSourceIds = []

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(screen.getByRole('button', { name: /data basis/i })).toHaveTextContent(
        'Project knowledge only'
      )
    })

    test.skip('the always-on knowledge layer is listed in the picker instead of hidden', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      await user.click(screen.getByRole('button', { name: /data basis/i }))

      const alwaysOn = screen.getByRole('list', { name: /always included/i })
      expect(within(alwaysOn).getByText('Project knowledge')).toBeInTheDocument()
      expect(within(alwaysOn).getByText('Office filing')).toBeInTheDocument()
      expect(within(alwaysOn).getAllByText('Always on')).toHaveLength(2)
      expect(within(alwaysOn).queryAllByRole('switch')).toHaveLength(0)
    })

    test.skip('switching a source off in the picker persists the new basis', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      await user.click(screen.getByRole('button', { name: /data basis/i }))
      await user.click(screen.getByRole('switch', { name: /allow quelle eins/i }))

      expect(mockToggleDataSource).toHaveBeenCalledWith('source-1')
      expect(mockSaveDataSourcesToConversation).toHaveBeenCalledWith(['source-2'])
    })

    test.skip('turning the last external source off warns, where the banner stays silent', async () => {
      const user = userEvent.setup()
      mockEnabledDataSourceIds = []

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)
      await user.click(screen.getByRole('button', { name: /data basis/i }))

      expect(
        screen.getByText(/search only your project documents/i)
      ).toBeInTheDocument()
    })

    test.skip('the presets live in the picker permanently and apply the mapped subset', async () => {
      const user = userEvent.setup()
      mockAvailableDataSources = [
        { id: 'web_search', name: 'Web Search' },
        { id: 'ris', name: 'RIS – Österreichisches Recht' },
      ]
      mockEnabledDataSourceIds = ['web_search', 'ris']
      mockConversationMessages = [
        { id: 'msg-1', role: 'user', content: 'Hello', messageType: 'user' },
      ]

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)
      await user.click(screen.getByRole('button', { name: /data basis/i }))
      await user.click(screen.getByRole('radio', { name: /building law & guidelines/i }))

      expect(mockApplySourcePreset).toHaveBeenCalledWith('law', ['ris'])
      expect(mockSaveDataSourcesToConversation).toHaveBeenCalledWith(['ris'])
    })

    test.skip('"All sources" makes the default all-on state a named choice', async () => {
      const user = userEvent.setup()
      mockActiveSourcePreset = 'law'
      mockAvailableDataSources = [
        { id: 'web_search', name: 'Web Search' },
        { id: 'ris', name: 'RIS – Österreichisches Recht' },
      ]
      mockEnabledDataSourceIds = ['ris']

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)
      await user.click(screen.getByRole('button', { name: /data basis/i }))
      await user.click(screen.getByRole('radio', { name: /^all sources$/i }))

      expect(mockApplySourcePreset).toHaveBeenCalledWith(null, ['web_search', 'ris'])
      expect(mockSaveDataSourcesToConversation).toHaveBeenCalledWith(['web_search', 'ris'])
    })

    test('shows a stop button while streaming and cancels via stopStreaming (C1)', async () => {
      const user = userEvent.setup()
      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument()
      const stop = screen.getByRole('button', { name: /stop response/i })
      await user.click(stop)
      expect(mockStopStreaming).toHaveBeenCalledTimes(1)
    })

    test('send and stop are one control: the same element changes job, label and glyph', () => {
      const { rerender } = render(<InputArea isAuthenticated={true} connectionMode="sse" />)
      const send = screen.getByRole('button', { name: /send message/i })
      expect(send.querySelector('[data-glyph="send"]')).not.toBeNull()
      expect(send).not.toHaveAttribute('aria-keyshortcuts')

      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      rerender(<InputArea isAuthenticated={true} connectionMode="sse" canCollaborate={false} />)

      const stop = screen.getByRole('button', { name: /stop response/i })
      expect(stop).toBe(send)
      expect(stop).toHaveAttribute('aria-keyshortcuts', 'Escape')
      expect(stop).toHaveAttribute('title', 'Stop response (Esc)')
      expect(stop.querySelector('[data-glyph="stop"]')).not.toBeNull()
      expect(stop).not.toHaveTextContent('...')
    })

    test('Escape stops a streaming turn from <body> once the composer let go of the focus', async () => {
      const user = userEvent.setup()
      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      const input = screen.getByRole('textbox')
      act(() => input.focus())
      act(() => input.blur())
      expect(document.activeElement).toBe(document.body)
      await user.keyboard('{Escape}')
      expect(mockStopStreaming).toHaveBeenCalledTimes(1)
    })

    test('Escape from <body> after a click on transcript text leaves the turn running', async () => {
      const user = userEvent.setup()
      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      render(
        <>
          <p>Antworttext</p>
          <InputArea isAuthenticated={true} connectionMode="sse" />
        </>
      )

      await user.click(screen.getByRole('textbox'))
      await user.click(screen.getByText('Antworttext'))
      expect(document.activeElement).toBe(document.body)
      await user.keyboard('{Escape}')
      expect(mockStopStreaming).not.toHaveBeenCalled()
    })

    test('Escape from <body> with the composer never used leaves the turn running', async () => {
      const user = userEvent.setup()
      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(document.activeElement).toBe(document.body)
      await user.keyboard('{Escape}')
      expect(mockStopStreaming).not.toHaveBeenCalled()
    })

    test("an IME's Escape (Safari: after compositionend, keyCode 229) leaves the turn running", () => {
      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      const input = screen.getByRole('textbox')
      act(() => input.focus())
      fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 })
      expect(mockStopStreaming).not.toHaveBeenCalled()
    })

    test('Escape meant for something else on the page leaves the turn running', async () => {
      const user = userEvent.setup()
      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      render(
        <>
          <input aria-label="elsewhere" />
          <InputArea isAuthenticated={true} connectionMode="sse" />
        </>
      )

      await user.click(screen.getByRole('textbox', { name: 'elsewhere' }))
      await user.keyboard('{Escape}')
      expect(mockStopStreaming).not.toHaveBeenCalled()
    })

    test('Escape does nothing to the turn when nothing is streaming', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      await user.click(screen.getByRole('textbox'))
      await user.keyboard('{Escape}')
      expect(mockStopStreaming).not.toHaveBeenCalled()
    })

    describe("typing ahead during the reader's own turn", () => {
      const startOwnTurn = () => {
        mockIsStreaming = true
        vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      }

      test('tells a screen reader why Enter waits, for as long as the turn runs', () => {
        startOwnTurn()
        render(<InputArea isAuthenticated={true} connectionMode="websocket" />)
        expect(screen.getByRole('textbox')).toHaveAccessibleDescription(
          'You can send once the answer is finished.'
        )
      })
      const settle = () => {
        mockIsStreaming = false
        vi.mocked(useIsCurrentSessionBusy).mockReturnValue(false)
      }
      const pointer = (coarse: boolean) =>
        vi.stubGlobal(
          'matchMedia',
          (query: string) =>
            ({
              matches: coarse && query === '(pointer: coarse)',
              media: query,
              addEventListener: vi.fn(),
              removeEventListener: vi.fn(),
            }) as unknown as MediaQueryList
        )
      afterEach(() => {
        vi.unstubAllGlobals()
      })

      test('the field stays live and says the next question can be written now', () => {
        startOwnTurn()
        render(<InputArea isAuthenticated={true} connectionMode="sse" />)

        const input = screen.getByRole('textbox')
        expect(input).not.toBeDisabled()
        expect(input).toHaveAttribute('placeholder', 'Type your next question …')
        expect(screen.getByRole('button', { name: /stop response/i })).toBeInTheDocument()
      })

      test('Enter does not send while the turn runs, and the draft is kept as typed', async () => {
        const user = userEvent.setup()
        startOwnTurn()
        render(<InputArea isAuthenticated={true} connectionMode="sse" />)

        const input = screen.getByRole('textbox')
        await user.click(input)
        await user.keyboard('Und die Brandschutzklasse?{Enter}')

        expect(mockSendMessage).not.toHaveBeenCalled()
        expect(mockStopStreaming).not.toHaveBeenCalled()
        expect(input).toHaveValue('Und die Brandschutzklasse?')
        expect(mockDrafts['session-1']).toBe('Und die Brandschutzklasse?')
      })

      describe('steering the own turn, when the server reads notes', () => {
        const mockSteer = vi.fn(() => true)
        const offerSteering = () =>
          vi.mocked(useWebSocketChat).mockReturnValue({
            sendMessage: mockSendMessage,
            isLoading: false,
            respondToInteraction: mockRespondToInteraction,
            noteSendIntent: mockNoteSendIntent,
            pendingInteraction: null,
            steer: mockSteer,
            canSteer: true,
          } as unknown as ReturnType<typeof useWebSocketChat>)
        beforeEach(() => mockSteer.mockClear())

        test('says Enter steers the agent, with a small chip by the field, and keeps Stop', () => {
          offerSteering()
          startOwnTurn()
          render(<InputArea isAuthenticated={true} connectionMode="sse" />)

          const input = screen.getByRole('textbox')
          expect(input).toHaveAttribute('placeholder', `Steer ${PRODUCT_NAME} …`)
          expect(input).toHaveAccessibleDescription(
            `Enter adds to the running answer; ${PRODUCT_NAME} reads it before its next step.`
          )
          expect(screen.getByTestId('composer-steer-chip')).toHaveTextContent('steering')
          expect(screen.getByRole('button', { name: /stop response/i })).toBeInTheDocument()
        })

        test('Enter sends the note into the running turn, not a question, and clears the field', async () => {
          const user = userEvent.setup()
          offerSteering()
          startOwnTurn()
          render(<InputArea isAuthenticated={true} connectionMode="sse" />)

          const input = screen.getByRole('textbox')
          await user.click(input)
          await user.keyboard('nicht die Tür, die Treppe{Enter}')

          expect(mockSteer).toHaveBeenCalledWith({ text: 'nicht die Tür, die Treppe' })
          expect(mockSendMessage).not.toHaveBeenCalled()
          expect(mockStopStreaming).not.toHaveBeenCalled()
          expect(input).toHaveValue('')
        })

        test('a note the turn could not take stays in the field', async () => {
          const user = userEvent.setup()
          offerSteering()
          mockSteer.mockReturnValueOnce(false)
          startOwnTurn()
          render(<InputArea isAuthenticated={true} connectionMode="sse" />)

          const input = screen.getByRole('textbox')
          await user.click(input)
          await user.keyboard('die Treppe{Enter}')

          expect(mockSteer).toHaveBeenCalledTimes(1)
          expect(input).toHaveValue('die Treppe')
        })

        test('without a running turn of its own, the same Enter asks a question', async () => {
          const user = userEvent.setup()
          offerSteering()
          mockSendMessage.mockReturnValue(true)
          render(<InputArea isAuthenticated={true} connectionMode="sse" />)

          await user.click(screen.getByRole('textbox'))
          await user.keyboard('Erste Frage{Enter}')

          expect(mockSteer).not.toHaveBeenCalled()
          expect(mockSendMessage).toHaveBeenCalledWith('Erste Frage')
          expect(screen.queryByTestId('composer-steer-chip')).toBeNull()
        })
      })

      test('after the settle the button is Send again and Enter sends exactly once', async () => {
        const user = userEvent.setup()
        mockSendMessage.mockReturnValue(true)
        startOwnTurn()
        const { rerender } = render(
          <InputArea isAuthenticated={true} connectionMode="sse" placeholder="a" />
        )
        const input = screen.getByRole('textbox')
        await user.click(input)
        await user.keyboard('Folgefrage{Enter}')
        expect(mockSendMessage).not.toHaveBeenCalled()

        settle()
        rerender(<InputArea isAuthenticated={true} connectionMode="sse" placeholder="b" />)
        expect(screen.getByRole('button', { name: /send message/i })).not.toBeDisabled()

        await user.keyboard('{Enter}{Enter}')
        expect(mockSendMessage).toHaveBeenCalledTimes(1)
        expect(mockSendMessage).toHaveBeenCalledWith('Folgefrage')
        expect(input).toHaveValue('')
      })

      test('Escape in the field stops the turn and keeps the draft', async () => {
        const user = userEvent.setup()
        startOwnTurn()
        render(<InputArea isAuthenticated={true} connectionMode="sse" />)

        const input = screen.getByRole('textbox')
        await user.click(input)
        await user.keyboard('halb geschrieben')
        await user.keyboard('{Escape}')

        expect(mockStopStreaming).toHaveBeenCalledTimes(1)
        expect(input).toHaveValue('halb geschrieben')
        expect(mockDrafts['session-1']).toBe('halb geschrieben')
      })

      test('with the @ picker open, Escape closes the picker and leaves the turn running', async () => {
        const user = userEvent.setup()
        startOwnTurn()
        render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

        await user.click(screen.getByRole('textbox'))
        await user.keyboard('Frage an @')
        expect(await screen.findByTestId('mention-picker')).toBeInTheDocument()

        await user.keyboard('{Escape}')
        expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument()
        expect(mockStopStreaming).not.toHaveBeenCalled()

        await user.keyboard('{Escape}')
        expect(mockStopStreaming).toHaveBeenCalledTimes(1)
      })

      test('on a fine pointer the field keeps its focus through the send and the turn', async () => {
        const user = userEvent.setup()
        pointer(false)
        mockSendMessage.mockReturnValue(true)
        const { rerender } = render(
          <InputArea isAuthenticated={true} connectionMode="sse" placeholder="a" />
        )
        const input = screen.getByRole('textbox')
        await user.click(input)
        await user.keyboard('Erste Frage{Enter}')
        expect(mockSendMessage).toHaveBeenCalledTimes(1)

        startOwnTurn()
        rerender(<InputArea isAuthenticated={true} connectionMode="sse" placeholder="b" />)
        expect(input).not.toBeDisabled()
        expect(document.activeElement).toBe(input)
      })

      const screenWithKeyboard = (occludedPx: number) => {
        Object.defineProperty(document.documentElement, 'clientHeight', {
          configurable: true,
          value: 844,
        })
        vi.stubGlobal('visualViewport', { height: 844 - occludedPx, scale: 1 })
      }
      afterEach(() => {
        Reflect.deleteProperty(document.documentElement, 'clientHeight')
      })

      test('with the soft keyboard up the send releases it', async () => {
        const user = userEvent.setup()
        pointer(true)
        screenWithKeyboard(336)
        mockSendMessage.mockReturnValue(true)
        render(<InputArea isAuthenticated={true} connectionMode="sse" />)
        const input = screen.getByRole('textbox')
        await user.click(input)
        await user.keyboard('Erste Frage{Enter}')

        expect(mockSendMessage).toHaveBeenCalledTimes(1)
        expect(document.activeElement).not.toBe(input)
      })

      test('a coarse pointer on a hardware keyboard (iPad) keeps the field focused', async () => {
        const user = userEvent.setup()
        pointer(true)
        screenWithKeyboard(55)
        mockSendMessage.mockReturnValue(true)
        render(<InputArea isAuthenticated={true} connectionMode="sse" />)
        const input = screen.getByRole('textbox')
        await user.click(input)
        await user.keyboard('Erste Frage{Enter}')

        expect(mockSendMessage).toHaveBeenCalledTimes(1)
        expect(document.activeElement).toBe(input)
      })

      describe('Send and Stop share one element', () => {
        let clock = 1_000
        beforeEach(() => {
          clock = 1_000
          vi.spyOn(performance, 'now').mockImplementation(() => clock)
        })
        afterEach(() => {
          vi.mocked(performance.now).mockRestore()
        })

        test('a double click on Stop does not send the draft typed ahead', async () => {
          const user = userEvent.setup()
          mockSendMessage.mockReturnValue(true)
          startOwnTurn()
          const { rerender } = render(
            <InputArea isAuthenticated={true} connectionMode="sse" placeholder="a" />
          )
          await user.type(screen.getByRole('textbox'), 'Folgefrage')
          const control = screen.getByRole('button', { name: /stop response/i })

          await user.click(control)
          expect(mockStopStreaming).toHaveBeenCalledTimes(1)
          settle()
          rerender(<InputArea isAuthenticated={true} connectionMode="sse" placeholder="b" />)
          expect(control).toHaveAccessibleName(/send message/i)

          clock += 120
          await user.click(control)
          expect(mockSendMessage).not.toHaveBeenCalled()

          clock += 400
          await user.click(control)
          expect(mockSendMessage).toHaveBeenCalledWith('Folgefrage')
        })

        test('a double click on Send does not cancel the turn it started', async () => {
          const user = userEvent.setup()
          mockSendMessage.mockReturnValue(true)
          const { rerender } = render(
            <InputArea isAuthenticated={true} connectionMode="sse" placeholder="a" />
          )
          await user.type(screen.getByRole('textbox'), 'Erste Frage')
          const control = screen.getByRole('button', { name: /send message/i })

          await user.click(control)
          expect(mockSendMessage).toHaveBeenCalledTimes(1)
          startOwnTurn()
          rerender(<InputArea isAuthenticated={true} connectionMode="sse" placeholder="b" />)
          expect(control).toHaveAccessibleName(/stop response/i)

          clock += 120
          await user.click(control)
          expect(mockStopStreaming).not.toHaveBeenCalled()

          clock += 400
          await user.click(control)
          expect(mockStopStreaming).toHaveBeenCalledTimes(1)
        })

        test("a held Enter's repeats do not press the control again", () => {
          startOwnTurn()
          render(<InputArea isAuthenticated={true} connectionMode="sse" />)
          const control = screen.getByRole('button', { name: /stop response/i })

          expect(fireEvent.keyDown(control, { key: 'Enter' })).toBe(true)
          expect(fireEvent.keyDown(control, { key: 'Enter', repeat: true })).toBe(false)
        })

        test('a held Enter in the field sends once', async () => {
          mockSendMessage.mockReturnValue(true)
          render(<InputArea isAuthenticated={true} connectionMode="sse" />)
          const input = screen.getByRole('textbox')
          await userEvent.setup().type(input, 'Frage')

          fireEvent.keyDown(input, { key: 'Enter', repeat: true })
          expect(mockSendMessage).not.toHaveBeenCalled()
          expect(input).toHaveValue('Frage')
        })
      })

      test("a colleague's turn keeps the field closed", () => {
        startOwnTurn()
        publishThreadSharing('session-1', true)
        publishTurnActor('session-1', 'Anna Weber')
        render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

        expect(screen.getByRole('textbox')).toBeDisabled()
      })

      test('a HITL answer still sends mid-turn', async () => {
        const user = userEvent.setup()
        startOwnTurn()
        vi.mocked(useWebSocketChat).mockReturnValue({
          sendMessage: mockSendMessage,
          isStreaming: true,
          isLoading: false,
          respondToInteraction: mockRespondToInteraction,
          noteSendIntent: mockNoteSendIntent,
          pendingInteraction: { id: 'p-1' },
        } as unknown as ReturnType<typeof useWebSocketChat>)
        render(<InputArea isAuthenticated={true} connectionMode="sse" />)

        await user.type(screen.getByRole('textbox'), 'ja{Enter}')
        expect(mockRespondToInteraction).toHaveBeenCalledWith('ja')
      })
    })

    test('nothing in the composer offers to choose deep research', () => {
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(
        screen.queryByRole('button', { name: /deep research preference/i })
      ).not.toBeInTheDocument()
    })

    test('offers no project scope chip: the project is fixed, so a picker would be a dead control', () => {
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(screen.queryByRole('button', { name: /search scope/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /all projects/i })).not.toBeInTheDocument()
    })

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

    test('once a human is tagged the composer says the agent will stay quiet', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')

      expect(screen.getByTestId('composer-mention-hint')).toHaveTextContent(
        `${PRODUCT_NAME} will stay quiet — Anna Weber is being asked.`,
      )
    })

    test('tagging only the assistant does not claim it will stay quiet', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard(`@${PRODUCT_NAME.slice(0, 3).toLowerCase()}`)
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')

      expect(composer()).toHaveValue(`@${PRODUCT_NAME} `)
      expect(screen.queryByTestId('composer-mention-hint')).not.toBeInTheDocument()
    })

    test('sending passes the STRUCTURED mentions, not the text', async () => {
      const user = userEvent.setup()
      mockSendMessage.mockResolvedValue({ ok: true, addressees: { agent: false, users: ['u-anna'] } })
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')
      await user.keyboard('passt das?')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      expect(mockSendMessage).toHaveBeenCalledWith('@Anna Weber passt das?', {
        mentions: [{ targetId: 'u-anna', display: 'Anna Weber' }],
      })
      expect(composer()).toHaveValue('')
      expect(screen.queryByTestId('composer-mention-hint')).not.toBeInTheDocument()
    })

    test('deleting the inserted token deletes the mention (MN-3)', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')
      expect(screen.getByTestId('composer-mention-hint')).toBeInTheDocument()

      await user.clear(composer())
      await user.keyboard('doch nicht, danke')
      expect(screen.queryByTestId('composer-mention-hint')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /send message/i }))
      expect(mockSendMessage).toHaveBeenCalledWith('doch nicht, danke')
    })

    test('a refused mention keeps the text and explains the refusal', async () => {
      const user = userEvent.setup()
      mockSendMessage.mockResolvedValue({
        ok: false,
        failure: { reason: 'mention-invite-requires-owner', message: 'refused' },
      })
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      await waitFor(() => expect(composer()).toHaveValue('@Anna Weber'))
      expect(screen.getByTestId('composer-mention-hint')).toBeInTheDocument()
      expect(toast.error).toHaveBeenCalledWith(
        'You can only mention people who are already in this conversation. Ask an owner to invite Anna Weber.',
        expect.anything(),
      )
    })

    test('a rate-limited mention says so', async () => {
      const user = userEvent.setup()
      mockSendMessage.mockResolvedValue({
        ok: false,
        failure: { reason: 'mention-rate-limited', message: null },
      })
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'Too many mentions. Please wait a few minutes.',
          expect.anything(),
        ),
      )
    })

    test('without a candidate list the composer behaves exactly as before (NF-8)', async () => {
      const user = userEvent.setup()
      mockMentionData = null
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')

      expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument()
      expect(composer()).not.toHaveAttribute('role')

      await user.keyboard('{Enter}')
      expect(mockSendMessage).toHaveBeenCalledWith('@anna')
    })

    test('while the candidates load the picker shows its skeleton rows', async () => {
      const user = userEvent.setup()
      mockMentionData = null
      mockMentionsLoading = true
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@')

      expect(await screen.findByTestId('mention-picker')).toBeInTheDocument()
      expect(screen.getByText('Loading people…')).toBeInTheDocument()
    })

    describe('when the candidates never arrived', () => {
      test('a fresh @ asks again', async () => {
        const user = userEvent.setup()
        mockMentionData = null
        mockMentionsLoading = false
        render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('@')
        mockRestartMentionCandidates.mockClear()

        await user.keyboard('{Backspace}Frage an @')

        expect(mockRestartMentionCandidates).toHaveBeenCalled()
      })

      test('but typing inside one fragment does not ask once per keystroke', async () => {
        const user = userEvent.setup()
        mockMentionData = null
        mockMentionsLoading = false
        render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('@')
        mockRestartMentionCandidates.mockClear()

        await user.keyboard('Markus')

        expect(mockRestartMentionCandidates).not.toHaveBeenCalled()
      })

      test('and a picker that already has its candidates is left alone', async () => {
        const user = userEvent.setup()
        render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('@')
        mockRestartMentionCandidates.mockClear()
        await user.keyboard('{Backspace}Frage an @')

        expect(mockRestartMentionCandidates).not.toHaveBeenCalled()
      })

      test('makes the conversation real on the first @ of a new window', async () => {
        const user = userEvent.setup()
        mockCurrentSessionId = null
        mockMentionData = null
        mockMentionsLoading = false
        mockEnsureConversationExists.mockClear()
        render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('@')

        expect(mockEnsureConversationExists).toHaveBeenCalled()
      })

      test('does not pay the round trip on every keystroke, only on the fragment', async () => {
        const user = userEvent.setup()
        mockCurrentSessionId = null
        mockMentionData = null
        mockMentionsLoading = false
        render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('Frage')
        expect(mockEnsureConversationExists).not.toHaveBeenCalled()

        await user.keyboard(' an @')
        expect(mockEnsureConversationExists).toHaveBeenCalledTimes(1)

        await user.keyboard('Markus')
        expect(mockEnsureConversationExists).toHaveBeenCalledTimes(1)
      })
    })

    describe('with collaboration off', () => {
      test('typing @ opens nothing, even while a load could be in flight', async () => {
        const user = userEvent.setup()
        mockMentionData = null
        mockMentionsLoading = true
        render(<InputArea isAuthenticated={true} connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('Frage an @')

        expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument()
        expect(composer()).not.toHaveAttribute('role')
      })

      test('never asks the server who could be mentioned', async () => {
        const user = userEvent.setup()
        render(<InputArea isAuthenticated={true} connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('@ann')

        expect(vi.mocked(useMentionCandidates)).toHaveBeenCalled()
        for (const call of vi.mocked(useMentionCandidates).mock.calls) {
          expect(call[1]).toBe(false)
        }
      })
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

  describe('the send agrees with the addressee line', () => {
    const composer = () => screen.getByPlaceholderText(`Ask ${PRODUCT_NAME} about this project …`)

    const send = async (text: string) => {
      const user = userEvent.setup()
      await user.click(composer())
      await user.keyboard(text)
      await user.click(screen.getByRole('button', { name: /send message/i }))
    }

    test('a plain message while a person is awaited asks the server to rule', async () => {
      mockAwaitingPending = [{ id: 'r-1' }]
      publishThreadSharing('session-1', true)
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      await send('Ja, eigener Abschnitt.')

      expect(mockSendMessage).toHaveBeenCalledWith('Ja, eigener Abschnitt.', {
        awaitingHuman: true,
      })
    })

    test('a plain message in the normal state stays the one-argument fast path', async () => {
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      await send('Wie breit muss der Fluchtweg sein?')

      expect(mockSendMessage).toHaveBeenCalledWith('Wie breit muss der Fluchtweg sein?')
    })

    test('a gated org never takes the ruled path, wait or no wait (NF-8)', async () => {
      mockAwaitingPending = [{ id: 'r-1' }]
      publishThreadSharing('session-1', true)
      render(<InputArea isAuthenticated connectionMode="sse" />)

      const user = userEvent.setup()
      await user.click(screen.getByRole('textbox'))
      await user.keyboard('Frage')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      expect(mockSendMessage).toHaveBeenCalledWith('Frage')
    })

    test('asks the awaiting endpoint nothing at all on a thread that is not shared (NF-8)', () => {
      mockAwaitingPending = [{ id: 'r-1' }]
      publishThreadSharing('session-1', false)
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      expect(vi.mocked(useAwaitingState)).toHaveBeenCalledWith(null, false)
    })

    test('asks it once the thread IS shared', () => {
      publishThreadSharing('session-1', true)
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      expect(vi.mocked(useAwaitingState)).toHaveBeenCalledWith('session-1', true)
    })

    test('declares the thread stale after sending a mention', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')
      await user.keyboard('schaust du drauf?')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      await waitFor(() => expect(vi.mocked(bumpThreadRevision)).toHaveBeenCalledWith('session-1'))
    })

    test('…and not after an ordinary message, which changes nothing server-side', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('Kurze Frage')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
      expect(vi.mocked(bumpThreadRevision)).not.toHaveBeenCalled()
    })
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

  describe('attaching to a chat that has no server row yet', () => {
    test('makes the conversation real before the bytes, then uploads into the chat', async () => {
      const order: string[] = []
      mockEnsureConversationExists.mockImplementationOnce(async () => {
        order.push('ensureConversation')
      })
      mockUploadFiles.mockImplementationOnce(async () => {
        order.push('upload')
      })

      render(
        <ChatDropZone>
          <InputArea isAuthenticated={true} />
        </ChatDropZone>
      )
      const { onDrop } = vi.mocked(useFileDragDrop).mock.calls.at(-1)![0]
      await act(async () => {
        await onDrop([new File(['x'], 'plan.pdf', { type: 'application/pdf' })], { truncated: false, unreadable: 0 })
      })

      expect(order).toEqual(['ensureConversation', 'upload'])
      expect(mockUploadFiles).toHaveBeenCalledWith(expect.any(Array), { collectionOverride: 'session-1' })
      expect(vi.mocked(useFileUpload)).toHaveBeenCalledWith(
        expect.objectContaining({ collectionName: 'session-1', conversationProjectId: undefined })
      )
      expect(vi.mocked(useFileUpload).mock.calls[0][0]).toHaveProperty('conversationProjectId')
    })
  })

  describe('the composer states where an attached file goes', () => {
    const DESTINATION = 'Files uploaded here go to private session unless removed.'

    test('names the destination alongside the attached-file chips', () => {
      vi.mocked(useFileUpload).mockReturnValue({
        uploadFiles: mockUploadFiles,
        deleteFile: mockDeleteFile,
        retryFile: mockRetryFile,
        sessionFiles: [
          { id: 'file-1', fileName: 'doc.pdf', status: 'success', collectionName: 'session-1' },
        ],
        isUploading: false,
        error: null,
        clearError: vi.fn(),
      } as unknown as ReturnType<typeof useFileUpload>)

      render(<InputArea isAuthenticated={true} />)

      expect(screen.getByTestId('upload-destination')).toHaveTextContent(DESTINATION)
    })

    test('names it at the moment of the drop, where the decision is made', () => {
      vi.mocked(useFileDragDrop).mockReturnValue({
        isDragging: true,
        isUnsupportedDrag: false,
        refusal: null,
        dragHandlers: {
          onDragEnter: vi.fn(),
          onDragLeave: vi.fn(),
          onDragOver: vi.fn(),
          onDrop: vi.fn(),
        },
      })

      render(
        <ChatDropZone>
          <InputArea isAuthenticated={true} />
        </ChatDropZone>
      )

      const overlay = screen.getByTestId('chat-drop-overlay')
      expect(overlay).toHaveTextContent('Drop files to upload')
      expect(within(overlay).getByTestId('upload-destination')).toHaveTextContent(DESTINATION)
    })

    test('says nothing about a destination for a file it will refuse', () => {
      vi.mocked(useFileDragDrop).mockReturnValue({
        isDragging: true,
        isUnsupportedDrag: true,
        refusal: null,
        dragHandlers: {
          onDragEnter: vi.fn(),
          onDragLeave: vi.fn(),
          onDragOver: vi.fn(),
          onDrop: vi.fn(),
        },
      })

      render(
        <ChatDropZone>
          <InputArea isAuthenticated={true} />
        </ChatDropZone>
      )

      expect(screen.getByTestId('chat-drop-overlay')).toHaveTextContent('Unsupported file type')
      expect(screen.queryByTestId('upload-destination')).not.toBeInTheDocument()
    })
  })
  describe('a message asked while its file is still being read', () => {
    const composer = () => screen.getByPlaceholderText(`Ask ${PRODUCT_NAME} about this project …`)

    const withSessionFiles = (files: unknown[]) =>
      vi.mocked(useFileUpload).mockReturnValue({
        uploadFiles: mockUploadFiles,
        deleteFile: mockDeleteFile,
        retryFile: mockRetryFile,
        sessionFiles: files,
        isUploading: false,
        error: null,
        clearError: vi.fn(),
      } as unknown as ReturnType<typeof useFileUpload>)

    const ingesting = [
      { id: 'file-1', fileName: 'grundriss.pdf', status: 'ingesting', collectionName: 'session-1' },
    ]
    const ready = [
      { id: 'file-1', fileName: 'grundriss.pdf', status: 'success', collectionName: 'session-1' },
    ]

    test('is held rather than sent, and says so', async () => {
      const user = userEvent.setup()
      withSessionFiles(ingesting)
      render(<InputArea isAuthenticated={true} />)

      await user.click(composer())
      await user.keyboard('Erfüllt der Grundriss die Fluchtweganforderungen?{Enter}')

      expect(mockSendMessage).not.toHaveBeenCalled()
      expect(screen.getByTestId('composer-held-for-upload')).toBeInTheDocument()
    })

    test('goes on its own the moment the file is readable', async () => {
      const user = userEvent.setup()
      withSessionFiles(ingesting)
      const { rerender } = render(<InputArea isAuthenticated={true} />)

      await user.click(composer())
      await user.keyboard('Wie hoch ist die Attika?{Enter}')
      expect(mockSendMessage).not.toHaveBeenCalled()

      withSessionFiles(ready)
      rerender(<InputArea isAuthenticated={true} placeholder={undefined} />)

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
      expect(String(mockSendMessage.mock.calls[0]?.[0])).toBe('Wie hoch ist die Attika?')
      await waitFor(() => expect(screen.queryByTestId('composer-held-for-upload')).not.toBeInTheDocument())
    })

    test('is not swallowed by an upload that failed', async () => {
      const user = userEvent.setup()
      withSessionFiles(ingesting)
      const { rerender } = render(<InputArea isAuthenticated={true} />)

      await user.click(composer())
      await user.keyboard('Und ohne die Datei?{Enter}')

      withSessionFiles([{ ...ingesting[0], status: 'error' }])
      rerender(<InputArea isAuthenticated={true} placeholder={undefined} />)

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
    })

    test('offers a way to ask now without waiting', async () => {
      const user = userEvent.setup()
      withSessionFiles(ingesting)
      render(<InputArea isAuthenticated={true} />)

      await user.click(composer())
      await user.keyboard('Was gilt allgemein?{Enter}')

      await user.click(screen.getByRole('button', { name: /ask now without it/i }))

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
      expect(String(mockSendMessage.mock.calls[0]?.[0])).toBe('Was gilt allgemein?')
    })

    test('sends immediately when nothing is in flight', async () => {
      const user = userEvent.setup()
      withSessionFiles(ready)
      render(<InputArea isAuthenticated={true} />)

      await user.click(composer())
      await user.keyboard('Ganz normale Frage{Enter}')

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
      expect(screen.queryByTestId('composer-held-for-upload')).not.toBeInTheDocument()
    })
  })

})

describe('InputArea — intent to send opens the agent socket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCurrentSessionId = 'session-1'
    mockConversationMessages = []
    mockDrafts = {}
    mockComposerPrefill = null
    mockComposerSubject = null
    mockAwaitingPending = []
    mockIsStreaming = false
    mockAvailableDataSources = [
      { id: 'source-1', name: 'Quelle eins' },
      { id: 'source-2', name: 'Quelle zwei' },
    ]
    mockEnabledDataSourceIds = ['source-1', 'source-2']
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

  test('the collaboration flag reaches the socket layer, which is what defers the connect', () => {
    render(<InputArea isAuthenticated canCollaborate />)

    expect(vi.mocked(useWebSocketChat)).toHaveBeenCalledWith({
      autoConnect: true,
      canCollaborate: true,
    })
  })

  test('a gated org passes canCollaborate: false, so the socket opens on mount as today', () => {
    render(<InputArea isAuthenticated />)

    expect(vi.mocked(useWebSocketChat)).toHaveBeenCalledWith({
      autoConnect: true,
      canCollaborate: false,
    })
  })

  test('nothing is declared by merely rendering the composer', () => {
    render(<InputArea isAuthenticated canCollaborate />)

    expect(mockNoteSendIntent).not.toHaveBeenCalled()
  })

  test('focusing the composer declares it', async () => {
    render(<InputArea isAuthenticated canCollaborate />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('textbox'))

    expect(mockNoteSendIntent).toHaveBeenCalled()
  })

  test('a send declares it too, for the paths that never fire a focus event', async () => {
    mockDrafts = { 'session-1': 'Wie breit muss der Fluchtweg sein?' }
    render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

    await waitFor(() =>
      expect(screen.getByRole('textbox')).toHaveValue('Wie breit muss der Fluchtweg sein?')
    )
    expect(mockNoteSendIntent).not.toHaveBeenCalled()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(mockNoteSendIntent).toHaveBeenCalled()
    expect(mockSendMessage).toHaveBeenCalled()
  })
})
