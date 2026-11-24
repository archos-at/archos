import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import type { ComposerPrefill, ComposerSubject } from '@/features/chat/types'
import { InputArea } from './InputArea'
import { resetThreadSharing } from '@/shared/collaboration/thread-sharing'
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

  describe('composer control row (WS-3)', () => {
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
    })
  })
})
