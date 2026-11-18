import { fireEvent, render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import type { ComposerPrefill, ComposerSubject } from '@/features/chat/types'
import { InputArea } from './InputArea'
import { publishThreadSharing, publishTurnActor, resetThreadSharing } from '@/shared/collaboration/thread-sharing'
import { useWebSocketChat, useIsCurrentSessionBusy } from '@/features/chat'
import { useFileUpload, useFileDragDrop } from '@/features/documents'
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
  })
})
